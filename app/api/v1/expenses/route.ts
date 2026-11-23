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
      pendingCount: rawExpenses.filter((e) => e.status === 'pending').length,
      cancelledCount: rawExpenses.filter((e) => e.status === 'cancelled' || e.status === 'rejected').length,
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

    // 4. Record Expense in 'pending' status without financial/ledger impact
    // Segregation of Duties (SoD): Expenses must be approved by an authorized user before posting to Ledger
    const expenseCount = await prisma.expense.count();
    const expenseNumber = `EXP-${Date.now()}-${expenseCount + 1}`;

    const newExpense = await prisma.expense.create({
      data: {
        expenseNumber,
        categoryId: category.id,
        accountId: safeAccount.id,
        amount: dAmount.toNumber(),
        currency: cur,
        expenseDate: dateStr,
        description: desc,
        receiptStorageKey: receiptStorageKey || null,
        status: 'pending',
        createdBy: user.name || user.email || user.userId || 'system',
        approvedBy: null,
      },
      include: { category: true },
    });

    // Record Audit Log for the creation event
    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_EXPENSE_PENDING',
      entityType: 'Expense',
      entityId: newExpense.id,
      newValues: {
        expenseNumber: newExpense.expenseNumber,
        category: category.name,
        amount: dAmount.toNumber(),
        currency: cur,
        paidFromAccount: safeAccount.name,
        expenseDate: dateStr,
        status: 'pending',
      },
      reason: `تسجيل مصروف ${category.name} بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur} - معلق للاعتماد (Pending Approval)`,
    });

    return NextResponse.json(
      {
        success: true,
        message: `تم تسجيل المصروف بنجاح وهو معلق للاعتماد (Pending Approval) بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur}، بانتظار الاعتماد المستقل للترحيل للدفتر العام`,
        data: {
          ...newExpense,
          amount: dAmount.toNumber(),
          account: {
            id: safeAccount.id,
            name: safeAccount.name,
            accountCode: safeAccount.accountCode,
            currency: cur,
          },
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تسجيل المصروف' }, { status: 500 });
  }
}
