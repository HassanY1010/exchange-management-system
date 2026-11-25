import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { calculateSessionBalance } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant', 'custody_officer'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تسليم النقدية للعملاء مقتصرة على مسؤول العهدة أو المحاسب أو المدير' },
      { status: 403 }
    );
  }

  try {
    const { customerId, customerSessionId, amount, notes } = await req.json();

    const dDeliver = new Decimal(amount || 0);
    if (dDeliver.isNaN() || dDeliver.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'مبلغ التسليم يجب أن يكون رقماً أكبر من صفر' }, { status: 400 });
    }

    const deliverAmount = dDeliver.toNumber();

    // Execute with atomic row-level lock on EmployeeCustody and ledger entry inside single transaction
    const result = await prisma.$transaction(async (tx) => {
      const lockedCustodies = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "currentAmount", "status", "accountId", "employeeId", "currency", "businessDate" FROM "EmployeeCustody" WHERE id = $1 FOR UPDATE',
        params.id
      );
      const lockedCustody = lockedCustodies[0];
      if (!lockedCustody) {
        throw new Error('سجل العهدة غير موجود');
      }

      // Assert that the custody's business date is open and not frozen
      await assertBusinessDateOpen(lockedCustody.businessDate, tx);

      if (lockedCustody.status !== 'open') {
        throw new Error('هذه العهدة مغلقة أو مسواة ولا يمكن الصرف منها');
      }

      // Rule: "لا يسمح النظام بتسليم مبلغ أكبر من العهدة المتاحة"
      const currentCustodyAmount = new Decimal(lockedCustody.currentAmount.toString());
      if (currentCustodyAmount.lessThan(dDeliver)) {
        throw new Error(
          `رصيد العهدة المتاح للموظف (${currentCustodyAmount.toFixed(2)} ${lockedCustody.currency}) أقل من المبلغ المطلوب تسليمه (${dDeliver.toFixed(2)} ${lockedCustody.currency})`
        );
      }

      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new Error('العميل المستلم غير موجود');
      }

      if (customer.status === 'closed') {
        throw new Error(`حساب العميل (${customer.name}) مقفل حالياً. لا يمكن تسليم نقدية لحساب مقفل.`);
      }

      if (customer.status === 'blocked') {
        throw new Error(`حساب العميل (${customer.name}) محظور في النظام.`);
      }

      const employee = await tx.employee.findUnique({
        where: { id: lockedCustody.employeeId },
      });

      let linkedSession: any = null;
      if (customerSessionId) {
        const lockedSessions = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "customerId", "sessionNumber", "status", "requestedAmount", "expectedAmount", "receivedAmount", "deliveredAmount", "exchangeRate" FROM "CustomerSession" WHERE id = $1 FOR UPDATE',
          customerSessionId
        );
        linkedSession = lockedSessions[0];
        if (!linkedSession) {
          throw new Error('الجلسة الحسابية المرتبطة غير موجودة');
        }
        if (linkedSession.customerId !== customer.id) {
          throw new Error('الجلسة المحددة لا تتبع لهذا العميل');
        }
        if (linkedSession.status === 'cancelled') {
          throw new Error('لا يمكن التسليم لجلسة حسابية ملغاة');
        }
        if (linkedSession.status === 'completed') {
          throw new Error('تم صرف وتسليم هذه الجلسة بالكامل مسبقاً');
        }
      }

      // Liability clearing account: 2010 (EGP) or 2015 (SDG)
      const liabilityCode = lockedCustody.currency === 'SDG' ? '2015' : '2010';
      let customerLiabilityAccount = await tx.account.findFirst({
        where: { accountCode: liabilityCode },
      });

      if (!customerLiabilityAccount) {
        customerLiabilityAccount = await tx.account.findFirst({
          where: { accountType: 'customer_balance', currency: lockedCustody.currency },
        });
      }

      if (!customerLiabilityAccount) {
        throw new Error(`حساب التزامات العملاء لعملة (${lockedCustody.currency}) غير مهيأ في الدليل المحاسبي`);
      }

      // 1. Update custody balance atomically
      const newCustodyBalance = currentCustodyAmount.minus(dDeliver).toNumber();
      await tx.employeeCustody.update({
        where: { id: params.id },
        data: { currentAmount: newCustodyBalance },
      });

      // 2. Post custody transaction (tag referenceNumber with sessionNumber if linked so statement avoids any duplication)
      const refNum = linkedSession
        ? `DLV-${linkedSession.sessionNumber}-${Date.now()}`
        : `DLV-${Date.now()}`;
      const custodyTxn = await tx.custodyTransaction.create({
        data: {
          custodyId: params.id,
          transactionType: 'delivery_to_customer',
          amount: deliverAmount,
          currency: lockedCustody.currency,
          customerId: customer.id,
          referenceNumber: refNum,
          description: linkedSession
            ? `تسليم نقدية للعميل ${customer.name} (جلسة ${linkedSession.sessionNumber})${notes ? ` (${notes})` : ''}`
            : `تسليم نقدية للعميل ${customer.name} ${notes ? `(${notes})` : ''}`,
          createdBy: user.name,
        },
      });

      // 3. Post Double-Entry Ledger Entry INSIDE the transaction (tx)
      await postLedgerTransaction({
        entryType: 'custody_delivery',
        referenceType: 'CustodyTransaction',
        referenceId: custodyTxn.id,
        entryDate: lockedCustody.businessDate,
        description: `تسليم نقدية ${deliverAmount.toLocaleString()} ${lockedCustody.currency} للعميل ${customer.name} من عهدة ${employee?.name || 'الموظف'}`,
        createdBy: user.name,
        tx,
        lines: [
          {
            accountId: customerLiabilityAccount.id,
            currency: lockedCustody.currency,
            debit: deliverAmount,
            credit: 0,
            description: `تسليم نقدية للعميل ${customer.name}`,
          },
          {
            accountId: lockedCustody.accountId,
            currency: lockedCustody.currency,
            debit: 0,
            credit: deliverAmount,
            description: `صرف من عهدة ${employee?.name || 'الموظف'}`,
          },
        ],
      });

      // 4. Update Customer Session delivered total atomically using Decimal if linked
      if (linkedSession) {
        const currentDeliveredD = new Decimal(linkedSession.deliveredAmount?.toString() || '0');
        const newDeliveredD = currentDeliveredD.plus(dDeliver);
        const balanceCheck = calculateSessionBalance({
          requestedEgpAmount: Number(linkedSession.requestedAmount),
          exchangeRate: Number(linkedSession.exchangeRate),
          approvedReceiptsTotalSdg: Number(linkedSession.receivedAmount),
          deliveredEgpAmount: newDeliveredD.toNumber(),
        });

        await tx.customerSession.update({
          where: { id: linkedSession.id },
          data: {
            deliveredAmount: newDeliveredD.toFixed(4),
            remainingAmount: balanceCheck.remainingSdgAmount,
            status: balanceCheck.status,
            closedAt: balanceCheck.status === 'completed' ? new Date() : null,
            closedBy: balanceCheck.status === 'completed' ? user.name : null,
          },
        });
      }

      // Record Audit Log inside the same atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'CUSTODY_DELIVERY',
        entityType: 'EmployeeCustody',
        entityId: params.id,
        newValues: {
          customer: customer.name,
          deliveredAmount: deliverAmount,
          currency: lockedCustody.currency,
          remainingCustody: newCustodyBalance,
        },
        reason: `تسليم نقدية رسمية للعميل ${customer.name} من عهدة ${employee?.name || 'الموظف'}`,
        tx,
      });

      return {
        newCustodyBalance,
        custodyTxn,
        customerName: customer.name,
        employeeName: employee?.name || 'الموظف',
        accountId: lockedCustody.accountId,
        currency: lockedCustody.currency,
      };
    });

    return NextResponse.json({
      success: true,
      message: 'تم تسليم المبلغ للعميل وتحديث رصيد العهدة وتسجيل القيد بنجاح',
      data: {
        custodyBalanceRemaining: result.newCustodyBalance,
        custodyTxn: result.custodyTxn,
      },
    });
  } catch (error: any) {
    console.error('Custody delivery error:', error);
    return NextResponse.json({ error: error.message || 'خطأ في تسليم المبلغ' }, { status: 500 });
  }
}
