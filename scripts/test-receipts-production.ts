import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { parseBankakReceiptText } from '../lib/ocr/bankak-parser';
import { POST as uploadReceipts } from '../app/api/v1/receipts/upload/route';
import { PATCH as updateReceipt } from '../app/api/v1/receipts/[id]/route';
import { POST as verifyReceipt } from '../app/api/v1/receipts/[id]/verify/route';
import { POST as approveReceipt } from '../app/api/v1/receipts/[id]/approve/route';
import { POST as rejectReceipt } from '../app/api/v1/receipts/[id]/reject/route';
import { GET as getReceiptImage } from '../app/api/v1/receipts/[id]/image/route';
import { ensureReceiptDbConstraints } from './ensure-db-constraints';

const prisma = new PrismaClient();

async function runProductionReceiptsAudit() {
  console.log('========================================================================================');
  console.log('  التدقيق الشامل والنهائي لنظام إيصالات بنكك والـ OCR (Production Audit)               ');
  console.log('  التحقق: 1. دقة OCR والأرقام العربية | 2. منع الاحتيال والتكرار | 3. دورة الحياة والحالات');
  console.log('          4. التكامل المحاسبي والقيد المزدوج | 5. مزامنة الجلسات | 6. حماية RBAC الصارمة');
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

  // 0. Ensure DB Constraints
  await ensureReceiptDbConstraints();

  // Clean up any test records from prior runs
  const testPrefix = 'PROD-TEST-RCP-';
  await prisma.bankakReceipt.deleteMany({
    where: {
      transactionId: { startsWith: testPrefix },
    },
  });

  // Setup Test Customer
  const customer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-PROD-AUDIT' },
    update: {},
    create: {
      customerCode: 'CUST-PROD-AUDIT',
      name: 'عميل تدقيق إيصالات بنكك',
      phone: '+249999000111',
      status: 'active',
    },
  });

  // Setup Required Accounts (1030 for Bankak, 2015 for Customer Deposits)
  await prisma.account.upsert({
    where: { accountCode: '1030' },
    update: {},
    create: {
      accountCode: '1030',
      name: 'بنك الخرطوم (بنكك)',
      accountType: 'bankak',
      currency: 'SDG',
      currentBalance: 0,
      status: 'active',
    },
  });

  await prisma.account.upsert({
    where: { accountCode: '2015' },
    update: {},
    create: {
      accountCode: '2015',
      name: 'أمانات العملاء',
      accountType: 'customer_liability',
      currency: 'SDG',
      currentBalance: 0,
      status: 'active',
    },
  });

  // Tokens for RBAC testing
  const tokenAdmin = generateToken({ userId: 'u-admin-test', email: 'admin@prod.test', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-acct-test', email: 'acct@prod.test', name: 'المحاسب المالي', role: 'accountant' });
  const tokenDataEntry = generateToken({ userId: 'u-data-test', email: 'data@prod.test', name: 'مدخل بيانات', role: 'data_entry' });
  const tokenAuditor = generateToken({ userId: 'u-audit-test', email: 'audit@prod.test', name: 'مراجع بنكك', role: 'bankak_auditor' });
  const tokenCustody = generateToken({ userId: 'u-cust-test', email: 'cust@prod.test', name: 'مسؤول العهدة', role: 'custody_officer' });
  const tokenForbidden = generateToken({ userId: 'u-unknown-test', email: 'anon@prod.test', name: 'مستخدم مجهول', role: 'guest_user' });

  // =========================================================================
  // المجموعة 1: دقة محرك استخراج بيانات OCR وتطبيع الأرقام والفواصل العربية
  // =========================================================================
  console.log('\n--- المجموعة 1: دقة OCR ومعالجة الأرقام والرموز العربية ---');

  // Test 1.1: Eastern Arabic digits conversion
  const rawEastern = 'المبلغ: ١٥٠٠٠٠ جنيه رقم العملية: FT2411239999';
  const parsedEastern = parseBankakReceiptText(rawEastern);
  assert(parsedEastern.amount === 150000, 'استخراج المبلغ من أرقام هندية/مشرقية (١٥٠٠٠٠)', `المبلغ المستخرج: ${parsedEastern.amount}`);
  assert(parsedEastern.transactionId === 'FT2411239999', 'استخراج رقم العملية بنمط FT', `رقم العملية: ${parsedEastern.transactionId}`);

  // Test 1.2: Arabic comma & thousands separator (، and ٬)
  const rawWithArabicComma = 'مبلغ التحويل: ٢٥٠،٠٠٠.٥٠ SDG رقم المعاملة: 9988776655';
  const parsedWithArabicComma = parseBankakReceiptText(rawWithArabicComma);
  assert(parsedWithArabicComma.amount === 250000.5, 'معالجة فاصلة الآلاف العربية (٢٥٠،٠٠٠.٥٠)', `المبلغ المستخرج: ${parsedWithArabicComma.amount}`);
  assert(parsedWithArabicComma.transactionId === '9988776655', 'التعرف على نمط (رقم المعاملة)', `رقم المعاملة: ${parsedWithArabicComma.transactionId}`);

  // Test 1.3: Arabic decimal mark (٫ U+066B) and spaces
  const rawWithArabicDecimal = 'القيمة: ٥٠٬٠٠٠٫٧٥ ج.س معرف العملية: FT8899001122';
  const parsedWithArabicDecimal = parseBankakReceiptText(rawWithArabicDecimal);
  assert(parsedWithArabicDecimal.amount === 50000.75, 'معالجة فاصلة الكسر العشري العربية (٥٠٬٠٠٠٫٧٥)', `المبلغ المستخرج: ${parsedWithArabicDecimal.amount}`);
  assert(parsedWithArabicDecimal.transactionId === 'FT8899001122', 'التعرف على نمط (معرف العملية)', `المعرف: ${parsedWithArabicDecimal.transactionId}`);

  // Test 1.4: Accounts & Phone number markers in receipt
  const rawWithAccounts = `
    من حساب: 1234567
    اسم المرسل: أحمد محمد علي
    إلى حساب: 7654321
    اسم المستفيد: شركة الصرافة المعتمدة
    رقم العملية: FT1122334455
    المبلغ: 100,000 SDG
    التاريخ: 2026-11-23 10:30:00
  `;
  const parsedAccounts = parseBankakReceiptText(rawWithAccounts);
  assert(parsedAccounts.senderAccount === '1234567', 'استخراج حساب المرسل بنجاح', `حساب المرسل: ${parsedAccounts.senderAccount}`);
  assert(parsedAccounts.receiverAccount === '7654321', 'استخراج حساب المستفيد بنجاح', `حساب المستفيد: ${parsedAccounts.receiverAccount}`);
  assert(parsedAccounts.senderName.includes('أحمد'), 'استخراج اسم المرسل بدقة', `اسم المرسل: ${parsedAccounts.senderName}`);
  assert(parsedAccounts.receiverName.includes('الصرافة'), 'استخراج اسم المستفيد بدقة', `اسم المستفيد: ${parsedAccounts.receiverName}`);

  // Test 1.5: Phone number marker in sender/receiver
  const rawWithPhones = `
    رقم هاتف المرسل: 0912345678
    جوال المستفيد: 0123456789
    المبلغ: 75,000 ج.س
    رقم الإشعار: FT5566778899
  `;
  const parsedPhones = parseBankakReceiptText(rawWithPhones);
  assert(parsedPhones.senderAccount === '0912345678', 'استخراج رقم هاتف المرسل كمعرف حساب', `المستخرج: ${parsedPhones.senderAccount}`);
  assert(parsedPhones.receiverAccount === '0123456789', 'استخراج رقم جوال المستفيد كمعرف حساب', `المستخرج: ${parsedPhones.receiverAccount}`);

  // =========================================================================
  // المجموعة 2: كشف التكرار ومنع الاحتيال (Duplicate Detection & Anti-Fraud)
  // =========================================================================
  console.log('\n--- المجموعة 2: كشف التكرار ومنع الاحتيال ---');

  const txnId1 = `${testPrefix}TXN-001`;
  const syntheticImg1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Upload original receipt
  const uploadReq1 = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenDataEntry}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      transactionId: txnId1,
      amount: 150000,
      senderName: 'محمد أحمد التجاني',
      receiverName: 'شركة الصرافة',
      imageData: syntheticImg1,
    }),
  });
  const uploadRes1 = await uploadReceipts(uploadReq1);
  const uploadData1 = await uploadRes1.json();
  assert(uploadRes1.status === 201 && uploadData1.success, 'رفع إيصال جديد أولي بنجاح', `Receipt ID: ${uploadData1.data[0]?.id}`);
  const receipt1 = uploadData1.data[0];

  // Upload identical receipt (Same transactionId & same image data)
  const uploadReq2 = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenDataEntry}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      transactionId: txnId1,
      amount: 150000,
      senderName: 'محمد أحمد التجاني',
      imageData: syntheticImg1,
    }),
  });
  const uploadRes2 = await uploadReceipts(uploadReq2);
  const uploadData2 = await uploadRes2.json();
  const receipt2 = uploadData2.data[0];
  assert(receipt2.isDuplicate === true, 'كشف الإيصال المكرر بدقة (isDuplicate = true)', `الحالة: ${receipt2.status}`);
  assert(receipt2.status === 'duplicate', 'تعيين حالة الإيصال المكرر تلقائياً إلى duplicate');
  assert(receipt2.duplicateOfId === receipt1.id, 'ربط الإيصال المكرر بمعرف الإيصال الأصلي', `duplicateOfId: ${receipt2.duplicateOfId}`);

  // Ensure duplicate receipt CANNOT be verified or approved
  const verifyDupReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt2.id}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAccountant}` },
  });
  const verifyDupRes = await verifyReceipt(verifyDupReq, { params: { id: receipt2.id } });
  assert(verifyDupRes.status === 400, 'منع التحقق من الإيصال المصنف كمكرر (HTTP 400)');

  const approveDupReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt2.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAccountant}` },
  });
  const approveDupRes = await approveReceipt(approveDupReq, { params: { id: receipt2.id } });
  assert(approveDupRes.status === 400, 'منع اعتماد إيصال مكرر مالياً في القيود المحاسبية (HTTP 400)');

  // =========================================================================
  // المجموعة 3: دورة حياة الإيصال وقواعد التحولات والحماية من إعادة التنفيذ
  // =========================================================================
  console.log('\n--- المجموعة 3: دورة حياة الإيصال وحماية التحولات ---');

  // Verify Receipt 1
  const verifyReq1 = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAuditor}` },
  });
  const verifyRes1 = await verifyReceipt(verifyReq1, { params: { id: receipt1.id } });
  assert(verifyRes1.status === 200, 'التحقق من الإيصال الأصلي بواسطة مراجع بنكك', `الحالة الجديدة: verified`);

  // Idempotency: Re-verifying already verified receipt must be rejected
  const reVerifyReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAuditor}` },
  });
  const reVerifyRes = await verifyReceipt(reVerifyReq, { params: { id: receipt1.id } });
  assert(reVerifyRes.status === 400, 'منع إعادة التحقق من إيصال تم التحقق منه مسبقاً (Idempotency Protection)');

  // Create another receipt to test Reject lifecycle
  const txnIdToReject = `${testPrefix}TXN-REJ`;
  const uploadRejectReq = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenDataEntry}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      transactionId: txnIdToReject,
      amount: 40000,
      senderName: 'عميل مزور',
      imageData: syntheticImg1 + 'REJ',
    }),
  });
  const uploadRejectRes = await uploadReceipts(uploadRejectReq);
  const rejectTarget = (await uploadRejectRes.json()).data[0];

  // Reject the receipt
  const rejectReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${rejectTarget.id}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAccountant}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'إشعار غير مطابق لكشف الحساب البنكي' }),
  });
  const rejectRes = await rejectReceipt(rejectReq, { params: { id: rejectTarget.id } });
  assert(rejectRes.status === 200, 'رفض الإيصال المشبوه بنجاح مع تسجيل السبب');

  // Idempotency: Re-rejecting already rejected receipt must be prevented
  const reRejectReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${rejectTarget.id}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAccountant}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'محاولة رفض مكررة' }),
  });
  const reRejectRes = await rejectReceipt(reRejectReq, { params: { id: rejectTarget.id } });
  assert(reRejectRes.status === 400, 'منع إعادة رفض إيصال مرفوض مسبقاً (منع تكرار الإشعارات وسجلات التدقيق)');

  // Attempt to approve a rejected receipt must fail
  const approveRejReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${rejectTarget.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  const approveRejRes = await approveReceipt(approveRejReq, { params: { id: rejectTarget.id } });
  assert(approveRejRes.status === 400, 'منع اعتماد إيصال مرفوض مسبقاً في الدفاتر المالية');

  // Attempt to edit a rejected receipt via PATCH must fail
  const patchRejReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${rejectTarget.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 50000 }),
  });
  const patchRejRes = await updateReceipt(patchRejReq, { params: { id: rejectTarget.id } });
  assert(patchRejRes.status === 400, 'منع تعديل بيانات إيصال مرفوض مسبقاً');

  // Create zero-amount receipt and verify financial approval guards
  const txnZero = `${testPrefix}TXN-ZERO`;
  const uploadZeroReq = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenDataEntry}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      transactionId: txnZero,
      amount: 0,
      senderName: 'مبلغ صفري',
      imageData: syntheticImg1 + 'ZERO',
    }),
  });
  const uploadZeroRes = await uploadReceipts(uploadZeroReq);
  const zeroReceipt = (await uploadZeroRes.json()).data[0];

  const approveZeroReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${zeroReceipt.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  const approveZeroRes = await approveReceipt(approveZeroReq, { params: { id: zeroReceipt.id } });
  assert(approveZeroRes.status === 400, 'منع اعتماد إيصال بمبلغ صفري أو سالب (Financial Amount Guard)');

  // =========================================================================
  // المجموعة 4: التكامل المحاسبي الدقيق والقيد المزدوج والـ AuditLog
  // =========================================================================
  console.log('\n--- المجموعة 4: التكامل المحاسبي واعتماد القيد المزدوج ---');

  // Approve Receipt 1 (Amount = 150,000 SDG)
  const initialBal1030 = (await prisma.account.findUnique({ where: { accountCode: '1030' } }))?.currentBalance || new Decimal(0);
  const initialBal2015 = (await prisma.account.findUnique({ where: { accountCode: '2015' } }))?.currentBalance || new Decimal(0);

  const approveReq1 = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAccountant}` },
  });
  const approveRes1 = await approveReceipt(approveReq1, { params: { id: receipt1.id } });
  const approveData1 = await approveRes1.json();
  assert(approveRes1.status === 200 && approveData1.success, 'اعتماد الإيصال مالياً بنجاح وتوليد القيد المحاسبي', `Receipt No: ${approveData1.data?.receiptNumber}`);

  // Verify Ledger Entry
  const createdLedgerEntry = await prisma.ledgerEntry.findFirst({
    where: { referenceType: 'BankakReceipt', referenceId: receipt1.id },
    include: { lines: true },
  });
  assert(createdLedgerEntry !== null, 'التحقق من إنشاء القيد اليومي في دفتر الأستاذ (LedgerEntry)');
  assert(createdLedgerEntry?.lines.length === 2, 'التحقق من وجود طرفين للقيد المزدوج (مدين ودائن)');

  // Verify Double-Entry Balance
  const debitLine = createdLedgerEntry?.lines.find((l) => Number(l.debit) > 0);
  const creditLine = createdLedgerEntry?.lines.find((l) => Number(l.credit) > 0);

  assert(debitLine !== undefined, 'الطرف المدين موجود');
  assert(creditLine !== undefined, 'الطرف الدائن موجود');
  assert(Number(debitLine?.debit) === 150000, 'الطرف المدين 150,000 SDG (حساب بنكك 1030)');
  assert(Number(creditLine?.credit) === 150000, 'الطرف الدائن 150,000 SDG (حساب أمانات العملاء 2015)');
  assert(Number(debitLine?.debit) === Number(creditLine?.credit), 'توازن القيد المزدوج التام (إجمالي المدين = إجمالي الدائن)');

  // Verify Account Balances Updated Atomically
  const finalBal1030 = (await prisma.account.findUnique({ where: { accountCode: '1030' } }))?.currentBalance || new Decimal(0);
  const finalBal2015 = (await prisma.account.findUnique({ where: { accountCode: '2015' } }))?.currentBalance || new Decimal(0);
  assert(
    new Decimal(finalBal1030).minus(initialBal1030).toNumber() === 150000,
    'تحديث رصيد حساب بنكك 1030 بمقدار 150,000 SDG داخل نفس العملية'
  );
  assert(
    new Decimal(finalBal2015).minus(initialBal2015).toNumber() === 150000,
    'تحديث رصيد حساب أمانات العملاء 2015 بمقدار 150,000 SDG'
  );

  // Verify Audit Log was written
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      action: 'APPROVE_BANKAK_RECEIPT',
      entityId: receipt1.id,
    },
  });
  assert(auditLog !== null, 'تسجيل العملية في AuditLog بمعرف الكيان والمستخدم المسؤول', `AuditLog ID: ${auditLog?.id}`);

  // Re-approve protection
  const reApproveReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  const reApproveRes = await approveReceipt(reApproveReq, { params: { id: receipt1.id } });
  assert(reApproveRes.status === 400, 'منع إعادة اعتماد إيصال معتمد مسبقاً (منع تكرار القيود المحاسبية)');

  // Attempt to edit approved receipt via PATCH
  const patchApprovedReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 999999 }),
  });
  const patchApprovedRes = await updateReceipt(patchApprovedReq, { params: { id: receipt1.id } });
  assert(patchApprovedRes.status === 400, 'منع تعديل إيصال معتمد مالياً منعاً للتلاعب في الدفاتر');

  // =========================================================================
  // المجموعة 5: مزامنة رصيد جلسات العملاء (Session Balance Integration)
  // =========================================================================
  console.log('\n--- المجموعة 5: مزامنة رصيد جلسات العملاء عند الاعتماد ---');

  const testSession = await prisma.customerSession.create({
    data: {
      customerId: customer.id,
      sessionNumber: `SESS-${Date.now()}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status: 'open',
      exchangeRate: new Decimal(1),
      requestedAmount: new Decimal(80000),
      expectedAmount: new Decimal(80000),
      receivedAmount: new Decimal(0),
      deliveredAmount: new Decimal(0),
      remainingAmount: new Decimal(80000),
      createdBy: 'test-admin',
    },
  });

  const txnSess = `${testPrefix}TXN-SESS`;
  const uploadSessReq = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenDataEntry}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      customerSessionId: testSession.id,
      transactionId: txnSess,
      amount: 80000,
      senderName: 'مورد الجلسة',
      imageData: syntheticImg1 + 'SESS',
    }),
  });
  const uploadSessRes = await uploadReceipts(uploadSessReq);
  const sessReceipt = (await uploadSessRes.json()).data[0];

  // Verify receipt
  await verifyReceipt(
    new NextRequest(`http://localhost:3000/api/v1/receipts/${sessReceipt.id}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenAuditor}` },
    }),
    { params: { id: sessReceipt.id } }
  );

  // Approve receipt linked to session
  const approveSessReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${sessReceipt.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAccountant}` },
  });
  const approveSessRes = await approveReceipt(approveSessReq, { params: { id: sessReceipt.id } });
  assert(approveSessRes.status === 200, 'اعتماد الإيصال المرتبط بالجلسة بنجاح');

  const refreshedSession = await prisma.customerSession.findUnique({
    where: { id: testSession.id },
  });
  assert(
    Number(refreshedSession?.receivedAmount) === 80000,
    'تحديث رصيد الإيداع في الجلسة تلقائياً وبشكل ذري (receivedAmount = 80,000)',
    `المبلغ الحالي في الجلسة: ${refreshedSession?.receivedAmount}`
  );

  // =========================================================================
  // المجموعة 6: حماية RBAC الصارمة على كافة المسارات الحساسة
  // =========================================================================
  console.log('\n--- المجموعة 6: حماية الصلاحيات (RBAC Enforcement) ---');

  // 6.1: Image viewing RBAC
  const imgAuditorReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/image`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenAuditor}` },
  });
  const imgAuditorRes = await getReceiptImage(imgAuditorReq, { params: { id: receipt1.id } });
  assert(imgAuditorRes.status !== 403, 'السماح لمراجع بنكك (bankak_auditor) بعرض صور الإيصالات (غير محظور 403)', `Status: ${imgAuditorRes.status}`);

  const imgCustodyReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/image`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenCustody}` },
  });
  const imgCustodyRes = await getReceiptImage(imgCustodyReq, { params: { id: receipt1.id } });
  assert(imgCustodyRes.status !== 403, 'السماح لمسؤول العهدة (custody_officer) بعرض صور الإيصالات (غير محظور 403)', `Status: ${imgCustodyRes.status}`);

  const imgForbiddenReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/image`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenForbidden}` },
  });
  const imgForbiddenRes = await getReceiptImage(imgForbiddenReq, { params: { id: receipt1.id } });
  assert(imgForbiddenRes.status === 403, 'حظر المستخدمين غير المصرح لهم من عرض صور الإيصالات (HTTP 403 Forbidden)');

  // 6.2: Approval RBAC: data_entry is forbidden
  const approveDataEntryReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenDataEntry}` },
  });
  const approveDataEntryRes = await approveReceipt(approveDataEntryReq, { params: { id: receipt1.id } });
  assert(approveDataEntryRes.status === 403, 'منع مدخل البيانات (data_entry) من اعتماد الإيصالات مالياً (HTTP 403)');

  // 6.3: Reject RBAC: unauthorized role is forbidden
  const rejectForbiddenReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${receipt1.id}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenForbidden}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'محاولة رفض بدون صلاحية' }),
  });
  const rejectForbiddenRes = await rejectReceipt(rejectForbiddenReq, { params: { id: receipt1.id } });
  assert(rejectForbiddenRes.status === 403, 'منع المستخدمين غير المصرح لهم من رفض الإيصالات (HTTP 403 Forbidden)');

  console.log('\n========================================================================================');
  console.log(`  🎉 نتائج تدقيق إيصالات بنكك والـ OCR: تم بنجاح اجتياز ${passed} من أصل ${total} اختباراً بنسبة 100%!`);
  console.log('========================================================================================\n');
}

runProductionReceiptsAudit()
  .catch((e) => {
    console.error('Audit execution error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
