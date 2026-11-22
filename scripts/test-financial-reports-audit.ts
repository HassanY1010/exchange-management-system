import { prisma } from '../lib/db';
import { generateToken } from '../lib/auth';
import Decimal from 'decimal.js';
import {
  getReportsDateRange,
  getProfitLossReport,
  getTrialBalanceReport,
  getBalanceSheetReport,
  getCashFlowReport,
  getLedgerDrilldown,
} from '../lib/reports/financial-reports-service';

// Mock request helper for API routes
function createMockReq(url: string, role: string = 'admin', extraHeaders: Record<string, string> = {}) {
  const token = generateToken({
    userId: 'audit-user-id',
    email: 'auditor@exchange.com',
    name: 'Auditor Test',
    role,
  });

  return {
    url,
    headers: new Headers({
      authorization: `Bearer ${token}`,
      ...extraHeaders,
    }),
    cookies: {
      get: () => undefined,
    },
    nextUrl: new URL(url),
  } as any;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runComprehensiveFinancialReportsAudit() {
  console.log('================================================================');
  console.log('   FINANCIAL REPORTS & ANALYSIS AUDIT SUITE (POSTGRESQL REAL)   ');
  console.log('================================================================');

  const ts = Date.now();

  try {
    // -------------------------------------------------------------
    // Test 1: Date Range & Timezone Resolution (Africa/Cairo)
    // -------------------------------------------------------------
    console.log('\n--- Group 1: Cairo Timezone & Date Range Audit ---');
    const todayRange = getReportsDateRange('today', null, null, 'Africa/Cairo');
    console.log('Today Range:', todayRange.fromDate, 'to', todayRange.toDate, `(${todayRange.daysCount} days)`);
    assert(todayRange.fromDate === todayRange.toDate, 'Today range has fromDate == toDate');
    assert(todayRange.daysCount === 1, 'Today range duration is exactly 1 day');
    assert(todayRange.priorFromDate < todayRange.fromDate, 'Prior period precedes current period');

    const monthRange = getReportsDateRange('month', null, null, 'Africa/Cairo');
    console.log('Month Range:', monthRange.fromDate, 'to', monthRange.toDate, `(${monthRange.daysCount} days)`);
    assert(monthRange.fromDate.endsWith('-01'), 'Month range starts on 1st of month');
    assert(monthRange.priorToDate < monthRange.fromDate, 'Prior month comparison precedes month start');

    // -------------------------------------------------------------
    // Test 2: General Ledger P&L vs Approximations
    // -------------------------------------------------------------
    console.log('\n--- Group 2: Profit & Loss Ledger-Based Accuracy Audit ---');
    const pnlReport = await getProfitLossReport({
      fromDate: monthRange.fromDate,
      toDate: monthRange.toDate,
      compareWithPrior: true,
      timeZone: 'Africa/Cairo',
    });

    assert(pnlReport.currencies.length > 0, 'P&L returned currencies');
    console.log('Available P&L Currencies:', pnlReport.currencies);

    for (const cur of pnlReport.currencies) {
      const cData = pnlReport.byCurrency[cur];
      console.log(`P&L (${cur}): Revenues=${cData.revenues.totalRevenues}, Expenses=${cData.expenses.totalExpenses}, NetProfit=${cData.netProfit}`);

      // Verify Revenues - Expenses == NetProfit
      const expectedProfit = new Decimal(cData.revenues.totalRevenues).minus(new Decimal(cData.expenses.totalExpenses));
      assert(
        expectedProfit.equals(new Decimal(cData.netProfit)),
        `P&L math matches strictly: Revenues - Expenses = NetProfit for ${cur}`
      );
    }

    // Verify against actual LedgerLine database rows in EGP
    const actualRevenueLines = await prisma.ledgerLine.findMany({
      where: {
        currency: 'EGP',
        account: {
          OR: [{ accountCode: { startsWith: '4' } }, { accountType: 'profit_loss' }],
        },
        ledgerEntry: {
          entryDate: { gte: monthRange.fromDate, lte: monthRange.toDate },
          status: 'posted',
        },
      },
    });

    const expectedEgpRevenues = actualRevenueLines.reduce(
      (sum, l) => sum.plus(new Decimal(l.credit.toString())).minus(new Decimal(l.debit.toString())),
      new Decimal(0)
    );

    assert(
      expectedEgpRevenues.equals(new Decimal(pnlReport.byCurrency['EGP']?.revenues.totalRevenues || 0)),
      'EGP Revenues strictly equal sum of General Ledger lines for class 4xxx (zero mock data)'
    );

    // -------------------------------------------------------------
    // Test 3: Trial Balance Invariant (Total Debits == Total Credits)
    // -------------------------------------------------------------
    console.log('\n--- Group 3: Trial Balance Invariant (Debit == Credit) Audit ---');
    const trialReport = await getTrialBalanceReport({
      fromDate: monthRange.fromDate,
      toDate: monthRange.toDate,
      timeZone: 'Africa/Cairo',
    });

    for (const cur of trialReport.currencies) {
      const t = trialReport.byCurrency[cur];
      console.log(`Trial Balance (${cur}): Debits=${t.totalDebit}, Credits=${t.totalCredit}, Diff=${t.difference}, Balanced=${t.isBalanced}`);

      assert(t.isBalanced === true, `Trial balance is balanced for currency ${cur}`);
      assert(t.difference === 0, `Trial balance difference is 0 for currency ${cur}`);
    }

    // -------------------------------------------------------------
    // Test 4: Balance Sheet Equation (Assets = Liabilities + Equity) & Independent Equity
    // -------------------------------------------------------------
    console.log('\n--- Group 4: Balance Sheet Equation (A = L + E) & Independent Equity Audit ---');
    const bsReport = await getBalanceSheetReport({
      asOfDate: monthRange.toDate,
      timeZone: 'Africa/Cairo',
    });

    for (const cur of bsReport.currencies) {
      const bs = bsReport.byCurrency[cur];
      console.log(
        `Balance Sheet (${cur}): Assets=${bs.assets.total}, Liab=${bs.liabilities.total}, Equity=${bs.equity.total} [Cap=${bs.equity.capitalTotal}, Ret=${bs.equity.retainedEarnings}, Profit=${bs.equity.currentPeriodProfit}], Diff=${bs.difference}, Balanced=${bs.isBalanced}`
      );

      assert(bs.isBalanced === true, `Balance Sheet is balanced for currency ${cur}`);
      assert(bs.difference === 0, `Balance Sheet difference is 0 for currency ${cur}`);

      // Verify that total equity is the exact sum of independent parts
      const calculatedEquity = new Decimal(bs.equity.capitalTotal)
        .plus(new Decimal(bs.equity.retainedEarnings))
        .plus(new Decimal(bs.equity.currentPeriodProfit));
      assert(
        calculatedEquity.equals(new Decimal(bs.equity.total)),
        `Total Equity strictly decomposes into Capital + Retained Earnings + Current Period Profit for ${cur}`
      );

      // Verify independent A = L + E equation: Assets - (Liabilities + Equity) === 0
      const equationDiff = new Decimal(bs.assets.total)
        .minus(new Decimal(bs.liabilities.total).plus(new Decimal(bs.equity.total)));
      assert(
        equationDiff.abs().lessThan(0.0001),
        `Independent Equation Assets = Liabilities + Equity holds strictly for ${cur} (Diff: ${equationDiff.toString()})`
      );
    }

    // -------------------------------------------------------------
    // Test 5: Cash Flow Statement Invariant
    // -------------------------------------------------------------
    console.log('\n--- Group 5: Cash Flow Inflow/Outflow Invariant Audit ---');
    const cashFlowReport = await getCashFlowReport({
      fromDate: monthRange.fromDate,
      toDate: monthRange.toDate,
      timeZone: 'Africa/Cairo',
    });

    for (const cur of cashFlowReport.currencies) {
      const cf = cashFlowReport.byCurrency[cur];
      console.log(
        `Cash Flow (${cur}): Open=${cf.openingCash}, Inflow=${cf.operatingInflow}, Outflow=${cf.operatingOutflow}, NetChange=${cf.netChange}, Ending=${cf.endingCash}`
      );

      const calculatedNet = new Decimal(cf.operatingInflow)
        .minus(new Decimal(cf.operatingOutflow))
        .plus(new Decimal(cf.financingInflow))
        .minus(new Decimal(cf.financingOutflow));

      assert(
        calculatedNet.equals(new Decimal(cf.netChange)),
        `Net Cash Change strictly matches Operating + Financing net flows for ${cur}`
      );

      const expectedEnding = new Decimal(cf.openingCash).plus(calculatedNet);
      assert(
        expectedEnding.equals(new Decimal(cf.endingCash)),
        `Ending Cash strictly equals Opening Cash + Net Cash Change for ${cur}`
      );
    }

    // -------------------------------------------------------------
    // Test 6: Ledger Drill-Down Integrity
    // -------------------------------------------------------------
    console.log('\n--- Group 6: General Ledger Drill-Down Audit ---');
    const drilldown = await getLedgerDrilldown({
      currency: 'EGP',
      fromDate: monthRange.fromDate,
      toDate: monthRange.toDate,
      limit: 20,
    });

    console.log(`Drill-down: Count=${drilldown.totalCount}, DebitTotal=${drilldown.totalDebit}, CreditTotal=${drilldown.totalCredit}`);
    assert(drilldown.totalCount > 0, 'Found posted ledger lines for drill-down');
    assert(drilldown.lines.length <= 20, 'Pagination limit respected');
    assert(drilldown.lines[0].entryNumber.startsWith('JE-'), 'Drill-down includes valid journal entry numbers');
    assert(drilldown.lines[0].accountCode !== undefined, 'Account codes included');

    // -------------------------------------------------------------
    // Test 7: RBAC Access Control Enforcement on API Routes
    // -------------------------------------------------------------
    console.log('\n--- Group 7: Role-Based Access Control (RBAC) Security Audit ---');
    // Import API routes dynamically
    const { GET: getPnlRoute } = await import('../app/api/v1/reports/profit-loss/route');
    const { GET: getTrialRoute } = await import('../app/api/v1/reports/trial-balance/route');
    const { GET: getBsRoute } = await import('../app/api/v1/reports/balance-sheet/route');

    // 1. Unauthenticated request -> 401
    const unauthReq = {
      url: 'http://localhost:3000/api/v1/reports/profit-loss',
      headers: new Headers(),
      cookies: { get: () => undefined },
      nextUrl: new URL('http://localhost:3000/api/v1/reports/profit-loss'),
    } as any;
    const resUnauth = await getPnlRoute(unauthReq);
    assert(resUnauth.status === 401, 'Unauthenticated access to P&L returns HTTP 401');

    // 2. Unauthorized role (e.g. data_entry or custody_officer) -> 403
    const dataEntryReq = createMockReq('http://localhost:3000/api/v1/reports/profit-loss', 'data_entry');
    const resDataEntry = await getPnlRoute(dataEntryReq);
    assert(resDataEntry.status === 403, 'Unauthorized role (data_entry) to P&L returns HTTP 403');

    const dataEntryTrial = createMockReq('http://localhost:3000/api/v1/reports/trial-balance', 'custody_officer');
    const resDataEntryTrial = await getTrialRoute(dataEntryTrial);
    assert(resDataEntryTrial.status === 403, 'Unauthorized role (custody_officer) to Trial Balance returns HTTP 403');

    // 3. Authorized role: admin -> 200
    const adminReq = createMockReq('http://localhost:3000/api/v1/reports/profit-loss?period=month', 'admin');
    const resAdmin = await getPnlRoute(adminReq);
    const dataAdmin = await resAdmin.json();
    assert(resAdmin.status === 200 && dataAdmin.success === true, 'Admin access returns HTTP 200 with report data');

    // 4. Authorized role: accountant -> 200
    const accountantReq = createMockReq('http://localhost:3000/api/v1/reports/balance-sheet', 'accountant');
    const resAccountant = await getBsRoute(accountantReq);
    const dataAccountant = await resAccountant.json();
    assert(resAccountant.status === 200 && dataAccountant.success === true, 'Accountant access returns HTTP 200 with report data');

    // -------------------------------------------------------------
    // Test 8: Audit Focus Points (Clearing Persistence & Zero Mutation)
    // -------------------------------------------------------------
    console.log('\n--- Group 8: Clearing Accounts Persistence & Reclassification Immutability Audit ---');
    const clearingAccounts = await prisma.account.findMany({
      where: { accountCode: { in: ['1060', '1065'] } },
    });
    assert(clearingAccounts.length === 2, 'Both clearing accounts 1060 and 1065 exist in DB');
    for (const ca of clearingAccounts) {
      assert(ca.accountType === 'clearing', `Account ${ca.accountCode} permanently has accountType='clearing' (actual: ${ca.accountType})`);
    }

    // Verify trial balance and ledger lines have not been modified by balance sheet presentation
    const trialAfterBs = await getTrialBalanceReport({
      fromDate: monthRange.fromDate,
      toDate: monthRange.toDate,
      timeZone: 'Africa/Cairo',
    });
    const tbAssetsEgp = trialAfterBs.byCurrency['EGP'].classes.assets;
    const clearingTbLine = tbAssetsEgp.find((l: any) => l.accountCode === '1060');
    assert(clearingTbLine !== undefined, 'Account 1060 remains in Trial Balance under its exact original code 1060 in assets');
    assert(clearingTbLine.accountType === 'clearing', 'Account 1060 in Trial Balance preserves accountType=clearing');

    // Verify customer liability accounts remain in Trial Balance as original liabilities
    const tbLiabEgp = trialAfterBs.byCurrency['EGP'].classes.liabilities;
    const custLiabTb = tbLiabEgp.find((l: any) => l.accountCode === '2010');
    assert(custLiabTb !== undefined, 'Account 2010 remains canonical in Trial Balance liabilities regardless of debit reclassification in BS');

    console.log('\n================================================================');
    console.log('   🎉 ALL 8 AUDIT GROUPS PASSED WITH 100% MATHEMATICAL RIGOR   ');
    console.log('================================================================\n');
  } catch (error: any) {
    console.error('Audit failed with error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runComprehensiveFinancialReportsAudit();
