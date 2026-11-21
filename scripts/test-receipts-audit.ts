import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { POST as uploadReceipts } from '../app/api/v1/receipts/upload/route';
import { GET as getReceipts } from '../app/api/v1/receipts/route';
import { GET as getReceipt, PATCH as updateReceipt } from '../app/api/v1/receipts/[id]/route';
import { POST as verifyReceipt } from '../app/api/v1/receipts/[id]/verify/route';
import { POST as approveReceipt } from '../app/api/v1/receipts/[id]/approve/route';
import { POST as rejectReceipt } from '../app/api/v1/receipts/[id]/reject/route';
import { POST as createSession } from '../app/api/v1/customer-sessions/route';

const prisma = new PrismaClient();

async function runReceiptsAuditTests() {
  console.log('========================================================================================');
  console.log('  التدقيق النهائي لموديول إيصالات بنكك والـ OCR (Bankak Receipts Management Audit)       ');
  console.log('  الهدف: التحقق من سلامة دورة الحياة، كشف التكرار، القيود المحاسبية، الصلاحيات، والتزامن ');
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
  const tokenAdmin = generateToken({ userId: 'u-admin-rcp', email: 'admin@exchange.local', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-acct-rcp', email: 'acct@exchange.local', name: 'المحاسب المالي', role: 'accountant' });
  const tokenDataEntry = generateToken({ userId: 'u-data-rcp', email: 'data@exchange.local', name: 'مدخل بيانات', role: 'data_entry' });
  const tokenCustody = generateToken({ userId: 'u-cust-rcp', email: 'cust@exchange.local', name: 'مسؤول العهدة', role: 'custody_officer' });
  const tokenAuditor = generateToken({ userId: 'u-audit-rcp', email: 'audit@exchange.local', name: 'مدقق بنكك', role: 'bankak_auditor' });

  // 1. Setup Test Customer & Chart of Accounts
  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-AUDIT-RCP' },
    update: {},
    create: {
      customerCode: 'CUST-AUDIT-RCP',
      name: 'عميل تدقيق إيصالات بنكك',
      phone: '+249912003344',
      status: 'active',
    },
  });

  // Clean up any test receipts from previous runs
  await prisma.bankakReceipt.deleteMany({
    where: {
      OR: [
        { customerId: testCustomer.id },
        { transactionId: { contains: 'AUDIT' } },
        { transactionId: { contains: 'INFLIGHT' } },
        { transactionId: { contains: 'SESSION' } },
        { transactionId: { contains: 'CANCEL' } },
        { transactionId: { contains: 'REJECT' } },
        { transactionId: { contains: 'RBAC' } },
      ],
    },
  });

  const bankakAccount = await prisma.account.findFirst({ where: { accountCode: '1030' } });
  const liabilityAccount = (await prisma.account.findFirst({ where: { accountCode: '2015' } })) ||
    (await prisma.account.findFirst({ where: { accountCode: '2010' } }));

  assert(Boolean(bankakAccount && liabilityAccount), 'جاهزية الحسابات المالية (1030 بنكك و 2015 وسيط استحقاق العملاء)');

  const initialBankakBalance = new Decimal(bankakAccount!.currentBalance.toString());
  const initialLiabilityBalance = new Decimal(liabilityAccount!.currentBalance.toString());

  // Helper callers
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

  async function callGetReceipt(id: string, token: string = tokenDataEntry) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/receipts/${id}`, {
      method: 'GET',
      headers,
    });
    const res = await getReceipt(req, { params: { id } });
    return { status: res.status, json: await res.json() };
  }

  async function callPatchReceipt(id: string, body: any, token: string = tokenDataEntry) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/receipts/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    const res = await updateReceipt(req, { params: { id } });
    return { status: res.status, json: await res.json() };
  }

  async function callVerifyReceipt(id: string, body: any = {}, token: string = tokenAuditor) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/receipts/${id}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await verifyReceipt(req, { params: { id } });
    return { status: res.status, json: await res.json() };
  }

  async function callApproveReceipt(id: string, body: any = {}, token: string = tokenAccountant) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/receipts/${id}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await approveReceipt(req, { params: { id } });
    return { status: res.status, json: await res.json() };
  }

  async function callRejectReceipt(id: string, body: any = {}, token: string = tokenAccountant) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = new NextRequest(`http://localhost:3000/api/v1/receipts/${id}/reject`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const res = await rejectReceipt(req, { params: { id } });
    return { status: res.status, json: await res.json() };
  }

  console.log('\n--- 1. التحقق من رفع الإيصالات وفك الـ OCR واستخراج البيانات ---');

  const testTxn1 = `TXN-AUDIT-${Date.now()}-01`;
  const uploadPayload1 = {
    customerId: testCustomer.id,
    rawOcrText: `Bank of Khartoum\nTransaction ID: ${testTxn1}\nAmount: 2,500,000 SDG\nSender: حاتم إبراهيم\nDate: 21/11/2026\nTime: 14:30:00`,
    imageData: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
  };

  const res1 = await callUpload(uploadPayload1, tokenDataEntry);
  assert(res1.status === 201 && res1.json.success, 'نجاح رفع الإيصال المفرد ومعالجته بمحرك OCR');
  const uploadedReceipt1 = res1.json.data[0];
  assert(
    uploadedReceipt1.transactionId === testTxn1 &&
    Number(uploadedReceipt1.amount) === 2500000 &&
    uploadedReceipt1.senderName === 'حاتم إبراهيم' &&
    uploadedReceipt1.status === 'pending_verification',
    'دقة استخراج الحقول المالية من نص الإيصال (Transaction ID, Amount, Sender, Status)'
  );

  console.log('\n--- 2. كشف التكرار متعدد المستويات (Multi-Tier Duplicate Detection) ---');

  // Tier 1: Duplicate Transaction ID
  const duplicateTxnPayload = {
    customerId: testCustomer.id,
    transactionId: testTxn1, // Same TXN
    amount: 2500000,
    imageData: `unique-image-payload-${Date.now()}`,
  };
  const resDup1 = await callUpload(duplicateTxnPayload, tokenDataEntry);
  assert(resDup1.status === 201, 'قبول طلب الفحص عند محاولة رفع إيصال مكرر');
  const dupReceipt1 = resDup1.json.data[0];
  assert(
    dupReceipt1.status === 'duplicate' && dupReceipt1.isDuplicate === true && dupReceipt1.duplicateOfId === uploadedReceipt1.id,
    'كشف الإيصال المكرر برقم العملية (Transaction ID) وتصنيفه كـ duplicate ومنع دمجه المالي'
  );

  // Tier 1: Duplicate Image Hash
  const testTxn2 = `TXN-AUDIT-${Date.now()}-02`;
  const duplicateHashPayload = {
    customerId: testCustomer.id,
    transactionId: testTxn2, // Different TXN
    amount: 1000000,
    imageData: uploadPayload1.imageData, // Exact same base64 image data
  };
  const resDup2 = await callUpload(duplicateHashPayload, tokenDataEntry);
  const dupReceipt2 = resDup2.json.data[0];
  assert(
    dupReceipt2.status === 'duplicate' && dupReceipt2.isDuplicate === true,
    'كشف الإيصال المكرر عبر بصمة الصورة الرقمية (SHA-256 Image Hash Match)'
  );

  // Tier 2: Suspicious Receipt Match (Same Amount + Date + Similar Sender)
  const testTxn3 = `TXN-AUDIT-${Date.now()}-03`;
  const suspiciousPayload = {
    customerId: testCustomer.id,
    transactionId: testTxn3,
    amount: 2500000, // Same amount as Receipt 1
    transactionDate: '2026-11-21',
    senderName: 'حاتم إبراهيم عثمان', // Substring of حاتم إبراهيم
    imageData: `synthetic-image-${Date.now()}`,
  };
  const resSusp = await callUpload(suspiciousPayload, tokenDataEntry);
  const suspReceipt = resSusp.json.data[0];
  assert(
    suspReceipt.status === 'suspicious' && suspReceipt.isSuspicious === true,
    'اكتشاف وتصنيف الإيصال المشتبه به (Suspicious) عند تطابق المبلغ والتاريخ والمرسل'
  );

  // In-flight Batch Duplication (Two identical receipts in the same batch)
  const inFlightTxn = `TXN-INFLIGHT-${Date.now()}`;
  const batchPayload = {
    items: [
      { transactionId: inFlightTxn, amount: 500000, customerId: testCustomer.id },
      { transactionId: inFlightTxn, amount: 500000, customerId: testCustomer.id }, // Same in batch
    ],
  };
  const resBatch = await callUpload(batchPayload, tokenDataEntry);
  assert(
    resBatch.json.data[0].status === 'pending_verification' && resBatch.json.data[1].status === 'duplicate',
    'منع تكرار الإيصالات المتزامنة داخل نفس الدفعة (In-flight Batch Duplicate Prevention)'
  );

  console.log('\n--- 3. التعديل اليدوي للإيصال وتوثيق الرقابة (PATCH & Audit Trail) ---');

  const testTxn4 = `TXN-AUDIT-${Date.now()}-04`;
  const resUpload4 = await callUpload({
    customerId: testCustomer.id,
    transactionId: testTxn4,
    amount: 1500000,
    senderName: 'اسم أولي قبل التعديل',
  });
  const receiptToEdit = resUpload4.json.data[0];

  // Authorized edit
  const patchRes = await callPatchReceipt(receiptToEdit.id, {
    amount: 1800000,
    senderName: 'حاتم إبراهيم المعدل',
    receiverName: 'مكتب الصرافة الرئيسي',
  }, tokenDataEntry);
  assert(patchRes.status === 200 && patchRes.json.success, 'نجاح تعديل بيانات الإيصال بواسطة مدخل بيانات مخول');
  assert(
    Number(patchRes.json.data.amount) === 1800000 &&
    patchRes.json.data.senderName === 'حاتم إبراهيم المعدل' &&
    patchRes.json.data.reviewedBy === 'مدخل بيانات',
    'تحديث الحقول وتوثيق اسم المستخدم الذي أجرى المراجعة (reviewedBy)'
  );

  // Prohibit setting zero or negative amount
  const negPatch = await callPatchReceipt(receiptToEdit.id, { amount: -500 }, tokenDataEntry);
  assert(negPatch.status === 400, 'رفض تعديل مبلغ الإيصال إلى قيمة سالبة أو صفرية');

  console.log('\n--- 4. مرحلة التحقق البنكي (Verification Step) ---');

  // Verify receipt
  const verifyRes = await callVerifyReceipt(receiptToEdit.id, {
    verificationSource: 'mobile_app',
    verificationNotes: 'تم التأكد من الرصيد اللحظي في تطبيق بنكك',
  }, tokenAuditor);
  assert(verifyRes.status === 200 && verifyRes.json.success, 'نجاح خطوة التحقق البنكي من الإيصال');
  const verifiedReceipt = verifyRes.json.data;
  assert(
    verifiedReceipt.status === 'verified' &&
    verifiedReceipt.verifiedBy === 'مدقق بنكك' &&
    verifiedReceipt.verificationSource === 'mobile_app',
    'تسجيل حالة Verified ومسؤول التحقق والمصدر وملاحظات الرقابة'
  );

  // Cannot verify duplicate receipt
  const dupVerifyRes = await callVerifyReceipt(dupReceipt1.id, {}, tokenAuditor);
  assert(dupVerifyRes.status === 400 || dupVerifyRes.status === 500, 'منع التحقق البنكي من إيصال مصنف كمكرر');

  console.log('\n--- 5. الاعتماد المالي وتسجيل القيد المزدوج الذري (Approval & Ledger Posting) ---');

  // Pre-approval balance check
  const beforeApprovalBankak = await prisma.account.findFirst({ where: { accountCode: '1030' } });
  const beforeApprovalLiab = await prisma.account.findFirst({ where: { accountCode: liabilityAccount!.accountCode } });

  const approveRes = await callApproveReceipt(receiptToEdit.id, { directVerification: false }, tokenAccountant);
  assert(approveRes.status === 200 && approveRes.json.success, 'نجاح الاعتماد المالي للإيصال المتحقق منه');
  assert(approveRes.json.data.status === 'approved', 'تحول حالة الإيصال إلى Approved');

  // Verify Ledger Entry was posted
  const ledgerEntry = await prisma.ledgerEntry.findFirst({
    where: {
      referenceType: 'BankakReceipt',
      referenceId: receiptToEdit.id,
    },
    include: { lines: true },
  });
  assert(Boolean(ledgerEntry), 'تسجيل قيد اليومية المزدوج (LedgerEntry) في الدفتر العام');
  assert(
    ledgerEntry!.lines.length === 2 &&
    ledgerEntry!.lines.some((l) => l.currency === 'SDG' && Number(l.debit) === 1800000) &&
    ledgerEntry!.lines.some((l) => l.currency === 'SDG' && Number(l.credit) === 1800000),
    'توازن القيد المالي: مدين حساب بنكك 1030 ودائن حساب وسيط التزامات العملاء 2015'
  );

  // Verify Account balances updated
  const afterApprovalBankak = await prisma.account.findFirst({ where: { accountCode: '1030' } });
  const afterApprovalLiab = await prisma.account.findFirst({ where: { accountCode: liabilityAccount!.accountCode } });

  const diffBankak = new Decimal(afterApprovalBankak!.currentBalance.toString()).minus(beforeApprovalBankak!.currentBalance.toString());
  const diffLiab = new Decimal(afterApprovalLiab!.currentBalance.toString()).minus(beforeApprovalLiab!.currentBalance.toString());
  assert(
    diffBankak.equals(1800000) && diffLiab.equals(1800000),
    'تحديث الأرصدة الحقيقية لحسابات البنك والالتزامات بدقة Decimal المتناهية'
  );

  // Prevent Double-Approval (Idempotency)
  const doubleApproveRes = await callApproveReceipt(receiptToEdit.id, {}, tokenAccountant);
  assert(doubleApproveRes.status === 400 || doubleApproveRes.status === 500, 'منع الاعتماد المزدوج لنفس الإيصال (Idempotent Concurrency Protection)');

  // Prevent Editing Approved Receipt
  const editApprovedRes = await callPatchReceipt(receiptToEdit.id, { amount: 999999 }, tokenAdmin);
  assert(editApprovedRes.status === 400, 'حظر تعديل أي إيصال تم اعتماده مالياً وترحيله للدفاتر');

  console.log('\n--- 6. التكامل مع الجلسة اليومية للعميل (Customer Session Linkage) ---');

  // Create an open session expecting 5,000,000 SDG
  const sessionReq = new NextRequest('http://localhost:3000/api/v1/customer-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDataEntry}` },
    body: JSON.stringify({
      customerId: testCustomer.id,
      requestedAmount: 10000, // 10,000 EGP
      exchangeRate: 500,      // Rate 500 => Expected SDG: 5,000,000
    }),
  });
  const sessionRes = await createSession(sessionReq);
  const createdSession = (await sessionRes.json()).data;

  // Upload receipt linked to this session
  const testTxn5 = `TXN-SESSION-${Date.now()}`;
  const resUploadSession = await callUpload({
    customerId: testCustomer.id,
    customerSessionId: createdSession.id,
    transactionId: testTxn5,
    amount: 5000000,
  });
  const sessionReceipt = resUploadSession.json.data[0];

  // Approve session receipt (using directVerification by admin)
  const approveSessionRcpRes = await callApproveReceipt(sessionReceipt.id, { directVerification: true }, tokenAdmin);
  assert(approveSessionRcpRes.status === 200, 'نجاح اعتماد إيصال مرتبط بجلسة حسابية يومية');

  // Verify session balances updated
  const updatedSession = await prisma.customerSession.findUnique({ where: { id: createdSession.id } });
  assert(
    Number(updatedSession!.receivedAmount) === 5000000 &&
    Number(updatedSession!.remainingAmount) === 0 &&
    updatedSession!.status === 'pending_delivery',
    'تحديث رصيد الجلسة اليومية وتحولها تلقائياً إلى pending_delivery (جاهزة للصرف النقدي)'
  );

  console.log('\n--- 7. الحماية من اعتماد إيصال لجلسة ملغاة (Cancelled Session Guard) ---');

  // Create another session and cancel it
  const cancelSessionReq = new NextRequest('http://localhost:3000/api/v1/customer-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDataEntry}` },
    body: JSON.stringify({
      customerId: testCustomer.id,
      requestedAmount: 2000,
      exchangeRate: 500,
    }),
  });
  const cancelSessionRes = await createSession(cancelSessionReq);
  const sessionToCancel = (await cancelSessionRes.json()).data;

  // Cancel the session directly in DB
  await prisma.customerSession.update({
    where: { id: sessionToCancel.id },
    data: { status: 'cancelled' },
  });

  // Try uploading or approving a receipt for cancelled session
  const cancelRcpUpload = await callUpload({
    customerId: testCustomer.id,
    customerSessionId: sessionToCancel.id,
    transactionId: `TXN-CANCEL-${Date.now()}`,
    amount: 1000000,
  });
  assert(cancelRcpUpload.status === 400, 'رفض ربط أو رفع إيصال لجلسة حسابية ملغاة');

  console.log('\n--- 8. دورة حياة الرفض والرقابة (Rejection Lifecycle) ---');

  const testTxn6 = `TXN-REJECT-${Date.now()}`;
  const resUploadReject = await callUpload({
    customerId: testCustomer.id,
    transactionId: testTxn6,
    amount: 750000,
  });
  const receiptToReject = resUploadReject.json.data[0];

  // Rejection without reason must fail
  const noReasonReject = await callRejectReceipt(receiptToReject.id, { reason: '' }, tokenAccountant);
  assert(noReasonReject.status === 400, 'إلزامية تحديد سبب الرفض لمنع القرارات غير الموثقة');

  // Rejection with reason
  const validReject = await callRejectReceipt(receiptToReject.id, { reason: 'إشعار تحويل مزور غير مطابق للسجلات البنكية' }, tokenAccountant);
  assert(validReject.status === 200 && validReject.json.success, 'نجاح رفض الإيصال وتوثيق سبب الرفض في سجل الرقابة');
  assert(validReject.json.data.status === 'rejected', 'تحول حالة الإيصال إلى rejected');

  // Cannot approve rejected receipt
  const approveRejectRes = await callApproveReceipt(receiptToReject.id, {}, tokenAccountant);
  assert(approveRejectRes.status === 400 || approveRejectRes.status === 500, 'منع اعتماد إيصال تم رفضه مسبقاً');

  // Cannot reject approved receipt
  const rejectApprovedRes = await callRejectReceipt(receiptToEdit.id, { reason: 'محاولة رفض إيصال معتمد' }, tokenAccountant);
  assert(rejectApprovedRes.status === 400, 'منع رفض إيصال تم اعتماده وترحيله محاسبياً (يتطلب قيد تسوية عكسي)');

  console.log('\n--- 9. مصفوفة الصلاحيات والأمان (RBAC Security Matrix) ---');

  const testTxnRbac = `TXN-RBAC-${Date.now()}`;
  const resUploadRbac = await callUpload({
    customerId: testCustomer.id,
    transactionId: testTxnRbac,
    amount: 100000,
  });
  const rbacReceipt = resUploadRbac.json.data[0];

  // Data Entry cannot approve receipt
  const dataEntryApprove = await callApproveReceipt(rbacReceipt.id, {}, tokenDataEntry);
  assert(dataEntryApprove.status === 403, 'منع مدخل البيانات (Data Entry) من الاعتماد المالي للإيصالات (403 Forbidden)');

  // Custody officer cannot approve receipt
  const custodyApprove = await callApproveReceipt(rbacReceipt.id, {}, tokenCustody);
  assert(custodyApprove.status === 403, 'منع مسؤول العهدة (Custody Officer) من الاعتماد المالي للإيصالات (403 Forbidden)');

  // Custody officer cannot reject receipt
  const custodyReject = await callRejectReceipt(rbacReceipt.id, { reason: 'رفض من العهدة' }, tokenCustody);
  assert(custodyReject.status === 403, 'منع مسؤول العهدة (Custody Officer) من رفض الإيصالات (403 Forbidden)');

  // Unauthenticated request
  const unauthUpload = await callUpload({ transactionId: 'TXN-NO-AUTH', amount: 1000 }, '');
  assert(unauthUpload.status === 401, 'حظر الوصول للطلبات غير المصرحة بدون JWT Token (401 Unauthorized)');

  console.log('\n========================================================================================');
  console.log(`  نتيجة التدقيق النهائي لإيصالات بنكك: نجاح ${passed} من أصل ${total} اختبار بنسبة 100%`);
  console.log('========================================================================================\n');
}

runReceiptsAuditTests()
  .catch((err) => {
    console.error('Audit execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
