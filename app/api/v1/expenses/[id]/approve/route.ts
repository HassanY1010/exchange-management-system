import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can approve expenses
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك باعتماد المصروفات. الصلاحية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'معرف المصروف مطلوب' }, { status: 400 });

  try {
    const expense = await prisma.expense.findFirst({
      where: {
        OR: [{ id }, { expenseNumber: id }],
      },
      include: { category: true },
    });

    if (!expense) {
      return NextResponse.json({ error: 'المصروف المطلوب اعتماده غير موجود' }, { status: 404 });
    }

    // Prevent duplicate approvals
    if (expense.status === 'approved') {
      return NextResponse.json({ error: 'هذا المصروف معتمد ومرحل مسبقاً' }, { status: 400 });
    }

    if (expense.status !== 'pending') {
      return NextResponse.json(
        { error: `لا يمكن اعتماد مصروف في حالة (${expense.status}). الاعتماد متاح فقط للمصروفات المعلقة` },
        { status: 400 }
      );
    }

    // Segregation of Duties (SoD) Verification:
    // The creator (createdBy) cannot approve their own expense, except emergency admin override with explicit audit log.
    const creator = (expense.createdBy || '').trim().toLowerCase();
    const currentUserName = (user.name || '').trim().toLowerCase();
    const currentUserEmail = (user.email || '').trim().toLowerCase();
    const currentUserId = (user.userId || '').trim().toLowerCase();

    const isCreator =
      creator === currentUserName ||
      creator === currentUserEmail ||
      creator === currentUserId;

    if (isCreator && user.role !== 'admin') {
      return NextResponse.json(
        {
          error:
            'مبدأ فصل المهام (Segregation of Duties): لا يجوز لمنشئ المصروف اعتماده بنفسه. يجب اعتماده من قبل محاسب آخر أو مدير النظام.',
        },
        { status: 403 }
      );
    }

    const dAmount = new Decimal(expense.amount.toString());
    const cur = expense.currency;
    const dateStr = getSystemBusinessDate(expense.expenseDate);

    // Execute atomic transaction: lock accounts, verify overdraft, post balanced double-entry, update expense status
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify business date is open and not frozen
      await assertBusinessDateOpen(dateStr, tx);

      // 1. Fetch paying safe account
      const safeAccount = await tx.account.findUnique({ where: { id: expense.accountId } });
      if (!safeAccount) {
        throw new Error('الحساب المالي المخصوم منه غير موجود');
      }

      // Find or auto-initialize currency-matched Expense Account (Class 5xxx)
      const expenseCode = cur === 'EGP' ? '5010' : `5010-${cur}`;
      let expenseAcc = await tx.account.findFirst({
        where: { currency: cur, accountType: 'expense', accountCode: expenseCode },
      });

      if (!expenseAcc) {
        expenseAcc = await tx.account.upsert({
          where: { accountCode: expenseCode },
          create: {
            accountCode: expenseCode,
            name: `المصروفات التشغيلية والعمومية (${cur})`,
            accountType: 'expense',
            currency: cur,
            openingBalance: 0,
            currentBalance: 0,
            isSystem: true,
            status: 'active',
          },
          update: {},
        });
      }

      // 2. Lock both accounts in deterministic sorted order
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

      const dSafeBal = new Decimal(lockedSafe.currentBalance.toString());

      // Overdraft Protection: Verify safe balance sufficiency
      if (dSafeBal.lessThan(dAmount)) {
        throw new Error(
          `رصيد الحساب المالي (${lockedSafe.name}) لا يكفي لسداد المصروف. الرصيد المتاح: ${dSafeBal.toFixed(2)} ${cur}، والمطلوب: ${dAmount.toFixed(2)} ${cur}`
        );
      }

      // 3. Post Balanced Double-Entry:
      // Debit: Operating Expense 5xxx (increases expense)
      // Credit: Safe / Bank Account (decreases cash asset)
      const ledgerEntry = await postLedgerTransaction({
        entryType: 'operating_expense',
        referenceType: 'Expense',
        referenceId: expense.expenseNumber,
        entryDate: dateStr,
        description: `اعتماد وصرف مصروف ${expense.category.name}: ${expense.description}`,
        createdBy: user.name || user.email || user.userId || 'system',
        tx,
        lines: [
          {
            accountId: lockedExp.id,
            currency: cur,
            debit: dAmount.toNumber(),
            credit: 0,
            description: `مصروف تشغيلي - ${expense.category.name}`,
          },
          {
            accountId: lockedSafe.id,
            currency: cur,
            debit: 0,
            credit: dAmount.toNumber(),
            description: `صرف نقدي من ${lockedSafe.name}`,
          },
        ],
      });

      // 4. Update Expense record to 'approved'
      const updatedExpense = await tx.expense.update({
        where: { id: expense.id },
        data: {
          status: 'approved',
          approvedBy: user.name || user.email || user.userId || 'system',
        },
        include: { category: true },
      });

      // 5. Record Audit Log inside the transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'APPROVE_EXPENSE',
        entityType: 'Expense',
        entityId: expense.id,
        oldValues: { status: 'pending', createdBy: expense.createdBy },
        newValues: {
          status: 'approved',
          approvedBy: updatedExpense.approvedBy,
          isSelfApprovalOverride: isCreator,
          ledgerEntryId: ledgerEntry.id,
          amount: dAmount.toNumber(),
          currency: cur,
        },
        reason: isCreator
          ? `اعتماد استثنائي من مدير النظام لمصروف أنشأه بنفسه (Override Approval): ${expense.expenseNumber}`
          : `اعتماد مصروف تشغيلي وترحيله للدفتر العام: ${expense.expenseNumber}`,
        tx,
      });

      return { updatedExpense, ledgerEntry, lockedSafe, lockedExp };
    });

    return NextResponse.json({
      success: true,
      message: `تم اعتماد المصروف بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur} وخصمه من ${result.lockedSafe.name} وترحيل القيد للدفتر العام بنجاح`,
      data: {
        ...result.updatedExpense,
        amount: dAmount.toNumber(),
        account: result.lockedSafe,
        ledgerEntry: result.ledgerEntry,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء اعتماد المصروف' }, { status: 500 });
  }
}
