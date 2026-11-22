import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import Decimal from 'decimal.js';

/**
 * Generate standard Chart of Accounts code based on accountType
 */
async function generateAccountCode(accountType: string): Promise<string> {
  let prefix = '1'; // Default asset
  if (['cash_safe', 'bank', 'bankak', 'employee_custody', 'clearing', 'receivable'].includes(accountType)) {
    prefix = '1';
  } else if (['supplier_liability', 'customer_liability', 'payable'].includes(accountType)) {
    prefix = '2';
  } else if (['capital', 'equity', 'retained_earnings'].includes(accountType)) {
    prefix = '3';
  } else if (['profit_loss', 'revenue', 'income'].includes(accountType)) {
    prefix = '4';
  } else if (['expense'].includes(accountType)) {
    prefix = '5';
  }

  // Find all accounts starting with this prefix
  const existing = await prisma.account.findMany({
    where: { accountCode: { startsWith: prefix } },
    select: { accountCode: true },
  });

  const numericCodes = existing
    .map((a) => parseInt(a.accountCode.replace(/[^0-9]/g, ''), 10))
    .filter((n) => !isNaN(n) && n >= parseInt(prefix + '000', 10) && n < parseInt(prefix + '999', 10));

  let nextNum = parseInt(prefix + '050', 10);
  if (numericCodes.length > 0) {
    nextNum = Math.max(...numericCodes) + 10;
  }
  return nextNum.toString();
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const accountType = searchParams.get('accountType');
  const currency = searchParams.get('currency');
  const status = searchParams.get('status');
  const search = searchParams.get('search')?.trim();

  const whereClause: any = {};
  if (accountType && accountType !== 'all') whereClause.accountType = accountType;
  if (currency && currency !== 'all') whereClause.currency = currency.toUpperCase();
  if (status && status !== 'all') whereClause.status = status;
  if (search) {
    whereClause.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { accountCode: { contains: search, mode: 'insensitive' } },
      { currency: { contains: search, mode: 'insensitive' } },
    ];
  }

  const accounts = await prisma.account.findMany({
    where: whereClause,
    orderBy: { accountCode: 'asc' },
    include: {
      parentAccount: {
        select: { id: true, accountCode: true, name: true },
      },
      childAccounts: {
        select: { id: true, accountCode: true, name: true, currentBalance: true, currency: true },
      },
      ledgerLines: {
        select: {
          debit: true,
          credit: true,
          ledgerEntry: {
            select: { entryType: true },
          },
        },
      },
    },
  });

  // Calculate detailed financial metrics per account and verify ledger reconciliation
  const currencyTotals: Record<string, { totalCash: Decimal; accountCount: number }> = {};

  const accountsWithMetrics = accounts.map((acc) => {
    let sumDebit = new Decimal(0);
    let sumCredit = new Decimal(0);
    let hasOpeningLedgerEntry = false;

    for (const line of acc.ledgerLines) {
      sumDebit = sumDebit.plus(new Decimal(line.debit.toString()));
      sumCredit = sumCredit.plus(new Decimal(line.credit.toString()));
      if (line.ledgerEntry?.entryType === 'opening_balance') {
        hasOpeningLedgerEntry = true;
      }
    }

    const dOpening = new Decimal(acc.openingBalance.toString());
    const isDebitNormal = ['cash_safe', 'bank', 'bankak', 'employee_custody', 'expense', 'clearing', 'receivable'].includes(acc.accountType);
    
    // If opening balance was formally posted via an opening_balance ledger entry, it is already in sumDebit/sumCredit.
    // Otherwise (legacy accounts), add dOpening as base.
    const baseAmount = hasOpeningLedgerEntry ? new Decimal(0) : dOpening;
    const calculatedLedgerBalance = isDebitNormal
      ? baseAmount.plus(sumDebit).minus(sumCredit)
      : baseAmount.plus(sumCredit).minus(sumDebit);

    const dCurrent = new Decimal(acc.currentBalance.toString());
    const isReconciled = calculatedLedgerBalance.minus(dCurrent).abs().lessThanOrEqualTo(0.01);

    // Track total cash in safes / banks per currency
    if (['cash_safe', 'bank', 'bankak'].includes(acc.accountType) && acc.status === 'active') {
      if (!currencyTotals[acc.currency]) {
        currencyTotals[acc.currency] = { totalCash: new Decimal(0), accountCount: 0 };
      }
      currencyTotals[acc.currency].totalCash = currencyTotals[acc.currency].totalCash.plus(dCurrent);
      currencyTotals[acc.currency].accountCount += 1;
    }

    return {
      id: acc.id,
      accountCode: acc.accountCode,
      name: acc.name,
      description: acc.description,
      accountType: acc.accountType,
      currency: acc.currency,
      parentAccountId: acc.parentAccountId,
      parentAccount: acc.parentAccount,
      childAccounts: acc.childAccounts,
      openingBalance: dOpening.toNumber(),
      currentBalance: dCurrent.toNumber(),
      totalDebit: sumDebit.toNumber(),
      totalCredit: sumCredit.toNumber(),
      calculatedLedgerBalance: calculatedLedgerBalance.toNumber(),
      isReconciled,
      isSystem: acc.isSystem,
      status: acc.status,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    };
  });

  // Format currency summary
  const summaryByCurrency = Object.entries(currencyTotals).map(([cur, data]) => ({
    currency: cur,
    totalLiquidBalance: data.totalCash.toNumber(),
    accountCount: data.accountCount,
  }));

  return NextResponse.json({
    success: true,
    data: accountsWithMetrics,
    summaryByCurrency,
    totalAccounts: accountsWithMetrics.length,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية إنشاء الصناديق والحسابات المالية مقتصرة على المدير والمحاسب' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const {
      name,
      accountCode,
      accountType,
      currency,
      openingBalance = 0,
      parentAccountId,
      description,
      counterAccountId,
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'اسم الصندوق أو الحساب مطلوب' }, { status: 400 });
    }

    if (!accountType) {
      return NextResponse.json({ error: 'نوع الحساب مطلوب' }, { status: 400 });
    }

    const cur = (currency || 'EGP').toUpperCase().trim();
    const dOpening = new Decimal(openingBalance || 0);

    if (dOpening.isNegative()) {
      return NextResponse.json({ error: 'الرصيد الافتتاحي لا يمكن أن يكون سالباً' }, { status: 400 });
    }

    // Code resolution: auto-generate or validate unique custom code
    let finalCode = accountCode?.trim();
    if (!finalCode) {
      finalCode = await generateAccountCode(accountType);
    } else {
      const existingCode = await prisma.account.findUnique({ where: { accountCode: finalCode } });
      if (existingCode) {
        return NextResponse.json(
          { error: `كود الحساب ${finalCode} مستخدم بالفعل لحساب آخر. يرجى اختيار كود فريد` },
          { status: 400 }
        );
      }
    }

    // Name uniqueness check for same currency and type
    const duplicateName = await prisma.account.findFirst({
      where: {
        name: name.trim(),
        currency: cur,
      },
    });
    if (duplicateName) {
      return NextResponse.json(
        { error: `يوجد حساب آخر مسجل بنفس الاسم (${name.trim()}) لنفس العملة (${cur})` },
        { status: 400 }
      );
    }

    // Execute atomic creation & opening balance ledger posting
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Account
      const newAcc = await tx.account.create({
        data: {
          accountCode: finalCode,
          name: name.trim(),
          description: description?.trim() || null,
          accountType,
          currency: cur,
          parentAccountId: parentAccountId || null,
          openingBalance: dOpening.toNumber(),
          currentBalance: 0, // Will be incremented via postLedgerTransaction if opening balance > 0
          isSystem: false,
          status: 'active',
        },
      });

      // 2. If Opening Balance > 0, post balanced opening ledger entry against Capital / Equity
      if (dOpening.greaterThan(0)) {
        // Locate counter account (Capital account 3010 in same currency, or provided counter account)
        let counterAcc = counterAccountId
          ? await tx.account.findUnique({ where: { id: counterAccountId } })
          : await tx.account.findFirst({
              where: {
                accountType: { in: ['capital', 'equity'] },
                currency: cur,
              },
            });

        if (!counterAcc) {
          // Auto-initialize Capital account for this currency if not present
          const capitalCode = cur === 'EGP' ? '3010' : `3010-${cur}`;
          counterAcc = await tx.account.upsert({
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

        const isDebitNormal = ['cash_safe', 'bank', 'bankak', 'employee_custody', 'expense', 'clearing', 'receivable'].includes(accountType);

        await postLedgerTransaction({
          entryType: 'opening_balance',
          referenceType: 'Account',
          referenceId: newAcc.id,
          description: `قيد رصيد افتتاحي معتمد للصندوق/الحساب ${newAcc.name} بمبلغ ${dOpening.toNumber().toLocaleString()} ${cur}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: newAcc.id,
              currency: cur,
              debit: isDebitNormal ? dOpening.toNumber() : 0,
              credit: isDebitNormal ? 0 : dOpening.toNumber(),
              description: `إثبات رصيد افتتاحي للصندوق ${newAcc.name}`,
            },
            {
              accountId: counterAcc.id,
              currency: cur,
              debit: isDebitNormal ? 0 : dOpening.toNumber(),
              credit: isDebitNormal ? dOpening.toNumber() : 0,
              description: `المقابل لرأس المال / الرصيد الافتتاحي`,
            },
          ],
        });
      }

      // Fetch fresh updated account with confirmed balance
      return await tx.account.findUnique({ where: { id: newAcc.id } });
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_ACCOUNT',
      entityType: 'Account',
      entityId: result!.id,
      newValues: {
        accountCode: result!.accountCode,
        name: result!.name,
        accountType: result!.accountType,
        currency: result!.currency,
        openingBalance: result!.openingBalance,
        currentBalance: result!.currentBalance,
      },
      reason: `إنشاء حساب أو صندوق مالي جديد (${result!.name}) برصيد افتتاحي ${dOpening.toNumber().toLocaleString()} ${cur}`,
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء الحساب المالي' }, { status: 500 });
  }
}
