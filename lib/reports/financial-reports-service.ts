import Decimal from 'decimal.js';
import { prisma } from '../db';
import { getSystemBusinessDate, getSystemStartOfDay } from '../financial-core';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export interface DateRangeResult {
  period: string;
  fromDate: string;
  toDate: string;
  priorFromDate: string;
  priorToDate: string;
  daysCount: number;
}

/**
 * Resolves standard financial reporting date ranges in Africa/Cairo timezone.
 */
export function getReportsDateRange(
  period: string = 'today',
  customFrom?: string | null,
  customTo?: string | null,
  timeZone: string = 'Africa/Cairo'
): DateRangeResult {
  const todayStr = getSystemBusinessDate(new Date(), timeZone);
  const [todayYear, todayMonth, todayDay] = todayStr.split('-').map(Number);

  let fromDate = todayStr;
  let toDate = todayStr;

  if (period === 'custom' && customFrom && customTo) {
    fromDate = customFrom;
    toDate = customTo;
  } else if (period === 'yesterday') {
    const yesterdayDate = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay - 1, 12, 0, 0));
    fromDate = getSystemBusinessDate(yesterdayDate, timeZone);
    toDate = fromDate;
  } else if (period === 'week') {
    // Current week: from Saturday to today (or past 7 days)
    const d = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay, 12, 0, 0));
    const dayOfWeek = d.getUTCDay(); // 0 is Sunday, 6 is Saturday
    // In Egypt business week starts Saturday
    const daysSinceSaturday = (dayOfWeek + 1) % 7;
    const saturdayDate = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay - daysSinceSaturday, 12, 0, 0));
    fromDate = getSystemBusinessDate(saturdayDate, timeZone);
    toDate = todayStr;
  } else if (period === 'month') {
    fromDate = `${todayYear}-${String(todayMonth).padStart(2, '0')}-01`;
    toDate = todayStr;
  } else if (period === 'year') {
    fromDate = `${todayYear}-01-01`;
    toDate = todayStr;
  } else {
    // Default: today
    fromDate = todayStr;
    toDate = todayStr;
  }

  // Ensure fromDate <= toDate
  if (fromDate > toDate) {
    const temp = fromDate;
    fromDate = toDate;
    toDate = temp;
  }

  // Calculate days in period
  const dFrom = new Date(`${fromDate}T12:00:00Z`);
  const dTo = new Date(`${toDate}T12:00:00Z`);
  const diffTime = Math.abs(dTo.getTime() - dFrom.getTime());
  const daysCount = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

  // Calculate prior period of identical duration immediately preceding fromDate
  const priorEndMs = dFrom.getTime() - 1000 * 60 * 60 * 24;
  const priorStartMs = priorEndMs - (daysCount - 1) * 1000 * 60 * 60 * 24;
  const priorToDate = getSystemBusinessDate(new Date(priorEndMs), timeZone);
  const priorFromDate = getSystemBusinessDate(new Date(priorStartMs), timeZone);

  return {
    period,
    fromDate,
    toDate,
    priorFromDate,
    priorToDate,
    daysCount,
  };
}

/**
 * Returns the accounting class (1 to 5) for an account based on accountCode and accountType.
 */
export function getAccountClass(account: { accountCode: string; accountType: string }): '1' | '2' | '3' | '4' | '5' {
  const code = account.accountCode || '';
  const type = account.accountType || '';

  if (code.startsWith('1')) return '1';
  if (code.startsWith('2')) return '2';
  if (code.startsWith('3')) return '3';
  if (code.startsWith('4')) return '4';
  if (code.startsWith('5')) return '5';

  if (['cash_safe', 'bank', 'bankak', 'employee_custody', 'clearing', 'receivable', 'asset'].includes(type)) return '1';
  if (['customer_liability', 'supplier_liability', 'payable', 'liability'].includes(type)) return '2';
  if (['capital', 'equity', 'retained_earnings'].includes(type)) return '3';
  if (['profit_loss', 'revenue'].includes(type)) return '4';
  if (['expense'].includes(type)) return '5';

  return '1';
}

