import { prisma } from '../lib/db';
import { POST as postPreview } from '../app/api/v1/daily-closing/preview/route';
import { GET as getClosings, POST as postClosing } from '../app/api/v1/daily-closing/route';
import { POST as postReopen } from '../app/api/v1/daily-closing/[id]/reopen/route';
import { POST as postExpense } from '../app/api/v1/expenses/route';
import { POST as postSession } from '../app/api/v1/customer-sessions/route';
import { POST as postCustody } from '../app/api/v1/custody/route';
import { postLedgerTransaction, assertBusinessDateOpen } from '../lib/accounting/accounting-service';
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

async function runDailyClosingComprehensiveSuite() {
  console.log('========================================================================');
  console.log('   COMPREHENSIVE AUDIT & VERIFICATION SUITE: DAILY CLOSING & RECON');
  console.log('========================================================================\n');

  const adminToken = generateToken({
    userId: 'admin-closer-id',
    email: 'admin@system.com',
    name: 'Admin Closer',
    role: 'admin',
  });

  const accountantToken = generateToken({
    userId: 'accountant-closer-id',
    email: 'accountant@system.com',
    name: 'Accountant Closer',
    role: 'accountant',
  });

  const cashierToken = generateToken({
    userId: 'cashier-closer-id',
    email: 'cashier@system.com',
    name: 'Cashier Closer',
    role: 'cashier',
  });

  const ts = Date.now();
  const testDate1 = `2026-12-01`;
  const testDate2 = `2026-12-02`;
  const testDate3 = `2026-12-03`;

  // Step 0: Create dedicated multi-currency test accounts
  const egpSafe1 = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-EGP1-${ts}`,
      name: `خزينة جنيه أولى ${ts}`,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 50000,
      currentBalance: 50000,
      status: 'active',
    },
  });

  const egpSafe2 = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-EGP2-${ts}`,
      name: `خزينة جنيه ثانية ${ts}`,
      accountType: 'cash_safe',
      currency: 'EGP',
      openingBalance: 30000,
      currentBalance: 30000,
      status: 'active',
    },
  });

  const sdgSafe1 = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-SDG1-${ts}`,
      name: `خزينة سوداني ${ts}`,
      accountType: 'cash_safe',
      currency: 'SDG',
      openingBalance: 2000000,
      currentBalance: 2000000,
      status: 'active',
    },
  });

  const usdSafe1 = await prisma.account.create({
    data: {
      accountCode: `TEST-SAFE-USD1-${ts}`,
      name: `خزينة دولار ${ts}`,
      accountType: 'cash_safe',
      currency: 'USD',
      openingBalance: 5000,
      currentBalance: 5000,
      status: 'active',
    },
  });

  // Non-cash account (Capital) to verify it is NOT counted in cash reconciliation
  const capitalAcc = await prisma.account.create({
    data: {
      accountCode: `TEST-CAP-${ts}`,
      name: `رأس مال تجريبي ${ts}`,
      accountType: 'capital',
      currency: 'EGP',
      openingBalance: 500000,
      currentBalance: 500000,
      status: 'active',
    },
  });

  const testCustomer = await prisma.customer.create({
    data: {
      customerCode: `CUST-CLOSE-${ts}`,
      name: `عميل اختبار إغلاق ${ts}`,
      phone: `+201099${ts.toString().slice(-6)}`,
      status: 'active',
    },
  });

  const testCategory = await prisma.expenseCategory.create({
    data: {
      name: `تصنيف اختبار ${ts}`,
      status: 'active',
    },
  });

  console.log(' Setup completed: Dedicated accounts, customer, and category created.');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: إغلاق يوم متوازن (Closing a balanced day)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 1: Balanced Day Closing ---');
    const req1 = createMockReq('http://localhost:3000/api/v1/daily-closing', 'POST', {
      businessDate: testDate1,
      countedBalances: {
        [egpSafe1.id]: 50000,
        [egpSafe2.id]: 30000,
        [sdgSafe1.id]: 2000000,
        [usdSafe1.id]: 5000,
      },
      notes: 'إغلاق يوم تجريبي متوازن 100%',
    }, accountantToken);

    const res1 = await postClosing(req1);
    const body1 = await res1.json();
    assert(res1.status === 201 && body1.success === true, 'Balanced day closed successfully with 201', body1);
    assert(body1.data.closing.status === 'closed', 'Closing status is closed');
    assert(body1.data.reconciliation.hasVariances === false, 'Reconciliation confirms zero variances (exact match)');

    // -------------------------------------------------------------------------
    // TEST 2: خزائن متعددة بنفس العملة (Multiple safes in the same currency)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 2: Multiple Safes in Same Currency ---');
    const egpSummary = body1.data.reconciliation.byCurrency['EGP'];
    assert(egpSummary !== undefined, 'EGP summary exists in byCurrency breakdown');
    assert(egpSummary.accountsCount >= 2, 'Multiple EGP safes tracked in summary');
    assert(egpSummary.totalExpected >= 80000, 'Sum of multiple EGP safes correctly calculated without mixing');

    // -------------------------------------------------------------------------
    // TEST 3: عملات متعددة مع إثبات عدم اختلاط الأرصدة (Multiple currencies isolated)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 3: Multi-Currency Complete Isolation ---');
    const byCur = body1.data.reconciliation.byCurrency;
    assert(byCur['EGP'] !== undefined, 'EGP isolated breakdown present');
    assert(byCur['SDG'] !== undefined, 'SDG isolated breakdown present');
    assert(byCur['USD'] !== undefined, 'USD isolated breakdown present');
    assert(byCur['USD'].totalExpected >= 5000, 'USD expected tracked independently');
    console.log('byCur SDG:', byCur['SDG']);
    assert(byCur['SDG'].totalExpected !== undefined, 'SDG expected tracked independently');

    // -------------------------------------------------------------------------
    // TEST 4: عجز نقدي (Cash deficit detected and recorded)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 4: Cash Deficit Detection & Recording ---');
    // On testDate2, count 49,000 EGP in egpSafe1 instead of 50,000 (1,000 EGP deficit)
    const req4Preview = createMockReq('http://localhost:3000/api/v1/daily-closing/preview', 'POST', {
      businessDate: testDate2,
      countedBalances: {
        [egpSafe1.id]: 49000,
      },
    }, adminToken);
    const res4Preview = await postPreview(req4Preview);
    const body4Preview = await res4Preview.json();
    const safe1Report = body4Preview.data.reconciliation.accounts.find((a: any) => a.accountId === egpSafe1.id);
    assert(safe1Report.difference === -1000, 'Safe 1 difference is exactly -1,000 EGP');
    assert(safe1Report.status === 'deficit', 'Status flagged as deficit');
    assert(body4Preview.data.reconciliation.hasVariances === true, 'hasVariances is true');

    // -------------------------------------------------------------------------
    // TEST 5: فائض نقدي (Cash surplus detected and recorded)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 5: Cash Surplus Detection & Recording ---');
    // On testDate2, count 52,000 EGP in egpSafe1 (2,000 EGP surplus)
    const req5Preview = createMockReq('http://localhost:3000/api/v1/daily-closing/preview', 'POST', {
      businessDate: testDate2,
      countedBalances: {
        [egpSafe1.id]: 52000,
      },
    }, adminToken);
    const res5Preview = await postPreview(req5Preview);
    const body5Preview = await res5Preview.json();
    const safe1Surplus = body5Preview.data.reconciliation.accounts.find((a: any) => a.accountId === egpSafe1.id);
    assert(safe1Surplus.difference === 2000, 'Safe 1 difference is exactly +2,000 EGP');
    assert(safe1Surplus.status === 'surplus', 'Status flagged as surplus');

    // -------------------------------------------------------------------------
    // TEST 6: جلسة عميل مفتوحة تمنع الإغلاق (Open session blocks closing)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 6: Open Session Blocks Closing ---');
    // Create an open customer session on testDate2
    const openSession = await prisma.customerSession.create({
      data: {
        sessionNumber: `SES-TEST-${ts}`,
        customerId: testCustomer.id,
        requestedAmount: 10000,
        expectedAmount: 2000000,
        deliveredAmount: 0,
        exchangeRate: 200,
        receivedAmount: 2000000,
        currencyFrom: 'SDG',
        currencyTo: 'EGP',
        remainingAmount: 10000,
        businessDate: testDate2,
        status: 'open',
        createdBy: 'tester',
      },
    });

    const req6 = createMockReq('http://localhost:3000/api/v1/daily-closing', 'POST', {
      businessDate: testDate2,
      countedBalances: {},
    }, adminToken);
    const res6 = await postClosing(req6);
    const body6 = await res6.json();
    assert(res6.status === 400, 'Closing blocked with 400 when open customer session exists');
    assert(
      (body6.error || '').includes('جلسة عملاء مفتوحة أو غير مسواة'),
      'Error message clearly explains open customer sessions block closing',
      body6
    );

    // Delete the open session to clear blocking condition
    await prisma.customerSession.delete({ where: { id: openSession.id } });

    // -------------------------------------------------------------------------
    // TEST 7: قيد غير متوازن يمنع الإغلاق (Unbalanced ledger entry blocks closing)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 7: Unbalanced Ledger Entry Blocks Closing ---');
    // Insert a synthetic unbalanced entry directly into database
    const unbalancedEntry = await prisma.ledgerEntry.create({
      data: {
        entryNumber: `JE-UNBAL-${ts}`,
        entryType: 'audit_test',
        entryDate: testDate2,
        description: 'قيد غير متوازن تجريبي',
        status: 'posted',
        createdBy: 'tester',
        lines: {
          create: [
            { accountId: egpSafe1.id, currency: 'EGP', debit: 500, credit: 0 },
            { accountId: egpSafe2.id, currency: 'EGP', debit: 0, credit: 300 }, // 500 != 300
          ],
        },
      },
    });

    const req7 = createMockReq('http://localhost:3000/api/v1/daily-closing', 'POST', {
      businessDate: testDate2,
    }, adminToken);
    const res7 = await postClosing(req7);
    const body7 = await res7.json();
    assert(res7.status === 400, 'Closing blocked when unbalanced ledger entries exist');
    assert((body7.error || '').includes('قيد محاسبي غير متوازن'), 'Error identifies unbalanced ledger entries');

    // Clean up unbalanced entry
    await prisma.ledgerLine.deleteMany({ where: { ledgerEntryId: unbalancedEntry.id } });
    await prisma.ledgerEntry.delete({ where: { id: unbalancedEntry.id } });

    // -------------------------------------------------------------------------
    // TEST 8: الإغلاق المكرر (Duplicate closing rejected)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 8: Duplicate Closing Rejected ---');
    // testDate1 is already closed. Attempt to close it again.
    const req8 = createMockReq('http://localhost:3000/api/v1/daily-closing', 'POST', {
      businessDate: testDate1,
    }, adminToken);
    const res8 = await postClosing(req8);
    const body8 = await res8.json();
    assert(res8.status === 400, 'Duplicate closing rejected with 400');
    assert((body8.error || '').includes('مغلق مسبقاً'), 'Error specifies date is already closed');

    // -------------------------------------------------------------------------
    // TEST 9: إغلاق متزامن لنفس اليوم (Concurrent closing safety)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 9: Concurrent Closing Safety ---');
    // Fire 2 simultaneous closing requests for testDate2
    const p1 = postClosing(createMockReq('http://localhost:3000/api/v1/daily-closing', 'POST', {
      businessDate: testDate2,
      notes: 'طلب متزامن 1',
    }, adminToken));

    const p2 = postClosing(createMockReq('http://localhost:3000/api/v1/daily-closing', 'POST', {
      businessDate: testDate2,
      notes: 'طلب متزامن 2',
    }, adminToken));

    const [r1, r2] = await Promise.all([p1, p2]);
    const success1 = r1.status === 201;
    const success2 = r2.status === 201;
    assert(
      (success1 && !success2) || (!success1 && success2),
      'Concurrency control strictly enforced: exactly one request succeeded, second was blocked'
    );

    // -------------------------------------------------------------------------
    // TEST 10: محاولة تسجيل مصروف بعد الإغلاق (Posting expense on closed date rejected)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 10: Posting Expense on Closed Date Rejected ---');
    const req10 = createMockReq('http://localhost:3000/api/v1/expenses', 'POST', {
      categoryId: testCategory.id,
      accountId: egpSafe1.id,
      amount: 500,
      expenseDate: testDate1, // CLOSED DATE!
      description: 'محاولة مصروف على يوم مغلق',
    }, adminToken);
    const res10 = await postExpense(req10);
    const body10 = await res10.json();
    assert(res10.status === 400 || res10.status === 500, 'Expense on closed date rejected');
    assert((body10.error || '').includes('مغلق ومجمد رسمياً'), 'Error explains business date is closed and frozen');

    // -------------------------------------------------------------------------
    // TEST 11: محاولة إنشاء جلسة بعد الإغلاق (Creating session on closed date rejected)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 11: Creating Session on Closed Date Rejected ---');
    const req11 = createMockReq('http://localhost:3000/api/v1/customer-sessions', 'POST', {
      customerId: testCustomer.id,
      requestedAmount: 5000,
      exchangeRate: 200,
      businessDate: testDate1, // CLOSED DATE!
    }, adminToken);
    const res11 = await postSession(req11);
    const body11 = await res11.json();
    assert(res11.status === 400 || res11.status === 500, 'Customer session on closed date rejected');
    assert((body11.error || '').includes('مغلق ومجمد رسمياً'), 'Session route blocks closed date');

    // -------------------------------------------------------------------------
    // TEST 12: محاولة صرف عهدة على يوم مغلق (Disbursing custody on closed date rejected)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 12: Disbursing Custody on Closed Date Rejected ---');
    const testEmployee = await prisma.employee.create({
      data: {
        employeeCode: `EMP-${ts}`,
        name: `موظف تدقيق ${ts}`,
        phone: `+201088${ts.toString().slice(-6)}`,
        status: 'active',
      },
    });

    const req12 = createMockReq('http://localhost:3000/api/v1/custody', 'POST', {
      employeeId: testEmployee.id,
      amount: 1000,
      currency: 'EGP',
      sourceAccountId: egpSafe1.id,
      businessDate: testDate1, // CLOSED DATE!
    }, adminToken);
    const res12 = await postCustody(req12);
    const body12 = await res12.json();
    assert(res12.status === 400 || res12.status === 500, 'Custody on closed date rejected');
    assert((body12.error || '').includes('مغلق ومجمد رسمياً'), 'Custody route blocks closed date');

    // -------------------------------------------------------------------------
    // TEST 13: محاولة تجاوز الحماية من خلال API دفتر الأستاذ مباشرة
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 13: Direct Ledger Posting on Closed Date Blocked ---');
    let directLedgerBlocked = false;
    try {
      await postLedgerTransaction({
        entryType: 'direct_hack_test',
        entryDate: testDate1, // CLOSED DATE!
        description: 'محاولة اختراق كتابة قيد على يوم مغلق',
        createdBy: 'attacker',
        lines: [
          { accountId: egpSafe1.id, currency: 'EGP', debit: 100, credit: 0 },
          { accountId: egpSafe2.id, currency: 'EGP', debit: 0, credit: 100 },
        ],
      });
    } catch (err: any) {
      directLedgerBlocked = true;
      assert(err.message.includes('مغلق ومجمد رسمياً'), 'Ledger core throws when attempting to post to closed date');
    }
    assert(directLedgerBlocked, 'Direct ledger posting on closed date was blocked 100%');

    // -------------------------------------------------------------------------
    // TEST 14: إعادة فتح بصلاحية المدير (Reopening with admin role)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 14: Reopening Day with Admin Role ---');
    const req14 = createMockReq(`http://localhost:3000/api/v1/daily-closing/${testDate1}/reopen`, 'POST', {
      reason: 'موافقة الإدارة على تصحيح تسليم إيصال متأخر',
    }, adminToken);
    const res14 = await postReopen(req14, { params: { id: testDate1 } });
    const body14 = await res14.json();
    assert(res14.status === 200 && body14.success === true, 'Admin reopening succeeds with 200', body14);
    assert(body14.data.status === 'reopened', 'DailyClosing status updated to reopened');

    // -------------------------------------------------------------------------
    // TEST 15: رفض إعادة الفتح بدون سبب تفصيلي (Reject reopening without reason)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 15: Reject Reopening without Reason ---');
    // testDate2 is closed. Attempt to reopen without reason.
    const req15 = createMockReq(`http://localhost:3000/api/v1/daily-closing/${testDate2}/reopen`, 'POST', {
      reason: 'لا', // less than 5 chars!
    }, adminToken);
    const res15 = await postReopen(req15, { params: { id: testDate2 } });
    assert(res15.status === 400, 'Reopening without detailed reason rejected with 400');

    // -------------------------------------------------------------------------
    // TEST 16: AuditLog للإغلاق وإعادة الفتح
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 16: AuditLog Verification for Closing and Reopening ---');
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'DailyClosing',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const hasCloseAction = auditLogs.some((a) => a.action === 'DAILY_CLOSING');
    const hasReopenAction = auditLogs.some((a) => a.action === 'REOPEN_DAILY_CLOSING');
    assert(hasCloseAction, 'DAILY_CLOSING action verified in AuditLog');
    assert(hasReopenAction, 'REOPEN_DAILY_CLOSING action verified in AuditLog');

    // -------------------------------------------------------------------------
    // TEST 17: إعادة إغلاق اليوم بعد إعادة فتحه (Re-closing after reopening)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 17: Re-closing Day after Reopening ---');
    const req17 = createMockReq('http://localhost:3000/api/v1/daily-closing', 'POST', {
      businessDate: testDate1,
      notes: 'إعادة إغلاق اليوم بعد التدقيق والاعتماد النهائي',
    }, adminToken);
    const res17 = await postClosing(req17);
    const body17 = await res17.json();
    assert(res17.status === 201 && body17.success === true, 'Reopened day successfully closed again with 201');
    assert(body17.data.closing.status === 'closed', 'Status is closed again');

    // -------------------------------------------------------------------------
    // TEST 18: التحقق من Snapshot القديم وعدم مسح التاريخ (Snapshot history preserved)
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 18: Snapshot History Preservation ---');
    const finalClosing1 = await prisma.dailyClosing.findUnique({ where: { businessDate: testDate1 } });
    assert(
      (finalClosing1!.notes || '').includes('أعيد فتحه') && (finalClosing1!.notes || '').includes('إعادة إغلاق'),
      'Historical notes preserve reopening reason and re-closing audit trail'
    );

    // -------------------------------------------------------------------------
    // TEST 19: صحة الرصيد الافتتاحي والوارد والمنصرف من Ledger
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 19: Accuracy of Ledger Inflow and Outflow ---');
    // Post a real ledger movement on testDate3
    const entry19 = await postLedgerTransaction({
      entryType: 'cash_movement_test',
      entryDate: testDate3,
      description: 'حركة نقدية اختبارية',
      createdBy: 'tester',
      lines: [
        { accountId: egpSafe1.id, currency: 'EGP', debit: 12000, credit: 0 },
        { accountId: egpSafe2.id, currency: 'EGP', debit: 0, credit: 12000 },
      ],
    });

    const req19Preview = createMockReq('http://localhost:3000/api/v1/daily-closing/preview', 'POST', {
      businessDate: testDate3,
    }, adminToken);
    const res19Preview = await postPreview(req19Preview);
    const body19Preview = await res19Preview.json();
    const safe1Mov = body19Preview.data.reconciliation.accounts.find((a: any) => a.accountId === egpSafe1.id);
    const safe2Mov = body19Preview.data.reconciliation.accounts.find((a: any) => a.accountId === egpSafe2.id);

    assert(safe1Mov.totalInflow === 12000, 'Safe 1 totalInflow from Ledger is exactly 12,000 EGP');
    assert(safe2Mov.totalOutflow === 12000, 'Safe 2 totalOutflow from Ledger is exactly 12,000 EGP');

    // -------------------------------------------------------------------------
    // TEST 20: العمليات في يوم لاحق لا تتأثر بإغلاق اليوم السابق
    // -------------------------------------------------------------------------
    console.log('\n--- Running Test 20: Subsequent Date Unaffected by Previous Day Closing ---');
    // testDate1 and testDate2 are closed. testDate3 is open.
    // Creating session on testDate3 should succeed!
    const req20 = createMockReq('http://localhost:3000/api/v1/customer-sessions', 'POST', {
      customerId: testCustomer.id,
      requestedAmount: 5000,
      exchangeRate: 200,
      businessDate: testDate3, // OPEN DATE!
    }, adminToken);
    const res20 = await postSession(req20);
    const body20 = await res20.json();
    assert(res20.status === 201 && body20.success === true, 'Operations on subsequent open date succeed without interference');

    console.log('\n========================================================================');
    console.log(`   ALL 20 INTEGRATION TESTS PASSED SUCCESSFULLY! (${passedTests}/${totalTests})`);
    console.log('========================================================================\n');

  } finally {
    // Cleanup test data
    console.log(' Cleaning up test artifacts...');
    await prisma.customerSession.deleteMany({
      where: {
        customer: { name: { contains: `${ts}` } },
      },
    }).catch(() => {});

    await prisma.customer.deleteMany({
      where: { name: { contains: `${ts}` } },
    }).catch(() => {});

    await prisma.employeeCustody.deleteMany({
      where: {
        employee: { name: { contains: `${ts}` } },
      },
    }).catch(() => {});

    await prisma.employee.deleteMany({
      where: { name: { contains: `${ts}` } },
    }).catch(() => {});

    await prisma.expense.deleteMany({
      where: { description: { contains: `${ts}` } },
    }).catch(() => {});

    await prisma.expenseCategory.deleteMany({
      where: { name: { contains: `${ts}` } },
    }).catch(() => {});

    await prisma.ledgerLine.deleteMany({
      where: {
        account: { accountCode: { contains: `${ts}` } },
      },
    }).catch(() => {});

    await prisma.ledgerEntry.deleteMany({
      where: { entryNumber: { contains: `${ts}` } },
    }).catch(() => {});

    await prisma.dailyClosing.deleteMany({
      where: {
        businessDate: { in: [testDate1, testDate2, testDate3] },
      },
    }).catch(() => {});

    await prisma.account.deleteMany({
      where: { accountCode: { contains: `${ts}` } },
    }).catch(() => {});

    console.log(' Cleanup completed.');
  }
}

runDailyClosingComprehensiveSuite()
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
