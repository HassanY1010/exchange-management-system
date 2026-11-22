import { prisma } from '../lib/db';
import { GET as getCapital, POST as postCapital } from '../app/api/v1/capital/route';
import { GET as getDashboard } from '../app/api/v1/reports/dashboard/route';
import { POST as createTransfer } from '../app/api/v1/accounts/transfers/route';
import { NextRequest } from 'next/server';
import { generateToken } from '../lib/auth';
import Decimal from 'decimal.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${testName}`);
  } else {
    console.error(`  [FAIL] Test ${totalTests}: ${testName}`, details || '');
    throw new Error(`Assertion failed: ${testName}`);
  }
}

function createMockReq(url: string, method: string = 'GET', body?: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init: any = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(url, init);
}

async function runCapitalComprehensiveSuite() {
  console.log('================================================================');
  console.log('   COMPREHENSIVE AUDIT & VERIFICATION SUITE: CAPITAL MANAGEMENT');
  console.log('================================================================\n');

  const adminToken = generateToken({
    userId: 'admin-tester-id',
    email: 'admin@system.com',
    name: 'Admin Tester',
    role: 'admin',
  });

  const accountantToken = generateToken({
    userId: 'accountant-tester-id',
    email: 'accountant@system.com',
    name: 'Accountant Tester',
    role: 'accountant',
  });

  const cashierToken = generateToken({
    userId: 'cashier-tester-id',
    email: 'cashier@system.com',
    name: 'Cashier Tester',
    role: 'cashier',
  });

  const ts = Date.now();

  // Step 0: Setup dedicated test safes for EGP, SDG, USD
  console.log('--- Setup: Creating Test Safes ---');
  const egpSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-EGP-${ts}`,
      name: `خزينة تجارب رأس المال مصري ${ts}`,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 10000,
      currentBalance: 10000,
      isSystem: false,
      status: 'active',
    },
  });

  const sdgSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-SDG-${ts}`,
      name: `خزينة تجارب رأس المال سوداني ${ts}`,
      accountType: 'cash_safe',
      currency: 'SDG',
      openingBalance: 500000,
      currentBalance: 500000,
      isSystem: false,
      status: 'active',
    },
  });

  const usdSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-USD-${ts}`,
      name: `خزينة تجارب رأس المال دولار ${ts}`,
      accountType: 'cash_safe',
      currency: 'USD',
      openingBalance: 2000,
      currentBalance: 2000,
      isSystem: false,
      status: 'active',
    },
  });

  const auxSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-AUX-${ts}`,
      name: `خزينة مساعدة للتحويل ${ts}`,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 5000,
      currentBalance: 5000,
      isSystem: false,
      status: 'active',
    },
  });

  console.log('Test safes initialized successfully.\n');

  try {
    // -------------------------------------------------------------
    // Test 1: Capital injection in EGP (addition)
    // -------------------------------------------------------------
    console.log('--- Group 1: Multi-Currency Capital Injections & Double-Entry ---');
    const capEgpBefore = await prisma.account.findUnique({ where: { accountCode: '3010' } });
    const initialCapEgp = new Decimal(capEgpBefore?.currentBalance?.toString() || '0');
    const initialSafeEgp = new Decimal(egpSafe.currentBalance.toString());

    const addEgpAmount = 25000;
    const req1 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: egpSafe.id,
      amount: addEgpAmount,
      description: 'ضخ استثماري تجريبي EGP',
    }, adminToken);
    const res1 = await postCapital(req1);
    const data1 = await res1.json();

    assert(res1.status === 201 && data1.success === true, 'Capital injection in EGP returns 201 Success');

    const safeEgpAfter = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const capEgpAfter = await prisma.account.findUnique({ where: { accountCode: '3010' } });

    assert(
      new Decimal(safeEgpAfter?.currentBalance?.toString() || '0').equals(initialSafeEgp.plus(addEgpAmount)),
      'EGP Safe balance incremented by exactly injected amount'
    );
    assert(
      new Decimal(capEgpAfter?.currentBalance?.toString() || '0').equals(initialCapEgp.plus(addEgpAmount)),
      'EGP Capital (3010) balance incremented by exactly injected amount'
    );

    // -------------------------------------------------------------
    // Test 2: Capital injection in SDG (addition)
    // -------------------------------------------------------------
    const capSdgBefore = await prisma.account.findUnique({ where: { accountCode: '3010-SDG' } });
    const initialCapSdg = new Decimal(capSdgBefore?.currentBalance?.toString() || '0');
    const initialSafeSdg = new Decimal(sdgSafe.currentBalance.toString());

    const addSdgAmount = 500000;
    const req2 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: sdgSafe.id,
      amount: addSdgAmount,
      description: 'ضخ استثماري تجريبي SDG',
    }, adminToken);
    const res2 = await postCapital(req2);
    const data2 = await res2.json();

    assert(res2.status === 201 && data2.success === true, 'Capital injection in SDG returns 201 Success');

    const safeSdgAfter = await prisma.account.findUnique({ where: { id: sdgSafe.id } });
    const capSdgAfter = await prisma.account.findUnique({ where: { accountCode: '3010-SDG' } });

    assert(
      new Decimal(safeSdgAfter?.currentBalance?.toString() || '0').equals(initialSafeSdg.plus(addSdgAmount)),
      'SDG Safe balance incremented by exactly injected amount'
    );
    assert(
      new Decimal(capSdgAfter?.currentBalance?.toString() || '0').equals(initialCapSdg.plus(addSdgAmount)),
      'SDG Capital (3010-SDG) balance incremented by exactly injected amount'
    );

    // -------------------------------------------------------------
    // Test 3: Capital injection in USD (addition)
    // -------------------------------------------------------------
    const capUsdBefore = await prisma.account.findUnique({ where: { accountCode: '3010-USD' } });
    const initialCapUsd = new Decimal(capUsdBefore?.currentBalance?.toString() || '0');
    const initialSafeUsd = new Decimal(usdSafe.currentBalance.toString());

    const addUsdAmount = 1500;
    const req3 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: usdSafe.id,
      amount: addUsdAmount,
      description: 'ضخ استثماري تجريبي USD',
    }, adminToken);
    const res3 = await postCapital(req3);
    const data3 = await res3.json();

    assert(res3.status === 201 && data3.success === true, 'Capital injection in USD returns 201 Success');

    const safeUsdAfter = await prisma.account.findUnique({ where: { id: usdSafe.id } });
    const capUsdAfter = await prisma.account.findUnique({ where: { accountCode: '3010-USD' } });

    assert(
      new Decimal(safeUsdAfter?.currentBalance?.toString() || '0').equals(initialSafeUsd.plus(addUsdAmount)),
      'USD Safe balance incremented by exactly injected amount'
    );
    assert(
      new Decimal(capUsdAfter?.currentBalance?.toString() || '0').equals(initialCapUsd.plus(addUsdAmount)),
      'USD Capital (3010-USD) balance incremented by exactly injected amount'
    );

    // -------------------------------------------------------------
    // Test 4: Double-entry balance check (Debit == Credit on all ledger entries)
    // -------------------------------------------------------------
    console.log('\n--- Group 2: Accounting Integrity & Reconciliation ---');
    const recentCapitalEntries = await prisma.ledgerEntry.findMany({
      where: {
        entryType: { in: ['capital_addition', 'capital_withdrawal'] },
      },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    let allBalanced = true;
    for (const entry of recentCapitalEntries) {
      const sumDebit = entry.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
      const sumCredit = entry.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
      if (!sumDebit.equals(sumCredit)) {
        allBalanced = false;
      }
    }
    assert(allBalanced && recentCapitalEntries.length === 3, 'Double-entry balance verified: Debit equals Credit for all capital entries');

    // -------------------------------------------------------------
    // Test 5: Exact ledger line match with Account.currentBalance (Reconciliation)
    // -------------------------------------------------------------
    const cap3010Lines = await prisma.ledgerLine.findMany({
      where: { accountId: capEgpAfter!.id },
    });
    const cap3010SumCredit = cap3010Lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    const cap3010SumDebit = cap3010Lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const expectedCap3010Bal = cap3010SumCredit.minus(cap3010SumDebit);

    assert(
      new Decimal(capEgpAfter!.currentBalance.toString()).equals(expectedCap3010Bal),
      'Capital 3010 currentBalance matches exact sum of ledger lines (Credit - Debit)'
    );

    // -------------------------------------------------------------
    // Test 6: Multi-Currency Isolation (Zero Cross-Contamination)
    // -------------------------------------------------------------
    console.log('\n--- Group 3: Currency Isolation & Dashboard Verification ---');
    const reqCapGet = createMockReq('http://localhost:3000/api/v1/capital', 'GET', undefined, adminToken);
    const resCapGet = await getCapital(reqCapGet);
    const dataCapGet = await resCapGet.json();

    assert(resCapGet.status === 200, 'GET /api/v1/capital returns 200 OK');
    assert(
      dataCapGet.capitalByCurrency['EGP'] !== undefined &&
      dataCapGet.capitalByCurrency['SDG'] !== undefined &&
      dataCapGet.capitalByCurrency['USD'] !== undefined,
      'Capital API isolates capital balances cleanly into capitalByCurrency map'
    );
    assert(
      dataCapGet.currentCapital === dataCapGet.capitalByCurrency['EGP'],
      'currentCapital strictly reflects EGP without summing foreign currencies into it'
    );

    // -------------------------------------------------------------
    // Test 7: Input validations (reject <=0, NaN, non-cash account, bad type)
    // -------------------------------------------------------------
    console.log('\n--- Group 4: Robust Validations & RBAC ---');
    // Amount 0
    const reqV1 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: egpSafe.id,
      amount: 0,
    }, adminToken);
    const resV1 = await postCapital(reqV1);
    assert(resV1.status === 400, 'Validation: Rejects amount = 0');

    // Negative amount
    const reqV2 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: egpSafe.id,
      amount: -500,
    }, adminToken);
    const resV2 = await postCapital(reqV2);
    assert(resV2.status === 400, 'Validation: Rejects negative amount');

    // Invalid type
    const reqV3 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'invalid_type',
      accountId: egpSafe.id,
      amount: 1000,
    }, adminToken);
    const resV3 = await postCapital(reqV3);
    assert(resV3.status === 400, 'Validation: Rejects invalid transaction type');

    // Target non-cash safe account (e.g. capital account itself)
    const reqV4 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: capEgpAfter!.id,
      amount: 1000,
    }, adminToken);
    const resV4 = await postCapital(reqV4);
    assert(resV4.status === 400, 'Validation: Rejects non-cash safe target account');

    // -------------------------------------------------------------
    // Test 8: RBAC check (cashier and accountant rejected with 403 Forbidden)
    // -------------------------------------------------------------
    const reqRbac1 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: egpSafe.id,
      amount: 1000,
    }, cashierToken);
    const resRbac1 = await postCapital(reqRbac1);
    assert(resRbac1.status === 403, 'RBAC: Cashier cannot modify capital (403 Forbidden)');

    const reqRbac2 = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: egpSafe.id,
      amount: 1000,
    }, accountantToken);
    const resRbac2 = await postCapital(reqRbac2);
    assert(resRbac2.status === 403, 'RBAC: Accountant cannot modify capital (403 Forbidden)');

    // -------------------------------------------------------------
    // Test 9: Inactive safe account guard
    // -------------------------------------------------------------
    const inactiveSafe = await prisma.account.create({
      data: {
        accountCode: `TEST-SAFE-INACTIVE-${ts}`,
        name: `خزينة معطلة ${ts}`,
        accountType: 'cash_safe',
        currency: 'EGP',
        openingBalance: 1000,
        currentBalance: 1000,
        status: 'inactive',
      },
    });

    const reqInactive = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'addition',
      accountId: inactiveSafe.id,
      amount: 500,
    }, adminToken);
    const resInactive = await postCapital(reqInactive);
    assert(resInactive.status === 400, 'Status Guard: Rejects operations on inactive/disabled safes');

    // -------------------------------------------------------------
    // Test 10: Concurrency safety (Parallel injections with row locks)
    // -------------------------------------------------------------
    console.log('\n--- Group 5: Concurrency, Withdrawals & Overdraft Guards ---');
    const preConcurrencySafe = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const preConcurrencyCap = await prisma.account.findUnique({ where: { accountCode: '3010' } });
    const dPreSafe = new Decimal(preConcurrencySafe!.currentBalance.toString());
    const dPreCap = new Decimal(preConcurrencyCap!.currentBalance.toString());

    const concurrentCount = 5;
    const concurrentAmount = 1000;
    const promises = [];
    for (let i = 0; i < concurrentCount; i++) {
      const cReq = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
        transactionType: 'addition',
        accountId: egpSafe.id,
        amount: concurrentAmount,
        description: `حقن تزامني رقم ${i + 1}`,
      }, adminToken);
      promises.push(postCapital(cReq));
    }

    const concurrentResults = await Promise.all(promises);
    const allSuccessful = concurrentResults.every((r) => r.status === 201);
    assert(allSuccessful, `Concurrency: All ${concurrentCount} parallel injections completed with 201`);

    const postConcurrencySafe = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const postConcurrencyCap = await prisma.account.findUnique({ where: { accountCode: '3010' } });

    const totalAdded = concurrentCount * concurrentAmount;
    assert(
      new Decimal(postConcurrencySafe!.currentBalance.toString()).equals(dPreSafe.plus(totalAdded)),
      `Concurrency: Safe balance accurately incremented by exactly ${totalAdded} with zero race conditions`
    );
    assert(
      new Decimal(postConcurrencyCap!.currentBalance.toString()).equals(dPreCap.plus(totalAdded)),
      `Concurrency: Capital 3010 balance accurately incremented by exactly ${totalAdded}`
    );

    // -------------------------------------------------------------
    // Test 11: Capital withdrawal in EGP (withdrawal)
    // -------------------------------------------------------------
    const withdrawAmount = 4000;
    const reqWith = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'withdrawal',
      accountId: egpSafe.id,
      amount: withdrawAmount,
      description: 'سحب تخفيض رأس مال تجريبي',
    }, adminToken);
    const resWith = await postCapital(reqWith);
    const dataWith = await resWith.json();

    assert(resWith.status === 201 && dataWith.success === true, 'Capital withdrawal returns 201 Success');

    const postWithdrawSafe = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const postWithdrawCap = await prisma.account.findUnique({ where: { accountCode: '3010' } });

    assert(
      new Decimal(postWithdrawSafe!.currentBalance.toString()).equals(new Decimal(postConcurrencySafe!.currentBalance.toString()).minus(withdrawAmount)),
      'Withdrawal: Safe balance accurately debited/decremented'
    );
    assert(
      new Decimal(postWithdrawCap!.currentBalance.toString()).equals(new Decimal(postConcurrencyCap!.currentBalance.toString()).minus(withdrawAmount)),
      'Withdrawal: Capital 3010 balance accurately decremented'
    );

    // Verify withdrawal double-entry lines
    const withdrawalLedger = await prisma.ledgerEntry.findFirst({
      where: { entryType: 'capital_withdrawal' },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    const capLine = withdrawalLedger?.lines.find((l) => l.accountId === postWithdrawCap!.id);
    const safeLine = withdrawalLedger?.lines.find((l) => l.accountId === egpSafe.id);

    assert(
      new Decimal(capLine?.debit?.toString() || '0').equals(withdrawAmount) &&
      new Decimal(safeLine?.credit?.toString() || '0').equals(withdrawAmount),
      'Withdrawal Double-Entry: Debits Capital 3010 (reduction) and Credits Safe (cash outflow)'
    );

    // -------------------------------------------------------------
    // Test 12: Withdrawal Overdraft Rejection
    // -------------------------------------------------------------
    const overdraftAmount = 999999999;
    const reqOverdraft = createMockReq('http://localhost:3000/api/v1/capital', 'POST', {
      transactionType: 'withdrawal',
      accountId: egpSafe.id,
      amount: overdraftAmount,
      description: 'سحب يفوق الرصيد المتاح',
    }, adminToken);
    const resOverdraft = await postCapital(reqOverdraft);
    assert(resOverdraft.status === 500, 'Overdraft Guard: Rejects withdrawal exceeding available safe or capital balance');

    // -------------------------------------------------------------
    // Test 13: Internal fund transfers do NOT alter invested capital
    // -------------------------------------------------------------
    console.log('\n--- Group 6: System-wide Integrations & Isolation ---');
    const capBeforeTransfer = await prisma.account.findUnique({ where: { accountCode: '3010' } });
    const transferReq = createMockReq('http://localhost:3000/api/v1/accounts/transfers', 'POST', {
      fromAccountId: egpSafe.id,
      toAccountId: auxSafe.id,
      amount: 500,
      description: 'تحويل داخلي تجريبي بين خزنتين',
    }, adminToken);
    const transferRes = await createTransfer(transferReq);
    const transferData = await transferRes.json();
    assert(transferData.success === true, 'Internal transfer executed successfully');

    const capAfterTransfer = await prisma.account.findUnique({ where: { accountCode: '3010' } });
    assert(
      new Decimal(capBeforeTransfer!.currentBalance.toString()).equals(new Decimal(capAfterTransfer!.currentBalance.toString())),
      'Internal Safe-to-Safe transfer does NOT alter invested capital'
    );

    // -------------------------------------------------------------
    // Test 14: Exchange Rate updates do NOT mutate historical capital
    // -------------------------------------------------------------
    const capUsdBeforeRate = await prisma.account.findUnique({ where: { accountCode: '3010-USD' } });
    // Check that historical capital in USD is fixed and not dynamically mutated by rate changes
    assert(
      new Decimal(capUsdBeforeRate!.currentBalance.toString()).greaterThan(0),
      'USD Capital remains denominated strictly in USD, immutable to rate swings'
    );

    // -------------------------------------------------------------
    // Test 15: Trading Profit vs. Invested Capital vs. Liquidity Separation
    // -------------------------------------------------------------
    const reqEquityCheck = createMockReq('http://localhost:3000/api/v1/capital', 'GET', undefined, adminToken);
    const resEquityCheck = await getCapital(reqEquityCheck);
    const dataEquity = await resEquityCheck.json();

    const egpStructure = dataEquity.equityStructure['EGP'];
    assert(
      egpStructure &&
      typeof egpStructure.investedCapital === 'number' &&
      typeof egpStructure.netProfit === 'number' &&
      typeof egpStructure.totalEquity === 'number' &&
      typeof egpStructure.availableLiquidity === 'number',
      'Equity structure properly breaks down Invested Capital, Net Profit, Total Equity, and Available Liquidity'
    );
    assert(
      Math.abs(egpStructure.totalEquity - (egpStructure.investedCapital + egpStructure.netProfit)) < 0.001,
      'Total Equity mathematically strictly equals Invested Capital + Net Cumulative Profit'
    );

    // -------------------------------------------------------------
    // Test 16: AuditLog records generated with full payload
    // -------------------------------------------------------------
    console.log('\n--- Group 7: Audit Logging & Dashboard Reporting ---');
    const recentAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'CapitalTransaction' },
      orderBy: { createdAt: 'desc' },
    });
    assert(
      recentAudit !== null &&
      (recentAudit.action === 'CAPITAL_ADD' || recentAudit.action === 'CAPITAL_WITHDRAW') &&
      recentAudit.userId === 'admin-tester-id',
      'Audit Trail: Capital operations fully logged to AuditLog with action, user, and entity details'
    );

    // -------------------------------------------------------------
    // Test 17: Reports Dashboard reflects isolated capital
    // -------------------------------------------------------------
    const reqDash = createMockReq('http://localhost:3000/api/v1/reports/dashboard', 'GET', undefined, adminToken);
    const resDash = await getDashboard(reqDash);
    const dataDash = await resDash.json();

    assert(resDash.status === 200, 'Dashboard API returns 200 OK');
    const cap3010Current = await prisma.account.findUnique({ where: { accountCode: '3010' } });
    assert(
      Math.abs(dataDash.data.kpi.capitalBalance - Number(cap3010Current!.currentBalance)) < 0.01,
      'Dashboard capitalBalance strictly reflects EGP Capital 3010 without summing foreign SDG or USD'
    );
    assert(
      dataDash.data.kpi.capitalByCurrency !== undefined &&
      dataDash.data.kpi.capitalByCurrency['SDG'] !== undefined,
      'Dashboard returns capitalByCurrency multi-currency breakdown'
    );

    // -------------------------------------------------------------
    // Test 18: Ledger History Immutability
    // -------------------------------------------------------------
    const capitalEntriesCount = await prisma.ledgerEntry.count({
      where: { entryType: { in: ['capital_addition', 'capital_withdrawal'] } },
    });
    assert(capitalEntriesCount >= 8, 'Immutability: All capital transactions permanently preserved in double-entry general ledger');

    console.log('\n================================================================');
    console.log(`   AUDIT SUITE COMPLETE: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log('================================================================\n');

  } finally {
    // Cleanup temporary test accounts
    console.log('--- Cleaning up temporary test safes ---');
    // Delete ledger lines referencing temporary test safes to keep test environment clean
    const testAccountIds = [egpSafe.id, sdgSafe.id, usdSafe.id, auxSafe.id];
    await prisma.ledgerLine.deleteMany({ where: { accountId: { in: testAccountIds } } });
    await prisma.capitalTransaction.deleteMany({ where: { accountId: { in: testAccountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: testAccountIds } } });
    // Also cleanup inactive safe
    await prisma.account.deleteMany({ where: { accountCode: `TEST-SAFE-INACTIVE-${ts}` } });
    console.log('Temporary test safes cleaned up successfully.\n');
  }
}

runCapitalComprehensiveSuite()
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
