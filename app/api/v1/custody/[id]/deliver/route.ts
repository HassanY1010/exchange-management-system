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

      const employee = await tx.employee.findUnique({
        where: { id: lockedCustody.employeeId },
      });

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

      // 2. Post custody transaction
      const custodyTxn = await tx.custodyTransaction.create({
        data: {
          custodyId: params.id,
          transactionType: 'delivery_to_customer',
          amount: deliverAmount,
          currency: lockedCustody.currency,
          customerId: customer.id,
          referenceNumber: `DLV-${Date.now()}`,
          description: `تسليم نقدية للعميل ${customer.name} ${notes ? `(${notes})` : ''}`,
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

      // 4. Update Customer Session delivered total if linked
      if (customerSessionId) {
        const session = await tx.customerSession.findUnique({ where: { id: customerSessionId } });
        if (session) {
          const currentDelivered = Number(session.deliveredAmount);
          const newDelivered = currentDelivered + deliverAmount;
          const balanceCheck = calculateSessionBalance({
            requestedEgpAmount: Number(session.requestedAmount),
            exchangeRate: Number(session.exchangeRate),
            approvedReceiptsTotalSdg: Number(session.receivedAmount),
            deliveredEgpAmount: newDelivered,
          });

          await tx.customerSession.update({
            where: { id: session.id },
            data: {
              deliveredAmount: newDelivered,
              remainingAmount: balanceCheck.remainingSdgAmount,
              status: balanceCheck.status,
            },
          });
        }
      }

      return {
        newCustodyBalance,
        custodyTxn,
        customerName: customer.name,
        employeeName: employee?.name || 'الموظف',
        accountId: lockedCustody.accountId,
        currency: lockedCustody.currency,
      };
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CUSTODY_DELIVERY',
      entityType: 'EmployeeCustody',
      entityId: params.id,
      newValues: {
        customer: result.customerName,
        deliveredAmount: deliverAmount,
        currency: result.currency,
        remainingCustody: result.newCustodyBalance,
      },
      reason: `تسليم نقدية رسمية للعميل ${result.customerName} من عهدة ${result.employeeName}`,
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
