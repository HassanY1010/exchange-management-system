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

    const session = await prisma.customerSession.findUnique({
      where: { id: params.id },
      include: { customer: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
    }

    const overpayment = new Decimal(session.overpaymentAmount.toString());
    if (overpayment.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'لا يوجد مبلغ فائض مسجل في هذه الجلسة لتسويته' }, { status: 400 });
    }

    if (session.overpaymentSettled) {
      return NextResponse.json({ error: 'تمت تسوية فائض السداد لهذه الجلسة مسبقاً' }, { status: 400 });
    }

    const overpaymentNum = overpayment.toNumber();

    // Accounts
    const customerLiabilitySdg = await prisma.account.findFirst({ where: { accountCode: '2015' } });
    const bankakAccount = await prisma.account.findFirst({ where: { accountCode: '1030' } });

    if (!customerLiabilitySdg || !bankakAccount) {
      throw new Error('حسابات وسيط التزامات العملاء أو بنكك غير مهيأة');
    }

    if (action === 'cash_refund') {
      // Refund surplus SDG to customer via Bankak transfer
      await postLedgerTransaction({
        entryType: 'overpayment_refund',
        referenceType: 'CustomerSession',
        referenceId: session.id,
        description: `استرداد فائض سداد ${overpaymentNum.toLocaleString()} SDG للعميل ${session.customer.name} (جلسة ${session.sessionNumber})`,
        createdBy: user.name,
        lines: [
          {
            accountId: customerLiabilitySdg.id,
            currency: 'SDG',
            debit: overpaymentNum,
            credit: 0,
            description: `إلغاء التزام الفائض للعميل ${session.customer.name}`,
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
        referenceId: session.id,
        description: `ترحيل فائض سداد ${overpaymentNum.toLocaleString()} SDG إلى رصيد دائن مستحق للعميل ${session.customer.name}`,
        createdBy: user.name,
        lines: [
          {
            accountId: customerLiabilitySdg.id,
            currency: 'SDG',
            debit: overpaymentNum,
            credit: 0,
            description: `إقفال فائض جلسة ${session.sessionNumber}`,
          },
          {
            accountId: customerLiabilitySdg.id,
            currency: 'SDG',
            debit: 0,
            credit: overpaymentNum,
            description: `قيد رصيد دائن دائم لصالح العميل ${session.customer.name}`,
          },
        ],
      });
    }

    // Update Session
    const updated = await prisma.customerSession.update({
      where: { id: session.id },
      data: {
        overpaymentSettled: true,
        overpaymentAction: action,
      },
      include: { customer: true },
    });

    // Audit log
    await logAuditEvent({
      userId: user.userId,
      action: 'SETTLE_OVERPAYMENT',
      entityType: 'CustomerSession',
      entityId: session.id,
      newValues: { overpaymentAmount: overpaymentNum, action, notes },
      reason: `تسوية فائض سداد جلسة ${session.sessionNumber} بإجراء ${action}`,
    });

    // Notification
    await createNotification({
      type: 'overpayment_detected',
      title: 'تمت تسوية فائض السداد بنجاح',
      message: `تمت تسوية فائض مبلغ ${overpaymentNum.toLocaleString()} SDG للعميل ${session.customer.name} بإجراء: ${action === 'cash_refund' ? 'استرداد نقدي' : 'ترحيل إلى رصيد العميل'}`,
      referenceType: 'CustomerSession',
      referenceId: session.id,
      recipientRole: 'accountant',
      priority: 'normal',
    });

    return NextResponse.json({
      success: true,
      message: 'تمت تسوية فائض السداد بنجاح وتسجيل الأثر المحاسبي',
      data: updated,
    });
  } catch (error: any) {
    console.error('Error settling overpayment:', error);
    return NextResponse.json({ error: error.message || 'خطأ في تسوية فائض السداد' }, { status: 500 });
  }
}
