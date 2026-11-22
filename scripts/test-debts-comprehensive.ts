import { prisma } from '../lib/db';
import { GET as getDebts, POST as postDebt } from '../app/api/v1/debts/route';
import { GET as getDebtById, DELETE as deleteDebt } from '../app/api/v1/debts/[id]/route';
import { POST as postDebtPayment, GET as getDebtPayments } from '../app/api/v1/debts/[id]/payments/route';
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

async function runDebtsComprehensiveSuite() {
  console.log('================================================================');
  console.log('   COMPREHENSIVE AUDIT & VERIFICATION SUITE: DEBTS & LIABILITIES');
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

  // Step 0: Setup dedicated test safes with known balances
  const egpSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-EGP-${ts}`,
      name: `خزينة اختبار جنيه ${ts}`,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 100000,
      currentBalance: 100000,
      status: 'active',
    },
  });

  const sdgSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-SDG-${ts}`,
      name: `خزينة اختبار سوداني ${ts}`,
      accountType: 'cash_safe',
      currency: 'SDG',
      openingBalance: 2000000,
      currentBalance: 2000000,
      status: 'active',
    },
  });

  const usdSafe = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-USD-${ts}`,
      name: `خزينة اختبار دولار ${ts}`,
      accountType: 'cash_safe',
      currency: 'USD',
      openingBalance: 10000,
      currentBalance: 10000,
      status: 'active',
    },
  });

  console.log(' Setup completed: Dedicated test accounts created successfully.');

  let testReceivableDebtId = '';
  let testReceivableDebtNumber = '';
  let testPayableSdgDebtId = '';
  let testPayableSdgDebtNumber = '';
  let testPayableUsdDebtId = '';
  let testPayableUsdDebtNumber = '';

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Create Receivable Debt (دين مستحق لنا من عميل)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 1: Create Receivable Debt (مستحق لنا) ---');
    const req1 = createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
      debtType: 'receivable',
      partyType: 'customer',
      partyName: `عميل تجريبي ${ts}`,
      currency: 'EGP',
      originalAmount: 50000,
      dueDate: '2026-12-31',
      description: 'دين تجاري لعميل',
    }, adminToken);

    const res1 = await postDebt(req1);
    const body1 = await res1.json();
    assert(res1.status === 201 && body1.success === true, 'Receivable debt created successfully with 201', body1);
    assert(body1.data.creditorType === 'office', 'Creditor is office for receivable debt');
    assert(body1.data.debtorType === 'customer', 'Debtor is customer');
    assert(Number(body1.data.originalAmount) === 50000, 'Original amount is 50,000 EGP');
    assert(Number(body1.data.remainingAmount) === 50000, 'Remaining amount is 50,000 EGP');
    assert(body1.data.status === 'outstanding', 'Status is outstanding');
    testReceivableDebtId = body1.data.id;
    testReceivableDebtNumber = body1.data.debtNumber;

    // -------------------------------------------------------------------------
    // TEST 2: Create Payable Debt (التزام مستحق علينا لمورد بالسوداني)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 2: Create Payable Debt (التزام علينا لمورد) ---');
    const req2 = createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
      debtType: 'payable',
      partyType: 'supplier',
      partyName: `مورد تجريبي ${ts}`,
      currency: 'SDG',
      originalAmount: 1000000,
      dueDate: '2026-11-30',
      description: 'التزام توريد عملة سودانية',
    }, accountantToken);

    const res2 = await postDebt(req2);
    const body2 = await res2.json();
    assert(res2.status === 201 && body2.success === true, 'Payable debt created successfully with 201', body2);
    assert(body2.data.debtorType === 'office', 'Debtor is office for payable obligation');
    assert(body2.data.creditorType === 'supplier', 'Creditor is supplier');
    assert(body2.data.currency === 'SDG', 'Currency is SDG');
    assert(Number(body2.data.originalAmount) === 1000000, 'Original amount is 1,000,000 SDG');
    assert(Number(body2.data.remainingAmount) === 1000000, 'Remaining amount is 1,000,000 SDG');
    testPayableSdgDebtId = body2.data.id;
    testPayableSdgDebtNumber = body2.data.debtNumber;

    // -------------------------------------------------------------------------
    // TEST 3: Create Payable Debt in USD
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 3: Create Payable Debt in USD ---');
    const req3 = createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
      debtType: 'payable',
      partyType: 'other',
      partyName: `جهة خارجية ${ts}`,
      currency: 'USD',
      originalAmount: 2500,
      description: 'مستحقات وسيط خارجي',
    }, adminToken);

    const res3 = await postDebt(req3);
    const body3 = await res3.json();
    assert(res3.status === 201 && body3.data.currency === 'USD', 'USD Payable debt created successfully');
    testPayableUsdDebtId = body3.data.id;
    testPayableUsdDebtNumber = body3.data.debtNumber;

    // -------------------------------------------------------------------------
    // TEST 4: Partial Payment on Receivable (تحصيل دفعة جزئية)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 4: Partial Collection on Receivable ---');
    const initialSafeEgp = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    const req4 = createMockReq(`http://localhost:3000/api/v1/debts/${testReceivableDebtId}/payments`, 'POST', {
      amount: 20000,
      accountId: egpSafe.id,
      notes: 'تحصيل دفعة أولى 20,000 جنيه',
    }, adminToken);

    const res4 = await postDebtPayment(req4, { params: { id: testReceivableDebtId } });
    const body4 = await res4.json();
    assert(res4.status === 201 && body4.success === true, 'Partial collection registered successfully', body4);
    assert(body4.data.debt.remainingAmount === 30000, 'Remaining debt updated to 30,000 EGP');
    assert(body4.data.debt.status === 'partially_paid', 'Debt status updated to partially_paid');

    const updatedSafeEgp = await prisma.account.findUnique({ where: { id: egpSafe.id } });
    assert(
      new Decimal(updatedSafeEgp!.currentBalance.toString()).equals(new Decimal(initialSafeEgp!.currentBalance.toString()).plus(20000)),
      'EGP Safe balance increased by exactly 20,000 EGP upon collection'
    );

    // Verify ledger entry
    const ledger4 = body4.data.ledgerEntry;
    assert(ledger4 !== null && ledger4.lines.length === 2, 'Ledger entry posted with 2 lines');
    const safeLine4 = ledger4.lines.find((l: any) => l.accountId === egpSafe.id);
    assert(Number(safeLine4.debit) === 20000 && Number(safeLine4.credit) === 0, 'Safe account DEBITED 20,000 EGP');

    // -------------------------------------------------------------------------
    // TEST 5: Full Settlement on Receivable (تحصيل باقي الدين)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 5: Full Settlement on Receivable ---');
    const req5 = createMockReq(`http://localhost:3000/api/v1/debts/${testReceivableDebtId}/payments`, 'POST', {
      amount: 30000,
      accountId: egpSafe.id,
      notes: 'تحصيل باقي الدين بالكامل 30,000 جنيه',
    }, accountantToken);

    const res5 = await postDebtPayment(req5, { params: { id: testReceivableDebtId } });
    const body5 = await res5.json();
    assert(res5.status === 201 && body5.success === true, 'Full settlement completed successfully', body5);
    assert(body5.data.debt.remainingAmount === 0, 'Remaining debt is 0 EGP');
    assert(body5.data.debt.status === 'paid', 'Debt status is fully paid');

    // -------------------------------------------------------------------------
    // TEST 6: Partial Payment on Payable (سداد دفعة جزئية من التزام علينا)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 6: Partial Settlement on Payable (SDG) ---');
    const initialSafeSdg = await prisma.account.findUnique({ where: { id: sdgSafe.id } });
    const req6 = createMockReq(`http://localhost:3000/api/v1/debts/${testPayableSdgDebtId}/payments`, 'POST', {
      amount: 400000,
      accountId: sdgSafe.id,
      notes: 'سداد دفعة للمورد 400,000 سوداني',
    }, adminToken);

    const res6 = await postDebtPayment(req6, { params: { id: testPayableSdgDebtId } });
    const body6 = await res6.json();
    assert(res6.status === 201 && body6.success === true, 'Payable partial settlement registered', body6);
    assert(body6.data.debt.remainingAmount === 600000, 'Remaining obligation updated to 600,000 SDG');
    assert(body6.data.debt.status === 'partially_paid', 'Obligation status updated to partially_paid');

    const updatedSafeSdg = await prisma.account.findUnique({ where: { id: sdgSafe.id } });
    assert(
      new Decimal(updatedSafeSdg!.currentBalance.toString()).equals(new Decimal(initialSafeSdg!.currentBalance.toString()).minus(400000)),
      'SDG Safe balance decreased by exactly 400,000 SDG upon supplier payment'
    );

    // Verify ledger entry for payable
    const ledger6 = body6.data.ledgerEntry;
    assert(ledger6 !== null, 'Payable ledger entry created');
    const safeLine6 = ledger6.lines.find((l: any) => l.accountId === sdgSafe.id);
    assert(Number(safeLine6.credit) === 400000 && Number(safeLine6.debit) === 0, 'Safe account CREDITED 400,000 SDG (cash outflow)');

    // -------------------------------------------------------------------------
    // TEST 7: Full Settlement on Payable (سداد باقي الالتزام)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 7: Full Settlement on Payable (SDG) ---');
    const req7 = createMockReq(`http://localhost:3000/api/v1/debts/${testPayableSdgDebtId}/payments`, 'POST', {
      amount: 600000,
      accountId: sdgSafe.id,
      notes: 'سداد باقي الالتزام للمورد 600,000 سوداني',
    }, accountantToken);

    const res7 = await postDebtPayment(req7, { params: { id: testPayableSdgDebtId } });
    const body7 = await res7.json();
    assert(res7.status === 201 && body7.success === true, 'Full payable settlement completed', body7);
    assert(body7.data.debt.remainingAmount === 0, 'Remaining obligation is 0 SDG');
    assert(body7.data.debt.status === 'paid', 'Obligation status is fully paid');

    // -------------------------------------------------------------------------
    // TEST 8: Double-Entry Balanced Check (Debit == Credit)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 8: Double-Entry Balance Verification ---');
    const allDebtLedgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        referenceId: { in: [testReceivableDebtNumber, testPayableSdgDebtNumber, testPayableUsdDebtNumber] },
      },
      include: { lines: true },
    });

    assert(allDebtLedgerEntries.length >= 4, 'Multiple debt ledger entries found');
    for (const entry of allDebtLedgerEntries) {
      let totalDebits = new Decimal(0);
      let totalCredits = new Decimal(0);
      for (const line of entry.lines) {
        totalDebits = totalDebits.plus(line.debit.toString());
        totalCredits = totalCredits.plus(line.credit.toString());
      }
      assert(
        totalDebits.equals(totalCredits),
        `LedgerEntry ${entry.id} (${entry.entryType}) perfectly balanced: Debit ${totalDebits} == Credit ${totalCredits}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 9: Safe and Ledger Reconciliation
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 9: Safe and Ledger Reconciliation ---');
    for (const testSafe of [egpSafe, sdgSafe]) {
      const dbSafe = await prisma.account.findUnique({ where: { id: testSafe.id } });
      const safeLines = await prisma.ledgerLine.findMany({
        where: { accountId: testSafe.id },
      });
      let calculatedBalance = new Decimal(testSafe.openingBalance.toString());
      for (const line of safeLines) {
        calculatedBalance = calculatedBalance.plus(line.debit.toString()).minus(line.credit.toString());
      }
      assert(
        calculatedBalance.equals(new Decimal(dbSafe!.currentBalance.toString())),
        `Safe ${testSafe.accountCode} reconciled: ledger calculation (${calculatedBalance}) matches currentBalance (${dbSafe!.currentBalance})`
      );
    }

    // -------------------------------------------------------------------------
    // TEST 10: Overpayment Guard Rejection
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 10: Overpayment Guard Rejection ---');
    // testPayableUsdDebt has 2,500 USD remaining. Attempt to pay 2,501 USD.
    const req10 = createMockReq(`http://localhost:3000/api/v1/debts/${testPayableUsdDebtId}/payments`, 'POST', {
      amount: 2501,
      accountId: usdSafe.id,
      notes: 'محاولة سداد زائدة',
    }, adminToken);

    const res10 = await postDebtPayment(req10, { params: { id: testPayableUsdDebtId } });
    const body10 = await res10.json();
    assert(res10.status === 400 || res10.status === 500, 'Overpayment rejected with error status');
    assert(
      (body10.error || '').includes('أكبر من المبلغ المتبقي المستحق'),
      'Overpayment error message clearly explains remaining amount exceeded',
      body10
    );

    // -------------------------------------------------------------------------
    // TEST 11: Insufficient Safe Balance Rejection on Payables
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 11: Insufficient Safe Balance Rejection ---');
    // Create an empty USD safe
    const emptyUsdSafe = await prisma.account.create({
      data: {
        accountCode: `EMPTY-USD-SAFE-${ts}`,
        name: `خزينة خالية ${ts}`,
        accountType: 'cash_safe',
        currency: 'USD',
        openingBalance: 10,
        currentBalance: 10,
        status: 'active',
      },
    });

    const req11 = createMockReq(`http://localhost:3000/api/v1/debts/${testPayableUsdDebtId}/payments`, 'POST', {
      amount: 500,
      accountId: emptyUsdSafe.id,
      notes: 'محاولة سداد من رصيد غير كاف',
    }, adminToken);

    const res11 = await postDebtPayment(req11, { params: { id: testPayableUsdDebtId } });
    const body11 = await res11.json();
    assert(res11.status === 400 || res11.status === 500, 'Payment with insufficient safe balance rejected');
    assert(
      (body11.error || '').includes('لا يكفي لسداد الالتزام'),
      'Error message clarifies safe balance insufficiency',
      body11
    );

    // -------------------------------------------------------------------------
    // TEST 12: Currency Mismatch Rejection
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 12: Currency Mismatch Rejection ---');
    // Attempt to pay USD debt with EGP safe
    const req12 = createMockReq(`http://localhost:3000/api/v1/debts/${testPayableUsdDebtId}/payments`, 'POST', {
      amount: 100,
      accountId: egpSafe.id,
      notes: 'محاولة خلط عملات',
    }, adminToken);

    const res12 = await postDebtPayment(req12, { params: { id: testPayableUsdDebtId } });
    const body12 = await res12.json();
    assert(res12.status === 400 || res12.status === 500, 'Currency mismatch rejected');
    assert(
      (body12.error || '').includes('لا تطابق عملة الدين'),
      'Error message prevents cross-currency settlement',
      body12
    );

    // -------------------------------------------------------------------------
    // TEST 13: Strict RBAC Permission Check
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 13: Strict RBAC Permission Check ---');
    // Cashier attempts to create a debt -> should be 403
    const req13a = createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
      debtType: 'receivable',
      partyType: 'customer',
      partyName: 'طرف تجريبي',
      currency: 'EGP',
      originalAmount: 1000,
    }, cashierToken);

    const res13a = await postDebt(req13a);
    assert(res13a.status === 403, 'Cashier creating debt rejected with 403 Forbidden');

    // Cashier attempts to pay a debt -> should be 403
    const req13b = createMockReq(`http://localhost:3000/api/v1/debts/${testPayableUsdDebtId}/payments`, 'POST', {
      amount: 100,
      accountId: usdSafe.id,
    }, cashierToken);

    const res13b = await postDebtPayment(req13b, { params: { id: testPayableUsdDebtId } });
    assert(res13b.status === 403, 'Cashier settling debt payment rejected with 403 Forbidden');

    // Cashier attempts to cancel a debt -> should be 403
    const req13c = createMockReq(`http://localhost:3000/api/v1/debts/${testPayableUsdDebtId}`, 'DELETE', {}, cashierToken);
    const res13c = await deleteDebt(req13c, { params: { id: testPayableUsdDebtId } });
    assert(res13c.status === 403, 'Cashier deleting/cancelling debt rejected with 403 Forbidden');

    // -------------------------------------------------------------------------
    // TEST 14: Debt Cancellation (`DELETE /api/v1/debts/[id]`)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 14: Debt Cancellation & Safeguards ---');
    // Cannot cancel debt with existing payments (testReceivableDebt has 2 payments)
    const req14a = createMockReq(`http://localhost:3000/api/v1/debts/${testReceivableDebtId}`, 'DELETE', {
      reason: 'إلغاء خاطئ',
    }, adminToken);
    const res14a = await deleteDebt(req14a, { params: { id: testReceivableDebtId } });
    assert(res14a.status === 400, 'Debt with payment history cannot be cancelled without reversing payments first');

    // Create an unpaid debt to test legitimate cancellation
    const req14b = createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
      debtType: 'receivable',
      partyType: 'customer',
      partyName: `عميل ملغي ${ts}`,
      currency: 'SAR',
      originalAmount: 5000,
      description: 'دين سيتم إلغاؤه',
    }, adminToken);
    const res14b = await postDebt(req14b);
    const body14b = await res14b.json();
    const cancellableDebtId = body14b.data.id;

    // Now cancel it
    const req14c = createMockReq(`http://localhost:3000/api/v1/debts/${cancellableDebtId}`, 'DELETE', {
      reason: 'خطأ إدخال من المستخدم',
    }, adminToken);
    const res14c = await deleteDebt(req14c, { params: { id: cancellableDebtId } });
    const body14c = await res14c.json();
    assert(res14c.status === 200 && body14c.success === true, 'Unpaid debt cancelled successfully with 200');

    // Attempting to pay cancelled debt must be rejected
    const req14d = createMockReq(`http://localhost:3000/api/v1/debts/${cancellableDebtId}/payments`, 'POST', {
      amount: 1000,
      accountId: egpSafe.id,
    }, adminToken);
    const res14d = await postDebtPayment(req14d, { params: { id: cancellableDebtId } });
    assert(res14d.status === 400 || res14d.status === 500, 'Payment on cancelled debt is rejected');

    // -------------------------------------------------------------------------
    // TEST 15: Concurrency Safety and Row-Level Locks
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 15: Concurrency Safety Test ---');
    // Create a debt of 10,000 EGP
    const req15Debt = createMockReq('http://localhost:3000/api/v1/debts', 'POST', {
      debtType: 'receivable',
      partyType: 'customer',
      partyName: `عميل تزامن ${ts}`,
      currency: 'EGP',
      originalAmount: 10000,
      description: 'دين اختبار التزامن',
    }, adminToken);
    const res15Debt = await postDebt(req15Debt);
    const body15Debt = await res15Debt.json();
    const concurrentDebtId = body15Debt.data.id;

    // Fire 2 concurrent payments of 6,000 EGP each (Total 12,000 EGP > 10,000 EGP)
    const p1 = postDebtPayment(
      createMockReq(`http://localhost:3000/api/v1/debts/${concurrentDebtId}/payments`, 'POST', {
        amount: 6000,
        accountId: egpSafe.id,
        notes: 'الدفعة الأولى المتزامنة',
      }, adminToken),
      { params: { id: concurrentDebtId } }
    );

    const p2 = postDebtPayment(
      createMockReq(`http://localhost:3000/api/v1/debts/${concurrentDebtId}/payments`, 'POST', {
        amount: 6000,
        accountId: egpSafe.id,
        notes: 'الدفعة الثانية المتزامنة',
      }, adminToken),
      { params: { id: concurrentDebtId } }
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    const s1 = r1.status === 201;
    const s2 = r2.status === 201;
    assert(
      (s1 && !s2) || (!s1 && s2),
      'Concurrency control strictly enforced: exactly one transaction succeeded and the second failed overpayment guard'
    );

    const concurrentFinal = await prisma.debt.findUnique({ where: { id: concurrentDebtId } });
    assert(
      Number(concurrentFinal!.remainingAmount) === 4000,
      'Remaining amount after concurrent race is exactly 4,000 EGP without negative balance'
    );

    // -------------------------------------------------------------------------
    // TEST 16: Zero Inflation of Original Trade Revenues/Expenses
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 16: Zero Inflation of Revenues/Expenses ---');
    // Pure debt creation does not create income (4xxx) or expense (5xxx) ledger lines
    const pureDebtLines = await prisma.ledgerLine.findMany({
      where: {
        ledgerEntry: {
          referenceId: testReceivableDebtNumber,
        },
      },
      include: { account: true },
    });

    const hasRevenueOrExpense = pureDebtLines.some((l) =>
      l.account.accountType === 'revenue' ||
      l.account.accountType === 'expense' ||
      l.account.accountCode.startsWith('4') ||
      l.account.accountCode.startsWith('5')
    );
    assert(!hasRevenueOrExpense, 'Debts do not touch revenue (4xxx) or expense (5xxx) accounts');

    // -------------------------------------------------------------------------
    // TEST 17: Dashboard & Multi-Currency Isolated KPI Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 17: Dashboard & Multi-Currency Isolated KPIs ---');
    const req17 = createMockReq('http://localhost:3000/api/v1/reports/dashboard', 'GET', undefined, adminToken);
    const res17 = await getDashboard(req17);
    const body17 = await res17.json();
    assert(res17.status === 200 && body17.data?.kpi !== undefined, 'Dashboard returns 200 and KPIs', body17);
    assert(body17.data.kpi.debtsByCurrency !== undefined, 'Dashboard includes debtsByCurrency multi-currency breakdown');
    assert(
      typeof body17.data.kpi.debtsByCurrency.customerReceivables === 'object',
      'Customer receivables separated by currency'
    );
    assert(
      typeof body17.data.kpi.debtsByCurrency.supplierPayables === 'object',
      'Supplier payables separated by currency'
    );

    // Verify AuditLog entries
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'Debt',
        entityId: { in: [testReceivableDebtId, testPayableSdgDebtId, cancellableDebtId] },
      },
    });
    assert(auditLogs.length >= 2, 'AuditLog entries successfully recorded for debt creation and cancellation');

    console.log('\n================================================================');
    console.log(`   ALL 17 TESTS PASSED SUCCESSFULLY! (${passedTests}/${totalTests})`);
    console.log('================================================================\n');

  } finally {
    // Cleanup test artifacts
    console.log(' Cleaning up test artifacts...');
    await prisma.debtPayment.deleteMany({
      where: {
        debt: {
          description: { contains: `${ts}` },
        },
      },
    }).catch(() => {});

    await prisma.ledgerLine.deleteMany({
      where: {
        account: {
          accountCode: { contains: `${ts}` },
        },
      },
    }).catch(() => {});

    await prisma.ledgerEntry.deleteMany({
      where: {
        description: { contains: `${ts}` },
      },
    }).catch(() => {});

    await prisma.debt.deleteMany({
      where: {
        description: { contains: `${ts}` },
      },
    }).catch(() => {});

    await prisma.account.deleteMany({
      where: {
        accountCode: { contains: `${ts}` },
      },
    }).catch(() => {});
    console.log(' Cleanup completed.');
  }
}

runDebtsComprehensiveSuite()
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