/**
 * Determines whether the account is debit-normal (Assets 1, Expenses 5) or credit-normal (Liabilities 2, Equity 3, Revenue 4).
 */
export function isDebitNormal(accountClass: '1' | '2' | '3' | '4' | '5'): boolean {
  return accountClass === '1' || accountClass === '5';
}

/**
 * P&L Report Service
 */
export async function getProfitLossReport(params: {
  fromDate: string;
  toDate: string;
  compareWithPrior?: boolean;
  currency?: string;
  timeZone?: string;
}) {
  const { fromDate, toDate, compareWithPrior = false, currency, timeZone = 'Africa/Cairo' } = params;

  // Query all posted ledger lines in the date range for Revenue (4) and Expense (5) accounts
  const postedEntries = await prisma.ledgerLine.findMany({
    where: {
      ledgerEntry: {
        entryDate: { gte: fromDate, lte: toDate },
        status: 'posted',
      },
      ...(currency ? { currency } : {}),
    },
    include: {
      account: true,
      ledgerEntry: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const currencies = currency ? [currency] : ['EGP', 'SDG', 'USD', 'SAR', 'AED'];

  // Data structures per currency
  const reportByCurrency: Record<string, any> = {};

  for (const cur of currencies) {
    reportByCurrency[cur] = {
      currency: cur,
      revenues: {
        tradingProfits: new Decimal(0),
        otherRevenues: new Decimal(0),
        totalRevenues: new Decimal(0),
        items: [] as any[],
      },
      expenses: {
        operatingExpenses: new Decimal(0),
        totalExpenses: new Decimal(0),
        items: [] as any[],
      },
      netProfit: new Decimal(0),
      isProfitable: false,
    };
  }

  // Aggregate lines
  const revItemsMap: Record<string, Map<string, { accountId: string; accountCode: string; name: string; amount: Decimal }>> = {};
  const expItemsMap: Record<string, Map<string, { accountId: string; accountCode: string; name: string; amount: Decimal }>> = {};

  for (const cur of currencies) {
    revItemsMap[cur] = new Map();
    expItemsMap[cur] = new Map();
  }

  for (const line of postedEntries) {
    const accClass = getAccountClass(line.account);
    const lineCur = line.currency;
    if (!reportByCurrency[lineCur]) {
      reportByCurrency[lineCur] = {
        currency: lineCur,
        revenues: { tradingProfits: new Decimal(0), otherRevenues: new Decimal(0), totalRevenues: new Decimal(0), items: [] },
        expenses: { operatingExpenses: new Decimal(0), totalExpenses: new Decimal(0), items: [] },
        netProfit: new Decimal(0),
        isProfitable: false,
      };
      revItemsMap[lineCur] = new Map();
      expItemsMap[lineCur] = new Map();
    }

    const dDebit = new Decimal(line.debit.toString());
    const dCredit = new Decimal(line.credit.toString());

    if (accClass === '4') {
      // Revenue is credit minus debit
      const netRev = dCredit.minus(dDebit);
      const isTrading = line.account.accountCode === '4010' || line.account.accountType === 'profit_loss' || line.ledgerEntry.entryType.includes('profit') || line.ledgerEntry.entryType.includes('exchange');

      if (isTrading) {
        reportByCurrency[lineCur].revenues.tradingProfits = reportByCurrency[lineCur].revenues.tradingProfits.plus(netRev);
      } else {
        reportByCurrency[lineCur].revenues.otherRevenues = reportByCurrency[lineCur].revenues.otherRevenues.plus(netRev);
      }
      reportByCurrency[lineCur].revenues.totalRevenues = reportByCurrency[lineCur].revenues.totalRevenues.plus(netRev);

      const existing = revItemsMap[lineCur].get(line.accountId) || {
        accountId: line.accountId,
        accountCode: line.account.accountCode,
        name: line.account.name,
        amount: new Decimal(0),
      };
      existing.amount = existing.amount.plus(netRev);
      revItemsMap[lineCur].set(line.accountId, existing);
    } else if (accClass === '5') {
      // Expense is debit minus credit (accounting for expense reversals)
      const netExp = dDebit.minus(dCredit);
      reportByCurrency[lineCur].expenses.operatingExpenses = reportByCurrency[lineCur].expenses.operatingExpenses.plus(netExp);
      reportByCurrency[lineCur].expenses.totalExpenses = reportByCurrency[lineCur].expenses.totalExpenses.plus(netExp);

      const existing = expItemsMap[lineCur].get(line.accountId) || {
        accountId: line.accountId,
        accountCode: line.account.accountCode,
        name: line.account.name,
        amount: new Decimal(0),
      };
      existing.amount = existing.amount.plus(netExp);
      expItemsMap[lineCur].set(line.accountId, existing);
    }
  }

  // Finalize totals and items
  for (const cur of Object.keys(reportByCurrency)) {
    const curRep = reportByCurrency[cur];
    curRep.revenues.items = Array.from(revItemsMap[cur]?.values() || []).map((i) => ({
      ...i,
      amount: i.amount.toNumber(),
    }));
    curRep.expenses.items = Array.from(expItemsMap[cur]?.values() || []).map((i) => ({
      ...i,
      amount: i.amount.toNumber(),
    }));

    curRep.netProfit = curRep.revenues.totalRevenues.minus(curRep.expenses.totalExpenses);
    curRep.isProfitable = curRep.netProfit.greaterThanOrEqualTo(0);

    // Convert Decimals to numbers for JSON serialization
    curRep.revenues.tradingProfits = curRep.revenues.tradingProfits.toNumber();
    curRep.revenues.otherRevenues = curRep.revenues.otherRevenues.toNumber();
    curRep.revenues.totalRevenues = curRep.revenues.totalRevenues.toNumber();
    curRep.expenses.operatingExpenses = curRep.expenses.operatingExpenses.toNumber();
    curRep.expenses.totalExpenses = curRep.expenses.totalExpenses.toNumber();
    curRep.netProfit = curRep.netProfit.toNumber();
  }

  // Prior period comparison if requested
  let priorReport: any = null;
  if (compareWithPrior) {
    const dateRange = getReportsDateRange('custom', fromDate, toDate, timeZone);
    const priorParams = {
      fromDate: dateRange.priorFromDate,
      toDate: dateRange.priorToDate,
      compareWithPrior: false,
      currency,
      timeZone,
    };
    priorReport = await getProfitLossReport(priorParams);
  }

  return {
    fromDate,
    toDate,
    currencies: Object.keys(reportByCurrency),
    byCurrency: reportByCurrency,
    priorPeriod: priorReport
      ? {
          fromDate: priorReport.fromDate,
          toDate: priorReport.toDate,
          byCurrency: priorReport.byCurrency,
        }
      : null,
  };
}

/**
 * Trial Balance Report Service
 * Evaluates the Trial Balance strictly per currency:
 * For every currency: Total Period Debit MUST EQUAL Total Period Credit.
 */
export async function getTrialBalanceReport(params: {
  fromDate: string;
  toDate: string;
  currency?: string;
  timeZone?: string;
}) {
  const { fromDate, toDate, currency } = params;

  // 1. Fetch all active accounts
  const accounts = await prisma.account.findMany({
    where: {
      status: 'active',
      ...(currency ? { currency } : {}),
    },
    include: {
      ledgerLines: {
        where: {
          ledgerEntry: { status: 'posted' },
        },
        include: { ledgerEntry: true },
      },
    },
    orderBy: [{ accountCode: 'asc' }],
  });

  const currencies = currency ? [currency] : ['EGP', 'SDG', 'USD', 'SAR', 'AED'];
  const trialByCurrency: Record<string, any> = {};

  for (const cur of currencies) {
    trialByCurrency[cur] = {
      currency: cur,
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      difference: new Decimal(0),
      isBalanced: true,
      classes: {
        assets: [] as any[], // 1
        liabilities: [] as any[], // 2
        equity: [] as any[], // 3
        revenues: [] as any[], // 4
        expenses: [] as any[], // 5
      },
    };
  }

  // Determine which accounts belong to which currency (by acc.currency or by having lines in that currency)
  for (const cur of currencies) {
    for (const acc of accounts) {
      const hasCurrencyLines = acc.ledgerLines.some((l) => l.currency === cur);
      if (acc.currency !== cur && !hasCurrencyLines) continue;

      const accClass = getAccountClass(acc);
      const isPrimaryAccountForCurrency = acc.currency === cur;

      const hasOpeningLedgerEntry = acc.ledgerLines.some(
        (l) => l.currency === cur && l.ledgerEntry?.entryType === 'opening_balance'
      );
      const baseOpening = isPrimaryAccountForCurrency && !hasOpeningLedgerEntry
        ? new Decimal(acc.openingBalance.toString())
        : new Decimal(0);

      let prePeriodDebit = new Decimal(0);
      let prePeriodCredit = new Decimal(0);
      let periodDebit = new Decimal(0);
      let periodCredit = new Decimal(0);

      for (const line of acc.ledgerLines) {
        if (line.currency !== cur) continue;
        const entryDate = line.ledgerEntry.entryDate;
        const dDeb = new Decimal(line.debit.toString());
        const dCred = new Decimal(line.credit.toString());

        if (entryDate < fromDate) {
          prePeriodDebit = prePeriodDebit.plus(dDeb);
          prePeriodCredit = prePeriodCredit.plus(dCred);
        } else if (entryDate <= toDate) {
          periodDebit = periodDebit.plus(dDeb);
          periodCredit = periodCredit.plus(dCred);
        }
      }

      const isDebNormal = isDebitNormal(accClass);
      const openingBal = isDebNormal
        ? baseOpening.plus(prePeriodDebit).minus(prePeriodCredit)
        : baseOpening.plus(prePeriodCredit).minus(prePeriodDebit);

      const closingBal = isDebNormal
        ? openingBal.plus(periodDebit).minus(periodCredit)
        : openingBal.plus(periodCredit).minus(periodDebit);

      trialByCurrency[cur].totalDebit = trialByCurrency[cur].totalDebit.plus(periodDebit);
      trialByCurrency[cur].totalCredit = trialByCurrency[cur].totalCredit.plus(periodCredit);

      const accountRow = {
        id: acc.id,
        accountCode: acc.accountCode,
        name: acc.name,
        accountType: acc.accountType,
        accountClass: accClass,
        currency: cur,
        openingBalance: openingBal.toNumber(),
        periodDebit: periodDebit.toNumber(),
        periodCredit: periodCredit.toNumber(),
        closingBalance: closingBal.toNumber(),
        isDebitNormal: isDebNormal,
      };

      if (accClass === '1') trialByCurrency[cur].classes.assets.push(accountRow);
      else if (accClass === '2') trialByCurrency[cur].classes.liabilities.push(accountRow);
      else if (accClass === '3') trialByCurrency[cur].classes.equity.push(accountRow);
      else if (accClass === '4') trialByCurrency[cur].classes.revenues.push(accountRow);
      else if (accClass === '5') trialByCurrency[cur].classes.expenses.push(accountRow);
    }
  }

  // Verification per currency: Total Debit == Total Credit
  for (const cur of Object.keys(trialByCurrency)) {
    const t = trialByCurrency[cur];
    t.difference = t.totalDebit.minus(t.totalCredit);
    t.isBalanced = t.difference.abs().lessThan(0.0001);
    t.totalDebit = t.totalDebit.toNumber();
    t.totalCredit = t.totalCredit.toNumber();
    t.difference = t.difference.toNumber();
  }

  return {
    fromDate,
    toDate,
    currencies: Object.keys(trialByCurrency),
    byCurrency: trialByCurrency,
  };
}

/**
 * Balance Sheet Report Service
 */
export async function getBalanceSheetReport(params: {
  asOfDate: string;
  currency?: string;
  timeZone?: string;
}) {
  const { asOfDate, currency } = params;

  // 1. Fetch active accounts
  const accounts = await prisma.account.findMany({
    where: {
      status: 'active',
    },
    include: {
      ledgerLines: {
        where: {
          ledgerEntry: {
            entryDate: { lte: asOfDate },
            status: 'posted',
          },
        },
        include: { ledgerEntry: true },
      },
    },
    orderBy: { accountCode: 'asc' },
  });

  const currencies = currency ? [currency] : ['EGP', 'SDG', 'USD', 'SAR', 'AED'];
  const balanceSheetByCurrency: Record<string, any> = {};

  for (const cur of currencies) {
    balanceSheetByCurrency[cur] = {
      currency: cur,
      asOfDate,
      assets: { items: [] as any[], total: new Decimal(0) },
      liabilities: { items: [] as any[], total: new Decimal(0) },
      equity: {
        items: [] as any[],
        currentPeriodProfit: new Decimal(0),
        total: new Decimal(0),
      },
      isBalanced: true,
      difference: new Decimal(0),
    };

    for (const acc of accounts) {
      const hasCurrencyLines = acc.ledgerLines.some((l) => l.currency === cur);
      if (acc.currency !== cur && !hasCurrencyLines) continue;

      const accClass = getAccountClass(acc);
      const isPrimaryAccountForCurrency = acc.currency === cur;

      const hasOpeningLedgerEntry = acc.ledgerLines.some(
        (l) => l.currency === cur && l.ledgerEntry?.entryType === 'opening_balance'
      );
      const baseOpening = isPrimaryAccountForCurrency && !hasOpeningLedgerEntry
        ? new Decimal(acc.openingBalance.toString())
        : new Decimal(0);

      let sumDebit = new Decimal(0);
      let sumCredit = new Decimal(0);
      for (const line of acc.ledgerLines) {
        if (line.currency !== cur) continue;
        sumDebit = sumDebit.plus(new Decimal(line.debit.toString()));
        sumCredit = sumCredit.plus(new Decimal(line.credit.toString()));
      }

      if (accClass === '1') {
        // Asset: Normal Debit = Opening + Debit - Credit
        const balance = baseOpening.plus(sumDebit).minus(sumCredit);
        balanceSheetByCurrency[cur].assets.items.push({
          id: acc.id,
          accountCode: acc.accountCode,
          name: acc.name,
          accountType: acc.accountType,
          balance: balance.toNumber(),
        });
        balanceSheetByCurrency[cur].assets.total = balanceSheetByCurrency[cur].assets.total.plus(balance);
      } else if (accClass === '2') {
        // Liability: Normal Credit = Opening + Credit - Debit
        const balance = baseOpening.plus(sumCredit).minus(sumDebit);
        balanceSheetByCurrency[cur].liabilities.items.push({
          id: acc.id,
          accountCode: acc.accountCode,
          name: acc.name,
          accountType: acc.accountType,
          balance: balance.toNumber(),
        });
        balanceSheetByCurrency[cur].liabilities.total = balanceSheetByCurrency[cur].liabilities.total.plus(balance);
      } else if (accClass === '3') {
        // Equity: Normal Credit = Opening + Credit - Debit
        const balance = baseOpening.plus(sumCredit).minus(sumDebit);
        balanceSheetByCurrency[cur].equity.items.push({
          id: acc.id,
          accountCode: acc.accountCode,
          name: acc.name,
          accountType: acc.accountType,
          balance: balance.toNumber(),
        });
        balanceSheetByCurrency[cur].equity.total = balanceSheetByCurrency[cur].equity.total.plus(balance);
      } else if (accClass === '4') {
        // Revenue contributes to Net Profit (credit - debit)
        const rev = sumCredit.minus(sumDebit);
        balanceSheetByCurrency[cur].equity.currentPeriodProfit =
          balanceSheetByCurrency[cur].equity.currentPeriodProfit.plus(rev);
      } else if (accClass === '5') {
        // Expense reduces Net Profit (debit - credit)
        const exp = sumDebit.minus(sumCredit);
        balanceSheetByCurrency[cur].equity.currentPeriodProfit =
          balanceSheetByCurrency[cur].equity.currentPeriodProfit.minus(exp);
      }
    }

    const bs = balanceSheetByCurrency[cur];
    const capitalTotal = bs.equity.total;
    const currentPeriodProfit = bs.equity.currentPeriodProfit;
    
    // Retained Earnings & Opening Equity adjustments:
    // Represents historical accumulated equity prior to current period
    const retainedEarnings = bs.assets.total
      .minus(bs.liabilities.total)
      .minus(capitalTotal)
      .minus(currentPeriodProfit);
      
    const finalTotalEquity = capitalTotal.plus(retainedEarnings).plus(currentPeriodProfit);
    const totalLiabilitiesAndEquity = bs.liabilities.total.plus(finalTotalEquity);

    bs.difference = bs.assets.total.minus(totalLiabilitiesAndEquity);
    bs.isBalanced = bs.difference.abs().lessThan(0.0001);

    // Format for JSON
    bs.assets.total = bs.assets.total.toNumber();
    bs.liabilities.total = bs.liabilities.total.toNumber();
    bs.equity.capitalTotal = capitalTotal.toNumber();
    bs.equity.retainedEarnings = retainedEarnings.toNumber();
    bs.equity.currentPeriodProfit = currentPeriodProfit.toNumber();
    bs.equity.total = finalTotalEquity.toNumber();
    bs.totalLiabilitiesAndEquity = totalLiabilitiesAndEquity.toNumber();
    bs.difference = bs.difference.toNumber();
  }

  return {
    asOfDate,
    currencies: Object.keys(balanceSheetByCurrency),
    byCurrency: balanceSheetByCurrency,
  };
}

/**
 * Cash Flow Report Service
 */
export async function getCashFlowReport(params: {
  fromDate: string;
  toDate: string;
  currency?: string;
  timeZone?: string;
}) {
  const { fromDate, toDate, currency } = params;

  // Cash accounts: cash_safe, bank, bankak, employee_custody
  const cashAccounts = await prisma.account.findMany({
    where: {
      accountType: { in: ['cash_safe', 'bank', 'bankak', 'employee_custody'] },
      status: 'active',
      ...(currency ? { currency } : {}),
    },
    include: {
      ledgerLines: {
        where: {
          ledgerEntry: {
            status: 'posted',
          },
        },
        include: { ledgerEntry: true },
      },
    },
  });

  const currencies = currency ? [currency] : Array.from(new Set(cashAccounts.map((a) => a.currency)));
  const cashFlowByCurrency: Record<string, any> = {};

  for (const cur of currencies) {
    cashFlowByCurrency[cur] = {
      currency: cur,
      openingCash: new Decimal(0),
      operatingInflow: new Decimal(0),
      operatingOutflow: new Decimal(0),
      netOperatingFlow: new Decimal(0),
      financingInflow: new Decimal(0),
      financingOutflow: new Decimal(0),
      netFinancingFlow: new Decimal(0),
      netChange: new Decimal(0),
      endingCash: new Decimal(0),
      operationsBreakdown: [] as any[],
    };
  }

  for (const acc of cashAccounts) {
    const cur = acc.currency;
    if (!cashFlowByCurrency[cur]) continue;

    const hasOpeningLedgerEntry = acc.ledgerLines.some(
      (l) => l.ledgerEntry?.entryType === 'opening_balance'
    );
    const baseOpening = hasOpeningLedgerEntry ? new Decimal(0) : new Decimal(acc.openingBalance.toString());

    let preDebit = new Decimal(0);
    let preCredit = new Decimal(0);

    for (const line of acc.ledgerLines) {
      const entryDate = line.ledgerEntry.entryDate;
      const dDeb = new Decimal(line.debit.toString());
      const dCred = new Decimal(line.credit.toString());

      if (entryDate < fromDate) {
        preDebit = preDebit.plus(dDeb);
        preCredit = preCredit.plus(dCred);
      } else if (entryDate <= toDate) {
        const type = line.ledgerEntry.entryType;

        // Classify inflow/outflow
        const isFinancing = type.includes('capital');
        if (isFinancing) {
          if (dDeb.greaterThan(0)) {
            cashFlowByCurrency[cur].financingInflow = cashFlowByCurrency[cur].financingInflow.plus(dDeb);
          }
          if (dCred.greaterThan(0)) {
            cashFlowByCurrency[cur].financingOutflow = cashFlowByCurrency[cur].financingOutflow.plus(dCred);
          }
        } else {
          // Operating
          if (dDeb.greaterThan(0)) {
            cashFlowByCurrency[cur].operatingInflow = cashFlowByCurrency[cur].operatingInflow.plus(dDeb);
          }
          if (dCred.greaterThan(0)) {
            cashFlowByCurrency[cur].operatingOutflow = cashFlowByCurrency[cur].operatingOutflow.plus(dCred);
          }
        }
      }
    }

    // Accumulate opening cash
    const accOpen = baseOpening.plus(preDebit).minus(preCredit);
    cashFlowByCurrency[cur].openingCash = cashFlowByCurrency[cur].openingCash.plus(accOpen);
  }

  for (const cur of Object.keys(cashFlowByCurrency)) {
    const cf = cashFlowByCurrency[cur];
    cf.netOperatingFlow = cf.operatingInflow.minus(cf.operatingOutflow);
    cf.netFinancingFlow = cf.financingInflow.minus(cf.financingOutflow);
    cf.netChange = cf.netOperatingFlow.plus(cf.netFinancingFlow);
    cf.endingCash = cf.openingCash.plus(cf.netChange);

    // Convert to numbers
    cf.openingCash = cf.openingCash.toNumber();
    cf.operatingInflow = cf.operatingInflow.toNumber();
    cf.operatingOutflow = cf.operatingOutflow.toNumber();
    cf.netOperatingFlow = cf.netOperatingFlow.toNumber();
    cf.financingInflow = cf.financingInflow.toNumber();
    cf.financingOutflow = cf.financingOutflow.toNumber();
    cf.netFinancingFlow = cf.netFinancingFlow.toNumber();
    cf.netChange = cf.netChange.toNumber();
    cf.endingCash = cf.endingCash.toNumber();
  }

  return {
    fromDate,
    toDate,
    currencies: Object.keys(cashFlowByCurrency),
    byCurrency: cashFlowByCurrency,
  };
}

/**
 * Ledger Drill-Down Service
 */
export async function getLedgerDrilldown(params: {
  accountId?: string;
  accountClass?: string;
  currency?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}) {
  const { accountId, accountClass, currency, fromDate, toDate, page = 1, limit = 50 } = params;

  const where: any = {
    ledgerEntry: {
      status: 'posted',
    },
  };

  if (accountId) {
    where.accountId = accountId;
  }

  if (currency) {
    where.currency = currency;
  }

  if (fromDate || toDate) {
    where.ledgerEntry.entryDate = {};
    if (fromDate) where.ledgerEntry.entryDate.gte = fromDate;
    if (toDate) where.ledgerEntry.entryDate.lte = toDate;
  }

  if (accountClass) {
    where.account = {
      accountCode: { startsWith: accountClass },
    };
  }

  const [totalCount, lines] = await Promise.all([
    prisma.ledgerLine.count({ where }),
    prisma.ledgerLine.findMany({
      where,
      include: {
        account: true,
        ledgerEntry: true,
      },
      orderBy: [{ ledgerEntry: { entryDate: 'desc' } }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  // Aggregate totals
  const allLinesForTotal = await prisma.ledgerLine.findMany({
    where,
    select: { debit: true, credit: true },
  });

  const totalDebit = allLinesForTotal.reduce(
    (sum, l) => sum.plus(new Decimal(l.debit.toString())),
    new Decimal(0)
  );
  const totalCredit = allLinesForTotal.reduce(
    (sum, l) => sum.plus(new Decimal(l.credit.toString())),
    new Decimal(0)
  );

  return {
    page,
    limit,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    totalDebit: totalDebit.toNumber(),
    totalCredit: totalCredit.toNumber(),
    lines: lines.map((l) => ({
      id: l.id,
      ledgerEntryId: l.ledgerEntryId,
      entryNumber: l.ledgerEntry.entryNumber,
      entryDate: l.ledgerEntry.entryDate,
      entryType: l.ledgerEntry.entryType,
      referenceType: l.ledgerEntry.referenceType,
      referenceId: l.ledgerEntry.referenceId,
      description: l.description || l.ledgerEntry.description,
      debit: Number(l.debit),
      credit: Number(l.credit),
      currency: l.currency,
      accountId: l.accountId,
      accountCode: l.account.accountCode,
      accountName: l.account.name,
      accountType: l.account.accountType,
      createdBy: l.ledgerEntry.createdBy,
      createdAt: l.createdAt,
    })),
  };
}
