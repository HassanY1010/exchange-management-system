import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';
import { createNotification } from '@/lib/notifications/notification-service';
import Decimal from 'decimal.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية تسوية فوائض السداد مقتصرة على المحاسب أو مدير النظام فقط' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { action, notes } = body; // action: 'credit_balance' | 'cash_refund' | 'customer_liability'

    if (!action || !['credit_balance', 'cash_refund', 'customer_liability'].includes(action)) {
      return NextResponse.json({ error: 'يجب تحديد إجراء صحيح لتسوية الفائض: ترحيل للرصيد، إرجاع نقدي، أو قيد التزام' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const lockedRows = (await tx.$queryRawUnsafe(
        'SELECT id, "overpaymentAmount", "overpaymentSettled", "sessionNumber", "customerId", "requestedAmount", "expectedAmount", "receivedAmount", "deliveredAmount", "status" FROM "CustomerSession" WHERE id = $1 FOR UPDATE',
        params.id
      )) as any[];

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('الجلسة غير موجودة');
      }

      const locked = lockedRows[0];

      if (locked.overpaymentSettled) {
        throw new Error('تمت تسوية فائض السداد لهذه الجلسة مسبقاً ولا يمكن تكرار التسوية');
      }

      const overpayment = new Decimal(locked.overpaymentAmount.toString());
      if (overpayment.lessThanOrEqualTo(0.0001)) {
        throw new Error('لا يوجد مبلغ فائض مسجل في هذه الجلسة لتسويته');
      }

      const customer = await tx.customer.findUnique({ where: { id: locked.customerId } });
      const customerName = customer ? customer.name : 'العميل';
      const overpaymentNum = overpayment.toNumber();

      // Accounts
      const customerLiabilitySdg = await tx.account.findFirst({ where: { accountCode: '2015' } });
      const bankakAccount = await tx.account.findFirst({ where: { accountCode: '1030' } });

      if (!customerLiabilitySdg || !bankakAccount) {
        throw new Error('حسابات وسيط التزامات العملاء (2015) أو بنكك (1030) غير مهيأة');
      }

      if (action === 'cash_refund') {
        // Refund surplus SDG to customer via Bankak transfer
        await postLedgerTransaction({
          entryType: 'overpayment_refund',
          referenceType: 'CustomerSession',
          referenceId: locked.id,
          description: `استرداد فائض سداد ${overpaymentNum.toLocaleString()} SDG للعميل ${customerName} (جلسة ${locked.sessionNumber})`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: customerLiabilitySdg.id,
              currency: 'SDG',
              debit: overpaymentNum,
              credit: 0,
              description: `إلغاء التزام الفائض للعميل ${customerName}`,
            },
            {
              accountId: bankakAccount.id,
              currency: 'SDG',
              debit: 0,
              credit: overpaymentNum,
              description: `تحويل استرداد فائض من حساب بنكك`,
            },
          ],
        });
      } else {
        // Keep as permanent customer balance / general customer credit liability
        await postLedgerTransaction({
          entryType: 'overpayment_to_customer_credit',
          referenceType: 'CustomerSession',
          referenceId: locked.id,
          description: `ترحيل فائض سداد ${overpaymentNum.toLocaleString()} SDG إلى رصيد دائن مستحق للعميل ${customerName}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: customerLiabilitySdg.id,
              currency: 'SDG',
              debit: overpaymentNum,
              credit: 0,
              description: `إقفال فائض جلسة ${locked.sessionNumber}`,
            },
            {
              accountId: customerLiabilitySdg.id,
              currency: 'SDG',
              debit: 0,
              credit: overpaymentNum,
              description: `قيد رصيد دائن دائم لصالح العميل ${customerName}`,
            },
          ],
        });
      }

      const dRequested = new Decimal(locked.requestedAmount?.toString() || '0');
      const dDelivered = new Decimal(locked.deliveredAmount?.toString() || '0');
      const dExpected = new Decimal(locked.expectedAmount?.toString() || '0');
      const dReceived = new Decimal(locked.receivedAmount?.toString() || '0');

      const isFullyDelivered = dRequested.greaterThan(0) && dDelivered.greaterThanOrEqualTo(dRequested.minus(0.0001));
      const isFullyPaid = dExpected.greaterThan(0) && dReceived.greaterThanOrEqualTo(dExpected.minus(0.0001));
      const nextStatus = (isFullyDelivered && isFullyPaid) ? 'completed' : locked.status;

      // Update Session
      const updated = await tx.customerSession.update({
        where: { id: locked.id },
        data: {
          overpaymentSettled: true,
          overpaymentAction: action,
          status: nextStatus,
          closedAt: nextStatus === 'completed' ? new Date() : null,
          closedBy: nextStatus === 'completed' ? user.name : null,
        },
        include: { customer: true },
      });

      return {
        session: updated,
        overpaymentNum,
        customerName,
        sessionNumber: locked.sessionNumber,
      };
    });

    // Audit log (Post-Transaction)
    await logAuditEvent({
      userId: user.userId,
      action: 'SETTLE_OVERPAYMENT',
      entityType: 'CustomerSession',
      entityId: result.session.id,
      newValues: { overpaymentAmount: result.overpaymentNum, action, notes },
      reason: `تسوية فائض سداد جلسة ${result.sessionNumber} بإجراء ${action}`,
    });

    // Notification
    await createNotification({
      type: 'overpayment_detected',
      title: 'تمت تسوية فائض السداد بنجاح',
      message: `تمت تسوية فائض مبلغ ${result.overpaymentNum.toLocaleString()} SDG للعميل ${result.customerName} بإجراء: ${action === 'cash_refund' ? 'استرداد نقدي' : 'ترحيل إلى رصيد العميل'}`,
      referenceType: 'CustomerSession',
      referenceId: result.session.id,
      recipientRole: 'accountant',
      priority: 'normal',
    });

    return NextResponse.json({
      success: true,
      message: 'تمت تسوية فائض السداد بنجاح وتسجيل الأثر المحاسبي',
      data: result.session,
    });
  } catch (error: any) {
    console.error('Error settling overpayment:', error);
    return NextResponse.json({ error: error.message || 'خطأ في تسوية فائض السداد' }, { status: 500 });
  }
}
