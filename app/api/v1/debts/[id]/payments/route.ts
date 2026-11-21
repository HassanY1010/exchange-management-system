import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { amount, accountId, reference } = await req.json();

    const payAmount = Number(amount);
    if (!payAmount || payAmount <= 0) {
      return NextResponse.json({ error: 'مبلغ السداد يجب أن يكون أكبر من صفر' }, { status: 400 });
    }

    const debt = await prisma.debt.findUnique({
      where: { id: params.id },
      include: { payments: true },
    });

    if (!debt) {
      return NextResponse.json({ error: 'سجل الدين غير موجود' }, { status: 404 });
    }

    if (debt.status === 'paid') {
      return NextResponse.json({ error: 'هذا الدين تم سداده بالكامل مسبقاً' }, { status: 400 });
    }

    const remAmount = Number(debt.remainingAmount);
    if (payAmount > remAmount) {
      return NextResponse.json({
        error: `مبلغ السداد (${payAmount.toLocaleString()}) أكبر من المبلغ المتبقي (${remAmount.toLocaleString()})`,
      }, { status: 400 });
    }

    const receivingAccount = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!receivingAccount) {
      return NextResponse.json({ error: 'حساب استلام السداد غير موجود' }, { status: 404 });
    }

    const newRemaining = remAmount - payAmount;
    const newStatus = newRemaining <= 0.001 ? 'paid' : 'partially_paid';

    // 1. Double-Entry: Debit Receiving Safe, Credit Debt Account
    const debtAccount = await prisma.account.findFirst({
      where: { accountType: 'customer_liability' },
    }) || receivingAccount;

    await postLedgerTransaction({
      entryType: 'debt_payment',
      referenceType: 'DebtPayment',
      referenceId: debt.id,
      description: `سداد دين رقم ${debt.debtNumber}: دفعة بقيمة ${payAmount.toLocaleString()} ${debt.currency}`,
      createdBy: user.name,
      lines: [
        {
          accountId: receivingAccount.id,
          currency: receivingAccount.currency,
          debit: payAmount,
          credit: 0,
          description: `سداد دين وارد إلى ${receivingAccount.name}`,
        },
        {
          accountId: debtAccount.id,
          currency: debt.currency,
          debit: 0,
          credit: payAmount,
          description: `تسوية مديونية ${debt.debtNumber}`,
        },
      ],
    });

    // 2. Record Debt Payment
    const payment = await prisma.debtPayment.create({
      data: {
        debtId: debt.id,
        amount: payAmount,
        currency: debt.currency,
        accountId: receivingAccount.id,
        paymentDate: new Date().toISOString().split('T')[0],
        reference: reference || `PAY-${Date.now()}`,
        createdBy: user.name,
      },
    });

    // 3. Update Debt status and remaining amount
    const updatedDebt = await prisma.debt.update({
      where: { id: debt.id },
      data: {
        remainingAmount: newRemaining,
        status: newStatus,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'DEBT_PAYMENT',
      entityType: 'Debt',
      entityId: debt.id,
      newValues: { paymentAmount: payAmount, newRemaining, newStatus },
      reason: `تسجيل سداد دين رقم ${debt.debtNumber}`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم تسجيل سداد الدين وتحديث الحسابات بنجاح',
      data: { payment, debt: updatedDebt },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في سداد الدين' }, { status: 500 });
  }
}
