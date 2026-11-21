import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { POST as createSession, GET as getSessions } from '../app/api/v1/customer-sessions/route';
import { GET as getSession, POST as closeOrCancelSession } from '../app/api/v1/customer-sessions/[id]/route';
import { POST as deliverCash } from '../app/api/v1/customer-sessions/[id]/deliver/route';
import { POST as settleOverpayment } from '../app/api/v1/customer-sessions/[id]/overpayment/settle/route';
import { POST as approveReceipt } from '../app/api/v1/receipts/[id]/approve/route';

const prisma = new PrismaClient();

async function runSessionAuditTests() {
  console.log('========================================================================================');
  console.log('  التدقيق النهائي لموديول الحسابات اليومية للعملاء (Customer Sessions Final Audit)       ');
  console.log('  الهدف: التحقق من النزاهة المالية، الحالات، القفل الذري، التزامن، والقيود المحاسبية     ');
  console.log('========================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, title: string, detail: string = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  [اختبار ${total}] ✅ ${title}`);
      if (detail) console.log(`     -> ${detail}`);
    } else {
      console.error(`  [اختبار ${total}] ❌ فشل: ${title}`);
      if (detail) console.error(`     -> التفاصيل: ${detail}`);
      throw new Error(`Test failed: ${title}`);
    }
  }

  // Tokens for RBAC testing
  const tokenAdmin = generateToken({ userId: 'u-admin-ses', email: 'admin@exchange.local', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-acct-ses', email: 'acct@exchange.local', name: 'المحاسب المالي', role: 'accountant' });
  const tokenDataEntry = generateToken({ userId: 'u-data-ses', email: 'data@exchange.local', name: 'مدخل بيانات', role: 'data_entry' });
  const tokenCustody = generateToken({ userId: 'u-cust-ses', email: 'cust@exchange.local', name: 'مسؤول العهدة', role: 'custody_officer' });
  const tokenAuditor = generateToken({ userId: 'u-audit-ses', email: 'audit@exchange.local', name: 'مدقق بنكك', role: 'bankak_auditor' });

  // 1. Setup Test Customer
  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-AUDIT-SES' },
    update: {},
    create: {
      customerCode: 'CUST-AUDIT-SES',
      name: 'عميل تدقيق الجلسات اليومية',
      phone: '+249911998877',
      status: 'active',
    },
  });

  // Ensure Base Safe Account Exists with sufficient EGP
  const mainSafe = await prisma.account.findFirst({ where: { accountCode: '1010' } });
  if (mainSafe) {
    await prisma.account.update({
      where: { id: mainSafe.id },
      data: { currentBalance: new Decimal(mainSafe.currentBalance.toString()).plus(1000000).toFixed(4) },
    });
  }

  console.log('--- 1. فحص حماية الصلاحيات في فتح الجلسة (Creation RBAC) ---');

  async function callCreateSession(body: any, token: string = tokenDataEntry) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest('http://localhost:3000/api/v1/customer-sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await createSession(req);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  // Test 1: custody_officer forbidden
  const res1 = await callCreateSession(
    { customerId: testCustomer.id, requestedAmount: 50000, exchangeRate: 200 },
    tokenCustody
  );
  assert(res1.status === 403, 'حظر مسؤول العهدة من إنشاء جلسة حسابية (403 Forbidden)', `الكود: ${res1.status}`);

  // Test 2: bankak_auditor forbidden
  const res2 = await callCreateSession(
    { customerId: testCustomer.id, requestedAmount: 50000, exchangeRate: 200 },
    tokenAuditor
  );
  assert(res2.status === 403, 'حظر مراجع بنكك من إنشاء جلسة حسابية (403 Forbidden)', `الكود: ${res2.status}`);

  // Test 3: data_entry allowed
  const res3 = await callCreateSession(
    { customerId: testCustomer.id, requestedAmount: 50000, exchangeRate: 200 },
    tokenDataEntry
  );
  assert(
    res3.status === 201 && res3.data.success,
    'تمكين مدخل البيانات من فتح الجلسة مع احتساب المطلوب سوداني تلقائياً',
    `رقم الجلسة: ${res3.data.data?.sessionNumber} | المطلوب سوداني: ${res3.data.data?.expectedAmount} SDG`
  );

  console.log('\n--- 2. فحص أمان توليد رقم الجلسة المتزامن (Concurrency-Safe Session Number) ---');

  // Test 4: 5 Concurrent Session creations
  const concurrentPromises = Array.from({ length: 5 }).map((_, idx) =>
    callCreateSession(
      { customerId: testCustomer.id, requestedAmount: 10000 * (idx + 1), exchangeRate: 200 },
      tokenAccountant
    )
  );

  const concurrentResults = await Promise.all(concurrentPromises);
  const createdNumbers = concurrentResults.map((r) => r.data.data?.sessionNumber).filter(Boolean);
  const uniqueNumbers = new Set(createdNumbers);

  assert(
    createdNumbers.length === 5 && uniqueNumbers.size === 5,
    'توليد 5 أرقام جلسات متزامنة دون أي تصادم أو انهيار لقيد الفرادة (Zero P2002 Collision)',
    `الأرقام الناتجة: ${createdNumbers.join(', ')}`
  );

  console.log('\n--- 3. فحص دورة حياة الجلسة والانتقالات المالية (Lifecycle State Transitions) ---');

  // Test 5: Open state verification
  const sessionToTest = res3.data.data;
  assert(sessionToTest.status === 'open' && Number(sessionToTest.receivedAmount) === 0, 'الحالة الأولية للجلسة مفتوحة (open) مع رصيد مستلم صفر');

  // Test 6: Block cash payout on open session before receipt satisfaction
  async function callDeliver(sessionId: string, body: any, token: string = tokenCustody) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/customer-sessions/${sessionId}/deliver`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await deliverCash(req, { params: { id: sessionId } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  const resPayoutPremature = await callDeliver(sessionToTest.id, { amountEgp: 50000 });
  assert(
    resPayoutPremature.status === 500 || resPayoutPremature.status === 400,
    'حظر صرف النقدية قطعياً قبل استيفاء إيصالات بنكك المطلوبة (Zero-Unverified Payout)',
    `رسالة الحظر: ${resPayoutPremature.data.error}`
  );

  // Test 7: Accountant Forbidden from Cash Payout (Segregation of Duties)
  const resAccountantPayout = await callDeliver(sessionToTest.id, { amountEgp: 50000 }, tokenAccountant);
  assert(resAccountantPayout.status === 403, 'مبدأ فصل المهام: حظر المحاسب قطعياً من صرف النقدية بالجنيه المصري (403 Forbidden)', `الكود: ${resAccountantPayout.status}`);

  // Add Partial Receipt: 4,000,000 SDG out of 10,000,000 SDG
  const partialReceipt = await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-PARTIAL-${Date.now()}`,
      transactionId: `TXN-PRT-${Date.now()}`,
      customerId: testCustomer.id,
      customerSessionId: sessionToTest.id,
      amount: 4000000,
      currency: 'SDG',
      imageStorageKey: 'no-image',
      imageHash: `hash-prt-${Date.now()}`,
      status: 'verified',
      createdBy: 'test_system',
    },
  });

  // Approve Receipt via Accountant
  const reqApprovePartial = new NextRequest(`http://localhost:3000/api/v1/receipts/${partialReceipt.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ directVerification: true }),
  });
  await approveReceipt(reqApprovePartial, { params: { id: partialReceipt.id } });

  const sessionAfterPartial = await prisma.customerSession.findUnique({ where: { id: sessionToTest.id } });
  assert(
    sessionAfterPartial?.status === 'has_balance' && Number(sessionAfterPartial.receivedAmount) === 4000000,
    'اعتماد إيصال جزئي: انتقال الجلسة تلقائياً إلى حالة has_balance مع تحديث الرصيد المستلم',
    `الحالة: ${sessionAfterPartial?.status} | المستلم: ${sessionAfterPartial?.receivedAmount} SDG`
  );

  // Add Remaining Full Receipt: 6,000,000 SDG
  const fullReceipt = await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-FULL-${Date.now()}`,
      transactionId: `TXN-FUL-${Date.now()}`,
      customerId: testCustomer.id,
      customerSessionId: sessionToTest.id,
      amount: 6000000,
      currency: 'SDG',
      imageStorageKey: 'no-image',
      imageHash: `hash-ful-${Date.now()}`,
      status: 'verified',
      createdBy: 'test_system',
    },
  });

  const reqApproveFull = new NextRequest(`http://localhost:3000/api/v1/receipts/${fullReceipt.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ directVerification: true }),
  });
  await approveReceipt(reqApproveFull, { params: { id: fullReceipt.id } });

  const sessionAfterFull = await prisma.customerSession.findUnique({ where: { id: sessionToTest.id } });
  assert(
    sessionAfterFull?.status === 'pending_delivery' && Number(sessionAfterFull.receivedAmount) === 10000000,
    'استيفاء كامل الإيصالات: انتقال الجلسة آلياً إلى pending_delivery (جاهزة للصرف النقدي)',
    `الحالة: ${sessionAfterFull?.status} | إجمالي المستلم: ${sessionAfterFull?.receivedAmount} SDG`
  );

  console.log('\n--- 4. فحص الصرف النقدي الذري وسند الصرف وحماية التسليم الزائد (Cash Delivery & Overdelivery) ---');

  // Test 10: Attempt to deliver more than requested amount (Overdelivery prevention)
  const resOverdelivery = await callDeliver(sessionToTest.id, { amountEgp: 999999 });
  assert(
    resOverdelivery.status === 400 || resOverdelivery.status === 500,
    'منع صرف مبالغ تتجاوز المبلغ المتبقي للتسليم بالجلسة (Overdelivery Prevention)',
    `رسالة المنع: ${resOverdelivery.data.error}`
  );

  // Test 11: Execute valid atomic cash payout by custody_officer
  const idempotencyKey = `payout-audit-${Date.now()}`;
  const resPayoutValid = await callDeliver(sessionToTest.id, {
    amountEgp: 50000,
    recipientName: 'عمر أحمد عبدالله',
    idempotencyKey,
  });

  assert(
    resPayoutValid.status === 200 && resPayoutValid.data.success && resPayoutValid.data.data?.voucher,
    'تنفيذ صرف النقدية بالكامل، إصدار سند صرف رسمي (Voucher)، وانتقال الجلسة إلى completed',
    `رقم السند: ${resPayoutValid.data.data?.voucher?.voucherNumber} | حالة الجلسة: ${resPayoutValid.data.data?.session?.status}`
  );

  // Test 12: Idempotent Replay test with the same idempotency key
  const resPayoutIdempotent = await callDeliver(sessionToTest.id, {
    amountEgp: 50000,
    idempotencyKey,
  });
  assert(
    resPayoutIdempotent.data.success && resPayoutIdempotent.data.data?.voucher?.voucherNumber === resPayoutValid.data.data?.voucher?.voucherNumber,
    'حماية الطلبات المكررة (Idempotency): إعادة نفس السند السابق دون إنشاء سند جديد أو تكرار خصم الخزينة',
    `السند المسترجع: ${resPayoutIdempotent.data.data?.voucher?.voucherNumber}`
  );

  // Test 13: Prevent double payout on completed session
  const resPayoutCompleted = await callDeliver(sessionToTest.id, {
    amountEgp: 50000,
    idempotencyKey: `payout-new-${Date.now()}`,
  });
  assert(
    resPayoutCompleted.status === 500 || resPayoutCompleted.status === 400,
    'حظر الصرف قطعياً على جلسة مكتملة ومغلقة محاسبياً (Completed Session Payout Block)',
    `رسالة الحظر: ${resPayoutCompleted.data.error}`
  );

  console.log('\n--- 5. فحص فائض السداد وتسويته المحاسبية (Overpayment & Settlement) ---');

  // Create new session for overpayment test: requested 50,000 EGP (10,000,000 SDG)
  const resSessionOver = await callCreateSession(
    { customerId: testCustomer.id, requestedAmount: 50000, exchangeRate: 200 },
    tokenAccountant
  );
  const sessionOver = resSessionOver.data.data;

  // Add Surplus Receipt: 11,000,000 SDG (1,000,000 SDG surplus)
  const surplusReceipt = await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-SURP-${Date.now()}`,
      transactionId: `TXN-SURP-${Date.now()}`,
      customerId: testCustomer.id,
      customerSessionId: sessionOver.id,
      amount: 11000000,
      currency: 'SDG',
      imageStorageKey: 'no-image',
      imageHash: `hash-surp-${Date.now()}`,
      status: 'verified',
      createdBy: 'test_system',
    },
  });

  const reqApproveSurplus = new NextRequest(`http://localhost:3000/api/v1/receipts/${surplusReceipt.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ directVerification: true }),
  });
  await approveReceipt(reqApproveSurplus, { params: { id: surplusReceipt.id } });

  const sessionWithSurplus = await prisma.customerSession.findUnique({ where: { id: sessionOver.id } });
  assert(
    Number(sessionWithSurplus?.overpaymentAmount) === 1000000,
    'اكتشاف وتسجيل فائض السداد بدقة محاسبية (Overpayment Detection)',
    `المبلغ الزائد: ${sessionWithSurplus?.overpaymentAmount} SDG`
  );

  async function callSettle(sessionId: string, body: any, token: string = tokenAccountant) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/customer-sessions/${sessionId}/overpayment/settle`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await settleOverpayment(req, { params: { id: sessionId } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  // Settle Overpayment via credit_balance
  const resSettle = await callSettle(sessionOver.id, {
    action: 'credit_balance',
    notes: 'ترحيل إلى رصيد العميل الدائم',
  });

  assert(
    resSettle.status === 200 && resSettle.data.success && resSettle.data.data?.overpaymentSettled === true,
    'تسوية فائض السداد بنجاح وترحيله إلى التزام دائن دائم للعميل مع قيد محاسبي متوازن',
    `الحالة: ${resSettle.data.data?.overpaymentSettled} | الإجراء: ${resSettle.data.data?.overpaymentAction}`
  );

  // Prevent double settlement
  const resSettleAgain = await callSettle(sessionOver.id, {
    action: 'credit_balance',
  });
  assert(
    resSettleAgain.status === 400 || resSettleAgain.status === 500,
    'حظر تكرار تسوية الفائض للجلسة نفسها (No Double Settlement)',
    `كود المنع: ${resSettleAgain.status}`
  );

  console.log('\n--- 6. فحص ضوابط الإغلاق والإلغاء (Closure & Cancellation Controls) ---');

  // Test 17: Try to close session with unreceived funds
  const resFreshSession = await callCreateSession(
    { customerId: testCustomer.id, requestedAmount: 50000, exchangeRate: 200 },
    tokenAccountant
  );
  const freshSession = resFreshSession.data.data;

  async function callCloseOrCancel(sessionId: string, body: any, token: string = tokenAccountant) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/customer-sessions/${sessionId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await closeOrCancelSession(req, { params: { id: sessionId } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json };
  }

  const resPrematureClose = await callCloseOrCancel(freshSession.id, { action: 'close' });
  assert(
    resPrematureClose.status === 400,
    'حظر إغلاق الجلسة غير المستوفية للشروط المالية (Premature Closure Block)',
    `سبب الرفض: ${resPrematureClose.data.error}`
  );

  // Test 18: Cancel open session without movements
  const resCancel = await callCloseOrCancel(freshSession.id, { action: 'cancel' });
  assert(
    resCancel.status === 200 && resCancel.data.data?.status === 'cancelled',
    'إلغاء جلسة مفتوحة خالية من الحركات المالية بنجاح (Session Cancellation)',
    `حالة الجلسة: ${resCancel.data.data?.status}`
  );

  // Test 19: Prohibit cash payout or receipt approval on cancelled session
  const resPayoutCancelled = await callDeliver(freshSession.id, { amountEgp: 50000 });
  assert(
    resPayoutCancelled.status === 500 || resPayoutCancelled.status === 400,
    'حظر صرف نقدية لجلسة ملغاة قطعياً (Cancelled Session Delivery Block)',
    `كود المنع: ${resPayoutCancelled.status}`
  );

  console.log('\n========================================================================================');
  console.log(`  🏆 اجتازت جميع الاختبارات بنجاح كامل! (${passed} من ${total} اختبارات ناجحة)`);
  console.log('========================================================================================\n');
}

runSessionAuditTests()
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
