import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const transactions = await prisma.capitalTransaction.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const capitalAccount = await prisma.account.findFirst({
    where: { accountType: 'capital' },
  });

  return NextResponse.json({
    success: true,
    currentCapital: capitalAccount?.currentBalance || 0,
    data: transactions,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحية تعديل وسحب أو ضخ رأس المال مخصصة لمدير النظام فقط' }, { status: 403 });
  }

  try {
    const { transactionType, accountId, currency, amount, description } = await req.json();

    const capAmount = Number(amount);
    if (!transactionType || !accountId || !capAmount || capAmount <= 0) {
      return NextResponse.json({ error: 'نوع المعاملة والحساب والمبلغ مطلوبان' }, { status: 400 });
    }

    const safeAccount = await prisma.account.findUnique({ where: { id: accountId } });
    const capitalAccount = await prisma.account.findFirst({ where: { accountType: 'capital' } });

    if (!safeAccount || !capitalAccount) {
      return NextResponse.json({ error: 'الحساب المالي أو حساب رأس المال غير موجود' }, { status: 404 });
    }

    const isAddition = transactionType === 'addition' || transactionType === 'initial_capital';

    if (isAddition) {
      // Debit Safe, Credit Capital
      await postLedgerTransaction({
        entryType: 'capital_addition',
        referenceType: 'CapitalTransaction',
        description: description || `إضافة رأس مال بمبلغ ${capAmount.toLocaleString()} ${currency || safeAccount.currency}`,
        createdBy: user.name,
        lines: [
          {
            accountId: safeAccount.id,
            currency: safeAccount.currency,
            debit: capAmount,
            credit: 0,
            description: `إيداع رأس مال في ${safeAccount.name}`,
          },
          {
            accountId: capitalAccount.id,
            currency: capitalAccount.currency,
            debit: 0,
            credit: capAmount,
            description: 'زيادة رأس المال المستثمر',
          },
        ],
      });
    } else {
      // Withdrawal: Debit Capital, Credit Safe
      if (Number(safeAccount.currentBalance) < capAmount) {
        return NextResponse.json({ error: 'رصيد الحساب غير كافٍ لسحب رأس المال' }, { status: 400 });
      }

      await postLedgerTransaction({
        entryType: 'capital_withdrawal',
        referenceType: 'CapitalTransaction',
        description: description || `سحب رأس مال بمبلغ ${capAmount.toLocaleString()} ${currency || safeAccount.currency}`,
        createdBy: user.name,
        lines: [
          {
            accountId: capitalAccount.id,
            currency: capitalAccount.currency,
            debit: capAmount,
            credit: 0,
            description: 'تخفيض رأس المال المستثمر',
          },
          {
            accountId: safeAccount.id,
            currency: safeAccount.currency,
            debit: 0,
            credit: capAmount,
            description: `سحب من ${safeAccount.name}`,
          },
        ],
      });
    }

    const tx = await prisma.capitalTransaction.create({
      data: {
        transactionType,
        accountId: safeAccount.id,
        currency: safeAccount.currency,
        amount: capAmount,
        transactionDate: new Date().toISOString().split('T')[0],
        description: description || (isAddition ? 'إضافة رأس مال' : 'سحب رأس مال'),
        createdBy: user.name,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: isAddition ? 'CAPITAL_ADD' : 'CAPITAL_WITHDRAW',
      entityType: 'CapitalTransaction',
      entityId: tx.id,
      newValues: { amount: capAmount, type: transactionType, account: safeAccount.name },
      reason: description || 'حركة رأس مال',
    });

    return NextResponse.json({ success: true, data: tx }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في معالجة رأس المال' }, { status: 500 });
  }
}
