import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { calculateSessionBalance } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { customerId, customerSessionId, amount, notes } = await req.json();

    const deliverAmount = Number(amount);
    if (!deliverAmount || deliverAmount <= 0) {
      return NextResponse.json({ error: 'مبلغ التسليم يجب أن يكون أكبر من صفر' }, { status: 400 });
    }

    // Execute with atomic row-level lock on EmployeeCustody
    const result = await prisma.$transaction(async (tx) => {
      const lockedCustodies = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "currentAmount", "status", "accountId", "employeeId" FROM "EmployeeCustody" WHERE id = $1 FOR UPDATE',
        params.id
      );
      const lockedCustody = lockedCustodies[0];
      if (!lockedCustody) {
        throw new Error('سجل العهدة غير موجود');
      }

      if (lockedCustody.status === 'closed') {
        throw new Error('هذه العهدة مغلقة ولا يمكن الصرف منها');
      }

      // Rule from Page 21: "لا يسمح النظام بتسليم مبلغ أكبر من العهدة المتاحة"
      const currentCustodyAmount = Number(lockedCustody.currentAmount);
      if (currentCustodyAmount < deliverAmount) {
        throw new Error(`رصيد العهدة المتاح للموظف (${currentCustodyAmount.toLocaleString()} EGP) أقل من المبلغ المطلوب تسليمه (${deliverAmount.toLocaleString()} EGP)`);
      }

      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new Error('العميل غير موجود');
      }

      const employee = await tx.employee.findUnique({
        where: { id: lockedCustody.employeeId },
      });

      const customerLiabilityAccount = await tx.account.findFirst({
        where: { accountCode: '2010' },
      });

      if (!customerLiabilityAccount) {
        throw new Error('حساب التزامات العملاء غير موجود');
      }

      // 1. Update custody balance atomically
      const newCustodyBalance = currentCustodyAmount - deliverAmount;
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
          currency: 'EGP',
          customerId: customer.id,
          referenceNumber: `DLV-${Date.now()}`,
          description: `تسليم نقدية للعميل ${customer.name} ${notes ? `(${notes})` : ''}`,
          createdBy: user.name,
        },
      });

      // 3. Update Customer Session delivered total if linked
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
      };
    });

    // 4. Post Double-Entry Ledger Entry (Debit Customer Liability, Credit Employee Custody)
    const customerLiabilityAccount = await prisma.account.findFirst({
      where: { accountCode: '2010' },
    });
    if (customerLiabilityAccount) {
      await postLedgerTransaction({
        entryType: 'custody_delivery',
        referenceType: 'CustodyTransaction',
        referenceId: params.id,
        description: `تسليم نقدية ${deliverAmount.toLocaleString()} EGP للعميل ${result.customerName} من عهدة ${result.employeeName}`,
        createdBy: user.name,
        lines: [
          {
            accountId: customerLiabilityAccount.id,
            currency: 'EGP',
            debit: deliverAmount,
            credit: 0,
            description: `تسليم نقدية للعميل ${result.customerName}`,
          },
          {
            accountId: result.accountId,
            currency: 'EGP',
            debit: 0,
            credit: deliverAmount,
            description: `صرف من عهدة ${result.employeeName}`,
          },
        ],
      });
    }

    await logAuditEvent({
      userId: user.userId,
      action: 'CUSTODY_DELIVERY',
      entityType: 'EmployeeCustody',
      entityId: params.id,
      newValues: { customer: result.customerName, deliveredAmount: deliverAmount, remainingCustody: result.newCustodyBalance },
      reason: `تسليم نقدية للعميل ${result.customerName}`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم تسليم المبلغ للعميل وتحديث رصيد العهدة بنجاح',
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
