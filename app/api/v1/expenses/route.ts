import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const currency = searchParams.get('currency');
  const categoryId = searchParams.get('categoryId');
  const accountId = searchParams.get('accountId');
  const status = searchParams.get('status');
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  const search = searchParams.get('search');

  const whereClause: any = {};

  if (currency) whereClause.currency = currency.toUpperCase();
  if (categoryId) whereClause.categoryId = categoryId;
  if (accountId) whereClause.accountId = accountId;
  if (status) whereClause.status = status;

  if (fromDate || toDate) {
    whereClause.expenseDate = {};
    if (fromDate) whereClause.expenseDate.gte = fromDate;
    if (toDate) whereClause.expenseDate.lte = toDate;
  }

  if (search) {
    whereClause.OR = [
      { expenseNumber: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { createdBy: { contains: search, mode: 'insensitive' } },
    ];
  }

  // 1. Fetch expenses with category
  const rawExpenses = await prisma.expense.findMany({
    where: whereClause,
    include: { category: true },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });

  // 2. Enrich with paying account information
  const accountIds = Array.from(new Set(rawExpenses.map((e) => e.accountId)));
  const payingAccounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, accountCode: true, name: true, currency: true, accountType: true },
  });
  const accountMap = new Map(payingAccounts.map((a) => [a.id, a]));

  // 3. Fetch linked ledger entries for reference
  const expenseNumbers = rawExpenses.map((e) => e.expenseNumber);
  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: {
      referenceType: 'Expense',
      referenceId: { in: expenseNumbers },
    },
    include: { lines: true },
  });
  const ledgerMap = new Map<string, any[]>();
  for (const entry of ledgerEntries) {
    if (entry.referenceId) {
      if (!ledgerMap.has(entry.referenceId)) ledgerMap.set(entry.referenceId, []);
      ledgerMap.get(entry.referenceId)!.push(entry);
    }
  }

  const enrichedExpenses = rawExpenses.map((exp) => ({
    ...exp,
    amount: Number(exp.amount),
    account: accountMap.get(exp.accountId) || null,
    ledgerEntries: ledgerMap.get(exp.expenseNumber) || [],
  }));

  // 4. Calculate isolated summary per currency (strictly approved expenses)
  const expensesByCurrency: Record<string, number> = {};
  const allApproved = rawExpenses.filter((e) => e.status === 'approved');
  for (const exp of allApproved) {
    const cur = exp.currency;
    const dAmt = new Decimal(exp.amount.toString());
    expensesByCurrency[cur] = (expensesByCurrency[cur] || 0) + dAmt.toNumber();
  }

  return NextResponse.json({
    success: true,
    data: enrichedExpenses,
    summary: {
      totalCount: rawExpenses.length,
      approvedCount: allApproved.length,
      cancelledCount: rawExpenses.filter((e) => e.status === 'cancelled').length,
      expensesByCurrency,
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can create/approve expenses
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتسجيل واعتماد المصروفات. الصلاحية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { categoryId, accountId, amount, currency, expenseDate, description, receiptStorageKey } = body;

    // 1. Validations
    if (!categoryId) {
      return NextResponse.json({ error: 'تصنيف المصروف مطلوب' }, { status: 400 });
    }

    if (!accountId) {
      return NextResponse.json({ error: 'الصندوق أو الحساب المالي المدفوع منه مطلوب' }, { status: 400 });
    }

    // Decimal Amount validation
    let dAmount: Decimal;
    try {
      dAmount = new Decimal(amount);
    } catch {
      return NextResponse.json({ error: 'قيمة مبلغ المصروف غير صالحة' }, { status: 400 });
    }

    if (!dAmount.isFinite() || dAmount.isNaN() || dAmount.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'مبلغ المصروف يجب أن يكون رقماً موجباً أكبر من الصفر' }, { status: 400 });
    }

    if (dAmount.greaterThan(10000000000)) {
      return NextResponse.json({ error: 'مبلغ المصروف يتجاوز الحد الأقصى المسموح به' }, { status: 400 });
    }

    // 2. Fetch and validate category
    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.status !== 'active') {
      return NextResponse.json({ error: 'تصنيف المصروف المحدد غير موجود أو غير نشط' }, { status: 404 });
    }

    // 3. Fetch and validate paying safe account
    const safeAccount = await prisma.account.findUnique({ where: { id: accountId } });
    if (!safeAccount) {
      return NextResponse.json({ error: 'الحساب المالي المخصوم منه غير موجود' }, { status: 404 });
    }

    const ALLOWED_SAFE_TYPES = ['cash_safe', 'bank', 'bankak', 'employee_custody'];
    if (!ALLOWED_SAFE_TYPES.includes(safeAccount.accountType)) {
      return NextResponse.json(
        { error: 'يجب اختيار خزينة نقدية، حساب بنكي، حساب بنكك، أو عهدة لصرف المصروف' },
        { status: 400 }
      );
    }

    if (safeAccount.status !== 'active') {
      return NextResponse.json({ error: `الحساب المالي (${safeAccount.name}) غير نشط أو معطل` }, { status: 400 });
    }

    // Prevent clearing or settlement account misuse
    if (['1060', '1065'].includes(safeAccount.accountCode) || safeAccount.accountType === 'clearing') {
      return NextResponse.json({ error: 'لا يمكن صرف المصروفات من حسابات المقاصة والوساطة المعلقة' }, { status: 400 });
    }

    const cur = safeAccount.currency;
    if (currency && currency.toUpperCase() !== cur) {
      return NextResponse.json(
        { error: `عملة المصروف (${currency}) لا تطابق عملة الصندوق المخصوم منه (${cur})` },
        { status: 400 }
      );
    }

    const dateStr = getSystemBusinessDate(expenseDate);
    await assertBusinessDateOpen(dateStr);
    const desc = description?.trim() || `مصروف تشغيلي: ${category.name}`;

    // 4. Execute atomic transaction with Row-Level Locks and Double-Entry Ledger Posting
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify that the business date is open and not frozen
      await assertBusinessDateOpen(dateStr, tx);

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

      // Lock both accounts in deterministic sorted order to prevent deadlocks and race conditions
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

      // Generate unique serial expense number
      const expenseCount = await tx.expense.count();
      const expenseNumber = `EXP-${Date.now()}-${expenseCount + 1}`;

      // Post Balanced Double-Entry:
      // Debit: Operating Expense 5xxx (increases expense)
      // Credit: Safe / Bank Account (decreases cash asset)
      const ledgerEntry = await postLedgerTransaction({
        entryType: 'operating_expense',
        referenceType: 'Expense',
        referenceId: expenseNumber,
        entryDate: dateStr,
        description: `صرف مصروف ${category.name}: ${desc}`,
        createdBy: user.name || user.email || user.userId || 'system',
        tx,
        lines: [
          {
            accountId: lockedExp.id,
            currency: cur,
            debit: dAmount.toNumber(),
            credit: 0,
            description: `مصروف تشغيلي - ${category.name}`,
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

      // Create Expense record
      const newExpense = await tx.expense.create({
        data: {
          expenseNumber,
          categoryId: category.id,
          accountId: lockedSafe.id,
          amount: dAmount.toNumber(),
          currency: cur,
          expenseDate: dateStr,
          description: desc,
          receiptStorageKey: receiptStorageKey || null,
          status: 'approved',
          createdBy: user.name || user.email || user.userId || 'system',
          approvedBy: user.name || user.email || user.userId || 'system',
        },
        include: { category: true },
      });

      // Record Audit Log inside the same atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'RECORD_EXPENSE',
        entityType: 'Expense',
        entityId: newExpense.id,
        newValues: {
          expenseNumber: newExpense.expenseNumber,
          category: category.name,
          amount: dAmount.toNumber(),
          currency: cur,
          paidFromAccount: lockedSafe.name,
          expenseAccount: lockedExp.accountCode,
          expenseDate: dateStr,
        },
        reason: `تسجيل مصروف ${category.name} بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur}`,
        tx,
      });

      return { newExpense, ledgerEntry, lockedSafe, lockedExp, cur };
    });

    return NextResponse.json(
      {
        success: true,
        message: `تم صرف واعتماد المصروف بمبلغ ${dAmount.toNumber().toLocaleString()} ${result.cur} وترحيل القيد بنجاح`,
        data: {
          ...result.newExpense,
          amount: dAmount.toNumber(),
          account: {
            id: result.lockedSafe.id,
            name: result.lockedSafe.name,
            accountCode: result.lockedSafe.accountCode,
            currency: result.cur,
          },
          ledgerEntry: result.ledgerEntry,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تسجيل المصروف' }, { status: 500 });
  }
}
