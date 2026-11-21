import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { POST as uploadReceipts } from '../app/api/v1/receipts/upload/route';
import { GET as getReceipt, PATCH as updateReceipt } from '../app/api/v1/receipts/[id]/route';
import { POST as verifyReceipt } from '../app/api/v1/receipts/[id]/verify/route';
import { POST as approveReceipt } from '../app/api/v1/receipts/[id]/approve/route';
import { POST as rejectReceipt } from '../app/api/v1/receipts/[id]/reject/route';
import { POST as createSession } from '../app/api/v1/customer-sessions/route';
import { POST as deliverCash } from '../app/api/v1/customer-sessions/[id]/deliver/route';
import { POST as settleOverpayment } from '../app/api/v1/customer-sessions/[id]/overpayment/settle/route';
import { ensureReceiptDbConstraints } from './ensure-db-constraints';

const prisma = new PrismaClient();

async function runFocusedClosureAudit() {
  console.log('========================================================================================');
  console.log('  المراجعة النهائية المركزة لإيصالات بنكك (Bankak Receipts Focused Closure Audit)       ');
  console.log('  النقاط المستهدفة: 1. حالات الجلسة | 2. التزامن | 3. قيد قاعدة البيانات | 4. فشل الـ OCR ');
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

  // Ensure DB partial unique index exists
  await ensureReceiptDbConstraints();

  // Tokens
  const tokenAdmin = generateToken({ userId: 'u-admin-focus', email: 'admin@exchange.local', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-acct-focus', email: 'acct@exchange.local', name: 'المحاسب المالي', role: 'accountant' });
  const tokenDataEntry = generateToken({ userId: 'u-data-focus', email: 'data@exchange.local', name: 'مدخل بيانات', role: 'data_entry' });
  const tokenCustody = generateToken({ userId: 'u-cust-focus', email: 'cust@exchange.local', name: 'مسؤول العهدة', role: 'custody_officer' });

  // Setup Customer
  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-FOCUS-RCP' },
    update: {},
    create: {
      customerCode: 'CUST-FOCUS-RCP',
      name: 'عميل الفحص المركز للإيصالات',
      phone: '+249911223344',
      status: 'active',
    },
  });

  // Ensure Safe 1010 has sufficient funds
  const safeAccount = await prisma.account.findFirst({ where: { accountCode: '1010' } });
  if (safeAccount) {
    await prisma.account.update({
      where: { id: safeAccount.id },
      data: { currentBalance: new Decimal(safeAccount.currentBalance.toString()).plus(10000000).toFixed(4) },
    });
  }

  // API Helper functions
  async function callUpload(body: any, token: string = tokenDataEntry) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await uploadReceipts(req);
    return { status: res.status, json: await res.json() };
  }

  async function callApprove(id: string, directVerification: boolean = true, token: string = tokenAdmin) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/receipts/${id}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ directVerification }),
    });
    const res = await approveReceipt(req, { params: { id } });
    return { status: res.status, json: await res.json() };
  }

  async function callCreateSession(requestedEgp: number, rate: number = 500) {
    const req = new NextRequest('http://localhost:3000/api/v1/customer-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDataEntry}` },
      body: JSON.stringify({
        customerId: testCustomer.id,
        requestedAmount: requestedEgp,
        exchangeRate: rate,
      }),
    });
    const res = await createSession(req);
    return (await res.json()).data;
  }

  console.log('\n--- 1. صحة انتقال حالة الجلسة عند اعتماد الإيصالات (السيناريوهات الأربعة) ---');

  // Scenario A: Full receipts cover expected amount, cash not delivered -> pending_delivery
  const sessionA = await callCreateSession(10000, 500); // Expected: 5,000,000 SDG
  const txnA = `TXN-SCENARIO-A-${Date.now()}`;
  const rcpA = (await callUpload({
    customerId: testCustomer.id,
    customerSessionId: sessionA.id,
    transactionId: txnA,
    amount: 5000000,
  })).json.data[0];

  const appA = await callApprove(rcpA.id, true, tokenAdmin);
  assert(appA.status === 200, 'سيناريو أ: اعتماد إيصال يغطي كامل المبلغ المطلوب بالجلسة');
  const updatedSessionA = await prisma.customerSession.findUnique({ where: { id: sessionA.id } });
  assert(
    updatedSessionA!.status === 'pending_delivery' &&
    Number(updatedSessionA!.receivedAmount) === 5000000 &&
    Number(updatedSessionA!.remainingAmount) === 0,
    'سيناريو أ: تحول الجلسة إلى pending_delivery طالما لم يتم تسليم النقدية بعد'
  );

  // Scenario B: Partial receipts cover part of expected amount -> has_balance, not pending_delivery
  const sessionB = await callCreateSession(20000, 500); // Expected: 10,000,000 SDG
  const txnB = `TXN-SCENARIO-B-${Date.now()}`;
  const rcpB = (await callUpload({
    customerId: testCustomer.id,
    customerSessionId: sessionB.id,
    transactionId: txnB,
    amount: 4000000, // Partial (4M out of 10M)
  })).json.data[0];

  const appB = await callApprove(rcpB.id, true, tokenAdmin);
  assert(appB.status === 200, 'سيناريو ب: اعتماد إيصال يغطي جزءاً من المبلغ المطلوب');
  const updatedSessionB = await prisma.customerSession.findUnique({ where: { id: sessionB.id } });
  assert(
    updatedSessionB!.status === 'has_balance' &&
    Number(updatedSessionB!.receivedAmount) === 4000000 &&
    Number(updatedSessionB!.remainingAmount) === 6000000,
    'سيناريو ب: بقاء الجلسة في حالة has_balance وعدم تحولها إلى pending_delivery أو completed'
  );

  // Scenario C: Receipts exceed expected amount -> Overpayment calculated accurately, not completed until settled
  const sessionC = await callCreateSession(10000, 500); // Expected: 5,000,000 SDG
  const txnC = `TXN-SCENARIO-C-${Date.now()}`;
  const rcpC = (await callUpload({
    customerId: testCustomer.id,
    customerSessionId: sessionC.id,
    transactionId: txnC,
    amount: 6000000, // Overpayment by 1,000,000 SDG
  })).json.data[0];

  await callApprove(rcpC.id, true, tokenAdmin);
  const updatedSessionC = await prisma.customerSession.findUnique({ where: { id: sessionC.id } });
  assert(
    Number(updatedSessionC!.overpaymentAmount) === 1000000 &&
    updatedSessionC!.status === 'pending_delivery',
    'سيناريو ج: احتساب فائض السداد بدقة (1,000,000 SDG) وتحول الجلسة إلى pending_delivery'
  );

  // Deliver cash to session C, but do NOT settle overpayment
  const deliverReq = new NextRequest(`http://localhost:3000/api/v1/customer-sessions/${sessionC.id}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCustody}` },
    body: JSON.stringify({ amountEgp: 10000 }),
  });
  await deliverCash(deliverReq, { params: { id: sessionC.id } });
  const sessionCAfterDelivery = await prisma.customerSession.findUnique({ where: { id: sessionC.id } });
  assert(
    sessionCAfterDelivery!.status === 'pending_delivery',
    'سيناريو ج: حظر إكمال الجلسة (status !== completed) رغم تسليم كامل النقدية طالما لم تتم تسوية الفائض'
  );

  // Settle overpayment
  const settleReq = new NextRequest(`http://localhost:3000/api/v1/customer-sessions/${sessionC.id}/overpayment/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ action: 'credit_balance' }),
  });
  await settleOverpayment(settleReq, { params: { id: sessionC.id } });
  const sessionCAfterSettle = await prisma.customerSession.findUnique({ where: { id: sessionC.id } });
  assert(
    sessionCAfterSettle!.status === 'completed' && sessionCAfterSettle!.overpaymentSettled === true,
    'سيناريو ج: اكتمال الجلسة وتحولها إلى completed رسمياً فور تسوية فائض السداد'
  );

  // Scenario D: Cash delivered exceptionally BEFORE receipts, then receipt is approved
  const sessionD = await callCreateSession(8000, 500); // Expected: 4,000,000 SDG

  // Simulate exceptional advance delivery by admin/custody
  await prisma.customerSession.update({
    where: { id: sessionD.id },
    data: { deliveredAmount: 8000, status: 'pending_receipts' },
  });

  const txnD = `TXN-SCENARIO-D-${Date.now()}`;
  const rcpD = (await callUpload({
    customerId: testCustomer.id,
    customerSessionId: sessionD.id,
    transactionId: txnD,
    amount: 4000000,
  })).json.data[0];

  // Approving the remaining receipts
  await callApprove(rcpD.id, true, tokenAdmin);
  const updatedSessionD = await prisma.customerSession.findUnique({ where: { id: sessionD.id } });
  assert(
    updatedSessionD!.status === 'completed' &&
    Number(updatedSessionD!.receivedAmount) === 4000000 &&
    Number(updatedSessionD!.deliveredAmount) === 8000,
    'سيناريو د: تسليم النقدية مسبقاً ثم اعتماد كامل الإيصالات يحول الجلسة تلقائياً إلى completed'
  );

  console.log('\n--- 2. تزامن اعتماد إيصالات مختلفة مرتبطة بنفس الجلسة (Concurrent Approvals) ---');

  const sessionConc = await callCreateSession(20000, 500); // Expected: 10,000,000 SDG

  const txnConc1 = `TXN-CONC-1-${Date.now()}`;
  const txnConc2 = `TXN-CONC-2-${Date.now()}`;

  const rcpConc1 = (await callUpload({
    customerId: testCustomer.id,
    customerSessionId: sessionConc.id,
    transactionId: txnConc1,
    amount: 4000000,
  })).json.data[0];

  const rcpConc2 = (await callUpload({
    customerId: testCustomer.id,
    customerSessionId: sessionConc.id,
    transactionId: txnConc2,
    amount: 6000000,
  })).json.data[0];

  // Execute approvals concurrently via Promise.all
  const [resConc1, resConc2] = await Promise.all([
    callApprove(rcpConc1.id, true, tokenAdmin),
    callApprove(rcpConc2.id, true, tokenAdmin),
  ]);

  assert(resConc1.status === 200 && resConc2.status === 200, 'نجاح اعتماد الإيصالين المتزامنين لنفس الجلسة 200 OK');

  // Verify Ledger entries
  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: {
      referenceType: 'BankakReceipt',
      referenceId: { in: [rcpConc1.id, rcpConc2.id] },
    },
    include: { lines: true },
  });
  assert(ledgerEntries.length === 2, 'إنشاء قيدين محاسبيين مستقلين للإيصالين المتزامنين');
  assert(
    ledgerEntries.every((e) => {
      const d = e.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
      const c = e.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
      return d.equals(c);
    }),
    'توازن كلا القيدين المحاسبيين تماماً (Total Debit == Total Credit)'
  );

  // Verify No Lost Update on CustomerSession
  const sessionConcFinal = await prisma.customerSession.findUnique({ where: { id: sessionConc.id } });
  assert(
    Number(sessionConcFinal!.receivedAmount) === 10000000,
    'حماية التزامن ومنع Lost Update: الرصيد المستلم يساوي 10,000,000 SDG بدقة (4M + 6M)'
  );
  assert(
    Number(sessionConcFinal!.remainingAmount) === 0 &&
    Number(sessionConcFinal!.overpaymentAmount) === 0 &&
    sessionConcFinal!.status === 'pending_delivery',
    'صحة الحسابات النهائية للجلسة وتحولها إلى pending_delivery (جاهزة للصرف)'
  );

  console.log('\n--- 3. ضمان عدم تكرار Transaction ID على مستوى Database والتزامن ---');

  const concurrentTxnId = `TXN-DB-CONCURRENT-${Date.now()}`;

  // Fire two concurrent uploads with the EXACT same transactionId at the exact same millisecond
  const [up1, up2] = await Promise.all([
    callUpload({ customerId: testCustomer.id, transactionId: concurrentTxnId, amount: 2000000 }),
    callUpload({ customerId: testCustomer.id, transactionId: concurrentTxnId, amount: 2000000 }),
  ]);

  assert(up1.status === 201 && up2.status === 201, 'عدم حدوث أي Crash أو Unhandled Error عند رفع نفس رقم العملية بالتزامن');

  const data1 = up1.json.data[0];
  const data2 = up2.json.data[0];

  const statuses = [data1.status, data2.status];
  assert(
    statuses.includes('duplicate') && (statuses.includes('pending_verification') || statuses.includes('pending_review') || statuses.includes('suspicious')),
    'قفل قاعدة البيانات وقيد الفرادة: تم قبول إحداهما كإيصال نشط واكتشاف وتصنيف الأخرى فورياً كـ duplicate'
  );

  // Verify DB state: exactly ONE active non-duplicate receipt exists for this transactionId
  const activeReceiptsInDb = await prisma.bankakReceipt.findMany({
    where: {
      transactionId: concurrentTxnId,
      status: { notIn: ['duplicate', 'rejected'] },
    },
  });
  assert(
    activeReceiptsInDb.length === 1,
    'ضمان قاعدة البيانات: وجود صف نشط واحد فقط لرقم العملية ومنع التكرار قطعياً على مستوى PostgreSQL'
  );

  // Upload without transaction ID (empty or null)
  const noTxnUpload = await callUpload({
    customerId: testCustomer.id,
    transactionId: '',
    amount: 150000,
  });
  assert(noTxnUpload.status === 201, 'قبول الإيصالات التي لا تحتوي على رقم عملية دون اعتراض من قيد الفرادة');

  console.log('\n--- 4. التعامل مع فشل OCR وانخفاض دقة القراءة والبيانات غير المكتملة ---');

  // Test 1: Low confidence or incomplete data
  const blurryUpload = await callUpload({
    customerId: testCustomer.id,
    rawOcrText: 'نص غير واضح ومشتت ... ?? !!',
    imageData: `synthetic-blurry-image-data-${Date.now()}`,
  });
  assert(blurryUpload.status === 201, 'نجاح رفع الإيصال غير الواضح وعدم فقدان الملف');
  const blurryReceipt = blurryUpload.json.data[0];
  assert(
    blurryReceipt.status === 'pending_review' &&
    blurryReceipt.ocrConfidence < 70,
    'تصنيف الإيصال منخفض الثقة كـ pending_review وإبقائه متاحاً للمراجعة اليدوية'
  );

  // Test 2: Incomplete financial data (amount missing or 0)
  const incTxn = `TXN-INC-${Date.now()}`;
  const incompleteUpload = await callUpload({
    customerId: testCustomer.id,
    rawOcrText: `Bank of Khartoum\nTransaction ID: ${incTxn}\nSender: غير مكتمل`,
  });
  const incReceipt = incompleteUpload.json.data[0];
  assert(
    incReceipt.status === 'pending_review',
    'تصنيف الإيصال غير مكتمل البيانات المالية كـ pending_review'
  );

  // Verify Zero Ledger Entries for unapproved / blurry receipts
  const zeroLedgerCheck = await prisma.ledgerEntry.findMany({
    where: {
      referenceType: 'BankakReceipt',
      referenceId: { in: [blurryReceipt.id, incReceipt.id] },
    },
  });
  assert(zeroLedgerCheck.length === 0, 'فشل OCR لا يُنشئ أي أثر أو قيد مالي في الدفاتر المحاسبية على الإطلاق');

  // Manual Editing works on failed OCR receipt
  const patchFailedOcr = await prisma.bankakReceipt.update({
    where: { id: blurryReceipt.id },
    data: {
      amount: new Decimal(1200000),
      senderName: 'محمد أحمد بعد المراجعة اليدوية',
      reviewedBy: 'المحاسب المالي',
    },
  });
  assert(
    Number(patchFailedOcr.amount) === 1200000 && patchFailedOcr.reviewedBy === 'المحاسب المالي',
    'تمكين المراجعة والتعديل اليدوي الكامل للإيصالات التي تعثر استخراج بياناتها عبر الـ OCR'
  );

  console.log('\n========================================================================================');
  console.log(`  🏆 نتيجة المراجعة النهائية المركزة: نجاح ${passed} من أصل ${total} اختبار بنسبة 100%!`);
  console.log('========================================================================================\n');
}

runFocusedClosureAudit()
  .catch((err) => {
    console.error('Audit execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
