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

    const custody = await prisma.employeeCustody.findUnique({
      where: { id: params.id },
      include: { employee: true },
    });

    if (!custody) {
      return NextResponse.json({ error: 'سجل العهدة غير موجود' }, { status: 404 });
    }

    if (custody.status === 'closed') {
      return NextResponse.json({ error: 'هذه العهدة مغلقة ولا يمكن الصرف منها' }, { status: 400 });
    }

    // Rule from Page 21: "لا يسمح النظام بتسليم مبلغ أكبر من العهدة المتاحة"
    const currentCustodyAmount = Number(custody.currentAmount);
    if (currentCustodyAmount < deliverAmount) {
      return NextResponse.json({
        error: `رصيد العهدة المتاح للموظف (${currentCustodyAmount.toLocaleString()} EGP) أقل من المبلغ المطلوب تسليمه (${deliverAmount.toLocaleString()} EGP)`,
      }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    }

    const session = customerSessionId
      ? await prisma.customerSession.findUnique({ where: { id: customerSessionId } })
      : null;

    const customerLiabilityAccount = await prisma.account.findFirst({
      where: { accountCode: '2010' },
    });

    if (!customerLiabilityAccount) {
      throw new Error('حساب التزامات العملاء غير موجود');
    }

    // 1. Post Double-Entry Ledger Entry (Debit Customer Liability, Credit Employee Custody)
    await postLedgerTransaction({
      entryType: 'custody_delivery',
      referenceType: 'CustodyTransaction',
      referenceId: custody.id,
      description: `تسليم نقدية ${deliverAmount.toLocaleString()} EGP للعميل ${customer.name} من عهدة ${custody.employee.name}`,
      createdBy: user.name,
      lines: [
        {
          accountId: customerLiabilityAccount.id,
          currency: 'EGP',
          debit: deliverAmount,
          credit: 0,
          description: `تسليم نقدية للعميل ${customer.name}`,
        },
        {
          accountId: custody.accountId,
          currency: 'EGP',
          debit: 0,
          credit: deliverAmount,
          description: `صرف من عهدة ${custody.employee.name}`,
        },
      ],
    });

    // 2. Update custody balance and record custody transaction
    const newCustodyBalance = currentCustodyAmount - deliverAmount;
    await prisma.employeeCustody.update({
      where: { id: custody.id },
      data: { currentAmount: newCustodyBalance },
    });

    const custodyTxn = await prisma.custodyTransaction.create({
      data: {
        custodyId: custody.id,
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
    if (session) {
      const currentDelivered = Number(session.deliveredAmount);
      const newDelivered = currentDelivered + deliverAmount;
      const balanceCheck = calculateSessionBalance({
        requestedEgpAmount: Number(session.requestedAmount),
        exchangeRate: Number(session.exchangeRate),
        approvedReceiptsTotalSdg: Number(session.receivedAmount),
        deliveredEgpAmount: newDelivered,
      });

      await prisma.customerSession.update({
        where: { id: session.id },
        data: {
          deliveredAmount: newDelivered,
          remainingAmount: balanceCheck.remainingSdgAmount,
          status: balanceCheck.status,
        },
      });
    }

    await logAuditEvent({
      userId: user.userId,
      action: 'CUSTODY_DELIVERY',
      entityType: 'EmployeeCustody',
      entityId: custody.id,
      newValues: { customer: customer.name, deliveredAmount: deliverAmount, remainingCustody: newCustodyBalance },
      reason: `تسليم نقدية للعميل ${customer.name}`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم تسليم المبلغ للعميل وتحديث رصيد العهدة بنجاح',
      data: {
        custodyBalanceRemaining: newCustodyBalance,
        custodyTxn,
      },
    });
  } catch (error: any) {
    console.error('Custody delivery error:', error);
    return NextResponse.json({ error: error.message || 'خطأ في تسليم المبلغ' }, { status: 500 });
  }
}
