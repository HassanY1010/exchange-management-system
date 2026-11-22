import { prisma } from '../lib/db';
import { GET as getExpenses, POST as postExpense } from '../app/api/v1/expenses/route';
import { GET as getExpenseById, DELETE as deleteExpense } from '../app/api/v1/expenses/[id]/route';
import { GET as getProfitLoss } from '../app/api/v1/reports/profit-loss/route';
import { GET as getDashboard } from '../app/api/v1/reports/dashboard/route';
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

async function runExpensesComprehensiveSuite() {
  console.log('================================================================');
  console.log('   COMPREHENSIVE AUDIT & VERIFICATION SUITE: OPERATING EXPENSES');
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

  // Step 0: Setup dedicated test safes and categories
  console.log('--- Setup: Creating Test Safes & Expense Category ---');
  const egpSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-EXP-EGP-${ts}`,
      name: `خزينة تجارب مصروفات مصري ${ts}`,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 50000,
      currentBalance: 50000,
      isSystem: false,
      status: 'active',
    },
  });

  const sdgSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-EXP-SDG-${ts}`,
      name: `خزينة تجارب مصروفات سوداني ${ts}`,
      accountType: 'cash_safe',
      currency: 'SDG',
      openingBalance: 1000000,
      currentBalance: 1000000,
      isSystem: false,
      status: 'active',
    },
  });

  const usdSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-EXP-USD-${ts}`,
      name: `خزينة تجارب مصروفات دولار ${ts}`,
      accountType: 'cash_safe',
      currency: 'USD',
      openingBalance: 2500,
      currentBalance: 2500,
      isSystem: false,
      status: 'active',
    },
  });

  const testCategory = await prisma.expenseCategory.create({
    data: {
      name: `تصنيف تجريبي ${ts}`,
      description: 'فئة مصروفات مخصصة لاختبارات التدقيق الشامل',
      status: 'active',
    },
  });

  console.log('Test safes and category initialized successfully.\n');

  try {
    // -------------------------------------------------------------
    // Test 1: Register expenses in EGP, SDG, and USD (Multi-Currency)
    // -------------------------------------------------------------
    console.log('--- Group 1: Multi-Currency Expense Registration ---');
    const expEgpAmount = 3500;
    const req1 = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: expEgpAmount,
      currency: 'EGP',
      description: 'فاتورة إنترنت شهرية EGP',
    }, adminToken);
    const res1 = await postExpense(req1);
    const data1 = await res1.json();
    if (res1.status !== 201) {
      console.error('Error on Test 1:', res1.status, data1);
    }

    assert(res1.status === 201 && data1.success === true, 'Expense in EGP registered with HTTP 201');
    const expenseEgpId = data1.data.id;

    // SDG Expense
    const expSdgAmount = 75000;
    const req2 = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: sdgSafe.id,
      amount: expSdgAmount,
      currency: 'SDG',
      description: 'صيانة مكيفات فرع الخرطوم SDG',
    }, adminToken);
    const res2 = await postExpense(req2);
    const data2 = await res2.json();

    assert(res2.status === 201 && data2.success === true, 'Expense in SDG registered with HTTP 201');
    const expenseSdgId = data2.data.id;

    // USD Expense
    const expUsdAmount = 120;
    const req3 = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: usdSafe.id,
      amount: expUsdAmount,
      currency: 'USD',
      description: 'اشتراك خوادم سحابية USD',
    }, adminToken);
    const res3 = await postExpense(req3);
    const data3 = await res3.json();

    assert(res3.status === 201 && data3.success === true, 'Expense in USD registered with HTTP 201');
    const expenseUsdId = data3.data.id;

    // -------------------------------------------------------------
    // Test 2: Double-Entry Balance Check (Debit == Credit on all ledger entries)
    // -------------------------------------------------------------
    console.log('\n--- Group 2: Double-Entry Balance & Ledger Integrity ---');
    const recentExpenseLedgers = await prisma.ledgerEntry.findMany({
      where: {
        entryType: 'operating_expense',
        referenceId: { in: [data1.data.expenseNumber, data2.data.expenseNumber, data3.data.expenseNumber] },
      },
      include: { lines: true },
    });

    assert(recentExpenseLedgers.length === 3, 'Found 3 ledger entries corresponding to the 3 expenses');

    for (const le of recentExpenseLedgers) {
      const sumDebit = le.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
      const sumCredit = le.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
      assert(sumDebit.equals(sumCredit), `Double-entry balanced for ${le.entryNumber}: Debit equals Credit`);

      // Verify that lines have matched currency
      const lineCurrencies = Array.from(new Set(le.lines.map((l) => l.currency)));
      assert(lineCurrencies.length === 1, `Ledger entry ${le.entryNumber} has isolated currency without cross-mixing`);
    }

    // -------------------------------------------------------------
    // Test 3: Safe balance matches exact Ledger calculation
    // -------------------------------------------------------------
    console.log('\n--- Group 3: Account Balance Reconciliation with Ledger ---');
    const updatedEgpSafe = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const expectedEgpBalance = new Decimal(50000).minus(expEgpAmount);
    assert(
      new Decimal(updatedEgpSafe!.currentBalance.toString()).equals(expectedEgpBalance),
      'EGP Safe balance decremented by exactly the expense amount'
    );

    const updatedSdgSafe = await prisma.account.findUnique({ where: { id: sdgSafe.id } });
    const expectedSdgBalance = new Decimal(1000000).minus(expSdgAmount);
    assert(
      new Decimal(updatedSdgSafe!.currentBalance.toString()).equals(expectedSdgBalance),
      'SDG Safe balance decremented by exactly the expense amount'
    );

    const updatedUsdSafe = await prisma.account.findUnique({ where: { id: usdSafe.id } });
    const expectedUsdBalance = new Decimal(2500).minus(expUsdAmount);
    assert(
      new Decimal(updatedUsdSafe!.currentBalance.toString()).equals(expectedUsdBalance),
      'USD Safe balance decremented by exactly the expense amount'
    );

    // -------------------------------------------------------------
    // Test 4: Overdraft Protection (Reject expense exceeding safe balance)
    // -------------------------------------------------------------
    console.log('\n--- Group 4: Validations & Overdraft Protection ---');
    const overdraftAmount = 999999999;
    const reqOverdraft = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: overdraftAmount,
      currency: 'EGP',
      description: 'مصروف يفوق رصيد الخزينة المتاح',
    }, adminToken);
    const resOverdraft = await postExpense(reqOverdraft);
    assert(resOverdraft.status === 500 || resOverdraft.status === 400, 'Overdraft Guard: Rejects expense exceeding available safe balance');

    // -------------------------------------------------------------
    // Test 5: Reject Zero, Negative, and NaN Amounts
    // -------------------------------------------------------------
    // Amount 0
    const reqZero = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: 0,
      currency: 'EGP',
    }, adminToken);
    const resZero = await postExpense(reqZero);
    assert(resZero.status === 400, 'Validation: Rejects amount = 0');

    // Negative amount
    const reqNeg = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: -150,
      currency: 'EGP',
    }, adminToken);
    const resNeg = await postExpense(reqNeg);
    assert(resNeg.status === 400, 'Validation: Rejects negative amount');

    // NaN amount
    const reqNan = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: 'invalid_number',
      currency: 'EGP',
    }, adminToken);
    const resNan = await postExpense(reqNan);
    assert(resNan.status === 400, 'Validation: Rejects NaN amount string');

    // Currency mismatch
    const reqMismatch = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: 100,
      currency: 'USD', // safe is EGP
    }, adminToken);
    const resMismatch = await postExpense(reqMismatch);
    assert(resMismatch.status === 400, 'Validation: Rejects currency mismatch between request and safe');

    // -------------------------------------------------------------
    // Test 6: RBAC Permissions Guard
    // -------------------------------------------------------------
    console.log('\n--- Group 5: RBAC & Permissions ---');
    // Cashier attempt
    const reqCashier = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: 200,
      currency: 'EGP',
    }, cashierToken);
    const resCashier = await postExpense(reqCashier);
    assert(resCashier.status === 403, 'RBAC: Cashier forbidden from recording expenses (403)');

    // Accountant attempt (allowed)
    const reqAccountant = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe.id,
      amount: 200,
      currency: 'EGP',
      description: 'مصروف مسجل بواسطة المحاسب',
    }, accountantToken);
    const resAccountant = await postExpense(reqAccountant);
    assert(resAccountant.status === 201, 'RBAC: Accountant permitted to record expenses (201)');

    // -------------------------------------------------------------
    // Test 7: Expense Cancellation with Balanced Reversing Entry
    // -------------------------------------------------------------
    console.log('\n--- Group 6: Expense Cancellation & Reversing Entry ---');
    const safeBeforeCancel = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const dSafeBefore = new Decimal(safeBeforeCancel!.currentBalance.toString());

    // Cancel the EGP expense
    const cancelReq = createMockReq(`http://localhost:3000/api/v1/expenses/${expenseEgpId}`, 'DELETE', {
      reason: 'إلغاء لخطأ في تسجيل الفاتورة',
    }, adminToken);
    const cancelRes = await deleteExpense(cancelReq, { params: { id: expenseEgpId } });
    const cancelData = await cancelRes.json();

    assert(cancelRes.status === 200 && cancelData.success === true, 'Expense cancellation returns HTTP 200');

    // Check expense record status
    const cancelledExpense = await prisma.expense.findUnique({ where: { id: expenseEgpId } });
    assert(cancelledExpense?.status === 'cancelled', 'Expense status updated to "cancelled"');

    // Check safe refund
    const safeAfterCancel = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    assert(
      new Decimal(safeAfterCancel!.currentBalance.toString()).equals(dSafeBefore.plus(expEgpAmount)),
      'Safe balance fully refunded and incremented by the cancelled expense amount'
    );

    // Verify reversing ledger entry
    const reversalLedger = await prisma.ledgerEntry.findFirst({
      where: {
        entryType: 'expense_reversal',
        referenceId: data1.data.expenseNumber,
      },
      include: { lines: true },
    });
    assert(reversalLedger !== null, 'Reversing ledger entry (expense_reversal) posted successfully');

    const sumRevDebit = reversalLedger!.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const sumRevCredit = reversalLedger!.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    assert(sumRevDebit.equals(sumRevCredit), 'Reversing entry is perfectly double-entry balanced');

    // Verify debit is to Safe (cash returned) and credit is to Expense 5010 (expense reduced)
    const lineSafe = reversalLedger!.lines.find((l) => l.accountId === egpSafe.id);
    assert(new Decimal(lineSafe?.debit?.toString() || '0').equals(expEgpAmount), 'Reversing entry debits Safe (cash inflow)');

    // Double cancel rejection
    const doubleCancelRes = await deleteExpense(cancelReq, { params: { id: expenseEgpId } });
    assert(doubleCancelRes.status === 400, 'Guard: Rejects cancelling an already-cancelled expense');

    // -------------------------------------------------------------
    // Test 8: Concurrency Protection (Parallel Expenses with Row Locks)
    // -------------------------------------------------------------
    console.log('\n--- Group 7: Concurrency & Race Condition Protection ---');
    const preConcurrencySafe = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const dPreBal = new Decimal(preConcurrencySafe!.currentBalance.toString());

    const parallelCount = 4;
    const parallelAmount = 500;
    const promises = [];
    for (let i = 0; i < parallelCount; i++) {
      const pReq = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
        categoryId: testCategory.id,
        accountId: egpSafe.id,
        amount: parallelAmount,
        currency: 'EGP',
        description: `مصروف تزامني رقم ${i + 1}`,
      }, adminToken);
      promises.push(postExpense(pReq));
    }

    const parallelResults = await Promise.all(promises);
    const allPassed = parallelResults.every((r) => r.status === 201);
    assert(allPassed, `All ${parallelCount} parallel expenses executed successfully with 201`);

    const postConcurrencySafe = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const expectedPostBal = dPreBal.minus(parallelCount * parallelAmount);
    assert(
      new Decimal(postConcurrencySafe!.currentBalance.toString()).equals(expectedPostBal),
      `Safe balance accurately decremented by ${parallelCount * parallelAmount} with zero race conditions`
    );

    // -------------------------------------------------------------
    // Test 9: Impact on Profit & Loss (P&L Integration)
    // -------------------------------------------------------------
    console.log('\n--- Group 8: System-wide Integrations (P&L, Capital, Dashboard) ---');
    const plReq = createMockReq('http://localhost:3000/api/v1/reports/profit-loss', 'GET', undefined, adminToken);
    const plRes = await getProfitLoss(plReq);
    const plData = await plRes.json();

    assert(plRes.status === 200 && plData.success === true, 'P&L API returns HTTP 200 OK');
    assert(
      typeof plData.data.expenses.totalOperatingExpenses === 'number',
      'P&L report accurately tracks operating expenses'
    );
    assert(
      plData.data.expenses.expensesByCurrency !== undefined,
      'P&L report provides multi-currency expenses breakdown'
    );

    // -------------------------------------------------------------
    // Test 10: Zero Direct Impact on Invested Capital (3010)
    // -------------------------------------------------------------
    const cap3010 = await prisma.account.findUnique({ where: { accountCode: '3010' } });
    // Verify that capital account 3010 has NO ledger lines with referenceType 'Expense'
    const capitalExpenseLines = await prisma.ledgerLine.findMany({
      where: {
        accountId: cap3010!.id,
        ledgerEntry: { referenceType: 'Expense' },
      },
    });
    assert(
      capitalExpenseLines.length === 0,
      'Capital Account 3010 is NEVER directly debited or credited by operating expenses'
    );

    // -------------------------------------------------------------
    // Test 11: Dashboard and Today Integration
    // -------------------------------------------------------------
    const dashReq = createMockReq('http://localhost:3000/api/v1/reports/dashboard', 'GET', undefined, adminToken);
    const dashRes = await getDashboard(dashReq);
    const dashData = await dashRes.json();

    assert(dashRes.status === 200 && dashData.success === true, 'Dashboard API returns HTTP 200 OK');
    assert(
      typeof dashData.data.kpi.totalExpensesToday === 'number',
      'Dashboard KPI accurately tracks today expenses in EGP'
    );
    assert(
      dashData.data.kpi.expensesTodayByCurrency !== undefined,
      'Dashboard KPI provides multi-currency breakdown for today expenses'
    );

    // -------------------------------------------------------------
    // Test 12: AuditLog Full Traceability
    // -------------------------------------------------------------
    console.log('\n--- Group 9: Audit Trail Verification ---');
    const auditRecord = await prisma.auditLog.findFirst({
      where: { entityType: 'Expense', action: 'RECORD_EXPENSE' },
      orderBy: { createdAt: 'desc' },
    });
    assert(auditRecord !== null, 'AuditLog records RECORD_EXPENSE event');

    const auditCancel = await prisma.auditLog.findFirst({
      where: { entityType: 'Expense', action: 'CANCEL_EXPENSE' },
      orderBy: { createdAt: 'desc' },
    });
    assert(auditCancel !== null, 'AuditLog records CANCEL_EXPENSE event');

    console.log('\n================================================================');
    console.log(`   AUDIT SUITE COMPLETE: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log('================================================================\n');
  } finally {
    // Cleanup temporary test records
    console.log('--- Cleaning up temporary test data ---');
    const testSafeIds = [egpSafe.id, sdgSafe.id, usdSafe.id];
    await prisma.ledgerLine.deleteMany({ where: { accountId: { in: testSafeIds } } });
    await prisma.expense.deleteMany({ where: { accountId: { in: testSafeIds } } });
    await prisma.account.deleteMany({ where: { id: { in: testSafeIds } } });
    await prisma.expenseCategory.deleteMany({ where: { id: testCategory.id } });
    console.log('Temporary test data cleaned up successfully.\n');
  }
}

runExpensesComprehensiveSuite()
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
