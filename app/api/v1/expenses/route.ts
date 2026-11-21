import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const expenses = await prisma.expense.findMany({
    include: { category: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: expenses });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { categoryId, accountId, amount, currency, expenseDate, description } = await req.json();

    const expAmount = Number(amount);
    if (!categoryId || !accountId || !expAmount || expAmount <= 0) {
      return NextResponse.json({ error: 'التصنيف والحساب ومبلغ المصروف مطلوبان' }, { status: 400 });
    }

    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    const payingAccount = await prisma.account.findUnique({ where: { id: accountId } });
    const expenseLedgerAccount = await prisma.account.findFirst({ where: { accountCode: '5010' } });

    if (!category || !payingAccount || !expenseLedgerAccount) {
      return NextResponse.json({ error: 'بيانات المصروف أو حساب الخصم غير صحيحة' }, { status: 404 });
    }

    const payBal = Number(payingAccount.currentBalance);
    if (payBal < expAmount) {
      return NextResponse.json({
        error: `رصيد الحساب المالي (${payBal.toLocaleString()} ${payingAccount.currency}) لا يكفي لسداد المصروف (${expAmount.toLocaleString()})`,
      }, { status: 400 });
    }

    const count = await prisma.expense.count();
    const expenseNumber = `EXP-${Date.now()}-${count + 1}`;
    const dateStr = expenseDate || new Date().toISOString().split('T')[0];

    // Double-Entry: Debit Expense Account, Credit Paying Safe/Bank
    await postLedgerTransaction({
      entryType: 'operating_expense',
      referenceType: 'Expense',
      description: `صرف مصروف ${category.name}: ${description || ''}`,
      createdBy: user.name,
      lines: [
        {
          accountId: expenseLedgerAccount.id,
          currency: payingAccount.currency,
          debit: expAmount,
          credit: 0,
          description: `مصروف ${category.name}`,
        },
        {
          accountId: payingAccount.id,
          currency: payingAccount.currency,
          debit: 0,
          credit: expAmount,
          description: `صرف نقدي من ${payingAccount.name}`,
        },
      ],
    });

    const expense = await prisma.expense.create({
      data: {
        expenseNumber,
        categoryId: category.id,
        accountId: payingAccount.id,
        amount: expAmount,
        currency: currency || payingAccount.currency,
        expenseDate: dateStr,
        description: description || `مصروف: ${category.name}`,
        status: 'approved',
        createdBy: user.name,
      },
      include: { category: true },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'RECORD_EXPENSE',
      entityType: 'Expense',
      entityId: expense.id,
      newValues: expense,
      reason: `تسجيل مصروف ${category.name} بمبلغ ${expAmount.toLocaleString()} ${expense.currency}`,
    });

    return NextResponse.json({ success: true, data: expense }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تسجيل المصروف' }, { status: 500 });
  }
}
