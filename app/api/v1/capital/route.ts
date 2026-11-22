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

  // 1. Fetch all capital accounts (Equity class 3xxx)
  const capitalAccounts = await prisma.account.findMany({
    where: { accountType: 'capital' },
    orderBy: { accountCode: 'asc' },
  });

  // 2. Fetch all cash & bank accounts to determine actual liquid assets per currency
  const liquidAccounts = await prisma.account.findMany({
    where: {
      accountType: { in: ['cash_safe', 'bank', 'bankak', 'employee_custody'] },
      status: 'active',
      NOT: { accountCode: { in: ['1060', '1065'] } }, // Exclude transit clearing
    },
  });

  // 3. Fetch profit/loss and expense lines to compute net period profit per currency
  const plAccounts = await prisma.account.findMany({
    where: { accountType: { in: ['profit_loss', 'expense'] } },
    include: { ledgerLines: true },
  });

  // Calculate Net Profit per currency
  const netProfitByCurrency: Record<string, Decimal> = {};
  for (const acc of plAccounts) {
    const cur = acc.currency;
    if (!netProfitByCurrency[cur]) netProfitByCurrency[cur] = new Decimal(0);
    const sumCredit = acc.ledgerLines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    const sumDebit = acc.ledgerLines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    if (acc.accountType === 'profit_loss') {
      // Income: Credit normal (Credit - Debit)
      netProfitByCurrency[cur] = netProfitByCurrency[cur].plus(sumCredit.minus(sumDebit));
    } else {
      // Expense: Debit normal (Debit - Credit reduces profit)
      netProfitByCurrency[cur] = netProfitByCurrency[cur].minus(sumDebit.minus(sumCredit));
    }
  }

  // Calculate Liquid Assets per currency
  const liquidityByCurrency: Record<string, Decimal> = {};
  for (const acc of liquidAccounts) {
    const cur = acc.currency;
    if (!liquidityByCurrency[cur]) liquidityByCurrency[cur] = new Decimal(0);
    liquidityByCurrency[cur] = liquidityByCurrency[cur].plus(new Decimal(acc.currentBalance.toString()));
  }

  // Structure Equity per currency
  const capitalByCurrency: Record<string, number> = {};
  const equityStructure: Record<string, {
    currency: string;
    investedCapital: number;
    netProfit: number;
    totalEquity: number;
    availableLiquidity: number;
    accountCode: string;
    accountId: string;
  }> = {};

  for (const capAcc of capitalAccounts) {
    const cur = capAcc.currency;
    const invCap = new Decimal(capAcc.currentBalance.toString());
    const profit = netProfitByCurrency[cur] || new Decimal(0);
    const equity = invCap.plus(profit);
    const liq = liquidityByCurrency[cur] || new Decimal(0);

    capitalByCurrency[cur] = invCap.toNumber();
    equityStructure[cur] = {
      currency: cur,
      investedCapital: invCap.toNumber(),
      netProfit: profit.toNumber(),
      totalEquity: equity.toNumber(),
      availableLiquidity: liq.toNumber(),
      accountCode: capAcc.accountCode,
      accountId: capAcc.id,
    };
  }

  // 4. Fetch capital transactions with associated account details
  const rawTransactions = await prisma.capitalTransaction.findMany({
    orderBy: { createdAt: 'desc' },
  });

  // Enrich transactions with account names
  const accountIds = Array.from(new Set(rawTransactions.map((t) => t.accountId)));
  const relatedAccounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, name: true, accountCode: true, currency: true },
  });
  const accountMap = new Map(relatedAccounts.map((a) => [a.id, a]));

  const enrichedTransactions = rawTransactions.map((tx) => ({
    ...tx,
    amount: Number(tx.amount),
    account: accountMap.get(tx.accountId) || null,
  }));

  // Backward-compatible EGP capital
  const egpCapital = capitalByCurrency['EGP'] || 0;

  return NextResponse.json({
    success: true,
    currentCapital: egpCapital,
    capitalByCurrency,
    equityStructure,
    data: enrichedTransactions,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin can modify, inject, or withdraw capital
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'صلاحية تعديل وسحب أو ضخ رأس المال مخصصة لمدير النظام فقط' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { transactionType, accountId, amount, description, transactionDate, businessDate } = body;
    const capitalDateStr = getSystemBusinessDate(transactionDate || businessDate);
    await assertBusinessDateOpen(capitalDateStr);

    // 1. Validate Transaction Type
    const ALLOWED_TYPES = ['addition', 'initial_capital', 'withdrawal', 'personal_draw'];
    if (!transactionType || !ALLOWED_TYPES.includes(transactionType)) {
      return NextResponse.json(
        { error: `نوع المعاملة غير صالح. الأنواع المسموحة: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!accountId) {
      return NextResponse.json({ error: 'الحساب المالي المستهدف مطلوب' }, { status: 400 });
    }

    // 2. Validate Amount with Decimal precision
    let dAmount: Decimal;
    try {
      dAmount = new Decimal(amount);
    } catch {
      return NextResponse.json({ error: 'قيمة المبلغ غير صالحة' }, { status: 400 });
    }

    if (!dAmount.isFinite() || dAmount.isNaN() || dAmount.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'المبلغ يجب أن يكون رقماً موجباً أكبر من الصفر' }, { status: 400 });
    }

    if (dAmount.greaterThan(100000000000)) {
      return NextResponse.json({ error: 'المبلغ المدخل يتجاوز الحد الأقصى المسموح به' }, { status: 400 });
    }

    // Verify target safe account exists and is valid
    const safeAccount = await prisma.account.findUnique({ where: { id: accountId } });
    if (!safeAccount) {
      return NextResponse.json({ error: 'الحساب المالي المحدد غير موجود' }, { status: 404 });
    }

    if (!['cash_safe', 'bank', 'bankak'].includes(safeAccount.accountType)) {
      return NextResponse.json({ error: 'يجب اختيار خزينة نقدية أو حساب بنكي لتنفيذ حركة رأس المال' }, { status: 400 });
    }

    if (safeAccount.status !== 'active') {
      return NextResponse.json({ error: `الحساب (${safeAccount.name}) غير نشط أو معطل` }, { status: 400 });
    }

    const cur = safeAccount.currency;
    const isAddition = transactionType === 'addition' || transactionType === 'initial_capital';

    // 3. Execute atomic transaction with Row-Level Locks
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify that the business date is open and not frozen
      await assertBusinessDateOpen(capitalDateStr, tx);

      // Find or auto-initialize Capital Account matching safe currency
      const capitalCode = cur === 'EGP' ? '3010' : `3010-${cur}`;
      let capitalAcc = await tx.account.findFirst({
        where: { currency: cur, accountType: { in: ['capital', 'equity'] } },
      });

      if (!capitalAcc) {
        capitalAcc = await tx.account.upsert({
          where: { accountCode: capitalCode },
          create: {
            accountCode: capitalCode,
            name: `رأس المال (${cur})`,
            accountType: 'capital',
            currency: cur,
            openingBalance: 0,
            currentBalance: 0,
            isSystem: true,
            status: 'active',
          },
          update: {},
        });
      }

      // Lock both accounts in deterministic sorted order to prevent deadlocks
      const sortedIds = [safeAccount.id, capitalAcc.id].sort();
      const lockedFirst = (await tx.$queryRawUnsafe(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
        sortedIds[0]
      )) as any[];
      const lockedSecond = (await tx.$queryRawUnsafe(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
        sortedIds[1]
      )) as any[];

      const accountMap = new Map<string, any>();
      accountMap.set(sortedIds[0], lockedFirst[0]);
      accountMap.set(sortedIds[1], lockedSecond[0]);

      const lockedSafe = accountMap.get(safeAccount.id);
      const lockedCapital = accountMap.get(capitalAcc.id);

      const dSafeBal = new Decimal(lockedSafe.currentBalance.toString());
      const dCapitalBal = new Decimal(lockedCapital.currentBalance.toString());

      // If withdrawal, verify sufficiency of safe balance and capital balance
      if (!isAddition) {
        if (dSafeBal.lessThan(dAmount)) {
          throw new Error(
            `رصيد الحساب المالي (${lockedSafe.name}) غير كافٍ لسحب رأس المال. المتاح: ${dSafeBal.toFixed(2)} ${cur}، والمطلوب: ${dAmount.toFixed(2)} ${cur}`
          );
        }
        if (dCapitalBal.lessThan(dAmount)) {
          throw new Error(
            `رصيد رأس المال المستثمر (${lockedCapital.name}) غير كافٍ للسحب. الرصيد المتاح: ${dCapitalBal.toFixed(2)} ${cur}، والمطلوب سحبه: ${dAmount.toFixed(2)} ${cur}`
          );
        }
      }

      // Post balanced double-entry ledger transaction
      const desc = description?.trim() || (isAddition
        ? `إضافة رأس مال بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur} في ${lockedSafe.name}`
        : `سحب رأس مال بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur} من ${lockedSafe.name}`);

      await postLedgerTransaction({
        entryType: isAddition ? 'capital_addition' : 'capital_withdrawal',
        referenceType: 'CapitalTransaction',
        entryDate: capitalDateStr,
        description: desc,
        createdBy: user.name || user.email || user.userId || 'admin',
        tx,
        lines: [
          {
            accountId: isAddition ? lockedSafe.id : lockedCapital.id,
            currency: cur,
            debit: dAmount.toNumber(),
            credit: 0,
            description: isAddition ? `إيداع رأس مال في ${lockedSafe.name}` : `تخفيض رأس المال المستثمر`,
          },
          {
            accountId: isAddition ? lockedCapital.id : lockedSafe.id,
            currency: cur,
            debit: 0,
            credit: dAmount.toNumber(),
            description: isAddition ? 'زيادة رأس المال المستثمر' : `سحب نقدي من ${lockedSafe.name}`,
          },
        ],
      });

      // Create CapitalTransaction record
      const capitalTx = await tx.capitalTransaction.create({
        data: {
          transactionType,
          accountId: lockedSafe.id,
          currency: cur,
          amount: dAmount.toNumber(),
          transactionDate: new Date().toISOString().split('T')[0],
          description: desc,
          createdBy: user.name || user.email || user.userId || 'admin',
        },
      });

      // Record Audit Log inside the same atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: isAddition ? 'CAPITAL_ADD' : 'CAPITAL_WITHDRAW',
        entityType: 'CapitalTransaction',
        entityId: capitalTx.id,
        newValues: {
          id: capitalTx.id,
          amount: dAmount.toNumber(),
          currency: cur,
          type: transactionType,
          account: lockedSafe.name,
          capitalAccount: lockedCapital.accountCode,
        },
        reason: description || (isAddition ? 'إضافة رأس مال' : 'سحب رأس مال'),
        tx,
      });

      return { capitalTx, lockedSafe, lockedCapital, cur };
    });

    return NextResponse.json(
      {
        success: true,
        message: isAddition
          ? `تم إيداع وتوثيق إضافة رأس المال بمبلغ ${dAmount.toNumber().toLocaleString()} ${result.cur} بنجاح`
          : `تم خصم وتوثيق سحب رأس المال بمبلغ ${dAmount.toNumber().toLocaleString()} ${result.cur} بنجاح`,
        data: {
          ...result.capitalTx,
          amount: dAmount.toNumber(),
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في معالجة رأس المال' }, { status: 500 });
  }
}
