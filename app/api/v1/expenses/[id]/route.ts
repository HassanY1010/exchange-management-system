import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'معرف المصروف مطلوب' }, { status: 400 });

  const expense = await prisma.expense.findFirst({
    where: {
      OR: [{ id }, { expenseNumber: id }],
    },
    include: { category: true },
  });

  if (!expense) {
    return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 });
  }

  const payingAccount = await prisma.account.findUnique({
    where: { id: expense.accountId },
    select: { id: true, accountCode: true, name: true, currency: true, accountType: true },
  });

  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: {
      referenceType: 'Expense',
      referenceId: expense.expenseNumber,
    },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    success: true,
    data: {
      ...expense,
      amount: Number(expense.amount),
      account: payingAccount,
      ledgerEntries,
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can cancel/reverse expenses
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بإلغاء وعكس المصروفات. الصلاحية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'معرف المصروف مطلوب' }, { status: 400 });

  let reason = '';
  try {
    const body = await req.json().catch(() => ({}));
    reason = body.reason || '';
  } catch {
    reason = '';
  }

  try {
    const expense = await prisma.expense.findFirst({
      where: { OR: [{ id }, { expenseNumber: id }] },
      include: { category: true },
    });

    if (!expense) {
      return NextResponse.json({ error: 'المصروف المطلوب إلغاؤه غير موجود' }, { status: 404 });
    }

    if (expense.status === 'cancelled') {
      return NextResponse.json({ error: 'هذا المصروف ملغي مسبقاً ولا يمكن إلغاؤه مرة أخرى' }, { status: 400 });
    }

    const dAmount = new Decimal(expense.amount.toString());
    const cur = expense.currency;
    const expenseDateStr = getSystemBusinessDate(expense.expenseDate);

    // Execute atomic reversal
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify that the original business date of the expense is open and not frozen
      await assertBusinessDateOpen(expenseDateStr, tx);

      // 1. Fetch paying account and expense account
      const safeAccount = await tx.account.findUnique({ where: { id: expense.accountId } });
      if (!safeAccount) {
        throw new Error('الحساب المالي الأصلي للمصروف غير موجود');
      }

      const expenseCode = cur === 'EGP' ? '5010' : `5010-${cur}`;
      const expenseAcc = await tx.account.findFirst({
        where: { currency: cur, accountType: 'expense', accountCode: expenseCode },
      });
      if (!expenseAcc) {
        throw new Error(`حساب المصروفات (${expenseCode}) غير موجود`);
      }

      // 2. Lock both accounts in deterministic order
      const sortedIds = [safeAccount.id, expenseAcc.id].sort();
      const lockedFirst = (await tx.$queryRawUnsafe(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
        sortedIds[0]
      )) as any[];
      const lockedSecond = (await tx.$queryRawUnsafe(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
        sortedIds[1]
      )) as any[];

      const accountLockMap = new Map<string, any>();
      accountLockMap.set(sortedIds[0], lockedFirst[0]);
      accountLockMap.set(sortedIds[1], lockedSecond[0]);

      const lockedSafe = accountLockMap.get(safeAccount.id);
      const lockedExp = accountLockMap.get(expenseAcc.id);

      // 3. Post Balanced Reversing Double-Entry Transaction (expense_reversal):
      // Debit: Safe Account (refunds/restores cash asset)
      // Credit: Expense Account (decreases expense)
      const cancelReason = reason ? `إلغاء مصروف ${expense.expenseNumber}: ${reason}` : `إلغاء وعكس المصروف ${expense.expenseNumber} (${expense.category.name})`;
      const reversingLedger = await postLedgerTransaction({
        entryType: 'expense_reversal',
        referenceType: 'Expense',
        referenceId: expense.expenseNumber,
        entryDate: expenseDateStr,
        description: cancelReason,
        createdBy: user.name || user.email || user.userId || 'system',
        tx,
        lines: [
          {
            accountId: lockedSafe.id,
            currency: cur,
            debit: dAmount.toNumber(),
            credit: 0,
            description: `استرداد قيد إلغاء مصروف ${expense.expenseNumber}`,
          },
          {
            accountId: lockedExp.id,
            currency: cur,
            debit: 0,
            credit: dAmount.toNumber(),
            description: `عكس تخفيض مصروف ${expense.category.name}`,
          },
        ],
      });

      // 4. Update Expense record status to cancelled
      const updatedExpense = await tx.expense.update({
        where: { id: expense.id },
        data: {
          status: 'cancelled',
          description: `${expense.description} [ملغي: ${reason || 'بواسطة ' + (user.name || user.email)}]`,
        },
      });

      return { updatedExpense, reversingLedger, lockedSafe, lockedExp };
    });

    // 5. Audit Log
    await logAuditEvent({
      userId: user.userId,
      action: 'CANCEL_EXPENSE',
      entityType: 'Expense',
      entityId: expense.id,
      oldValues: { status: 'approved', amount: dAmount.toNumber(), currency: cur },
      newValues: { status: 'cancelled', reversalLedgerId: result.reversingLedger.id },
      reason: reason || `إلغاء وعكس مصروف ${expense.expenseNumber}`,
    });

    return NextResponse.json({
      success: true,
      message: `تم إلغاء المصروف وعكس القيد المحاسبي واسترداد مبلغ ${dAmount.toNumber().toLocaleString()} ${cur} إلى ${result.lockedSafe.name} بنجاح`,
      data: {
        ...result.updatedExpense,
        amount: dAmount.toNumber(),
        reversingLedger: result.reversingLedger,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء إلغاء المصروف' }, { status: 500 });
  }
}
