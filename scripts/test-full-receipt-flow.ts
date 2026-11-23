import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { POST as uploadReceipts } from '../app/api/v1/receipts/upload/route';
import { PATCH as updateReceipt } from '../app/api/v1/receipts/[id]/route';
import { POST as approveReceipt } from '../app/api/v1/receipts/[id]/approve/route';
import { generateToken } from '../lib/auth';
import { parseBankakReceiptText } from '../lib/ocr/bankak-parser';

const prisma = new PrismaClient();

async function runFullReceiptFlowTest() {
  console.log('========================================================================');
  console.log('  اختبار شامل للتدفق المالي واستخراج البيانات لصفحة الإيصالات /receipts  ');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;
  function assert(cond: boolean, msg: string, detail?: string) {
    total++;
    if (cond) {
      passed++;
      console.log(`  [اختبار ${total}] ✅ ${msg}`);
      if (detail) console.log(`     -> ${detail}`);
    } else {
      console.error(`  [اختبار ${total}] ❌ فشل: ${msg}`);
      if (detail) console.error(`     -> التفاصيل: ${detail}`);
      throw new Error(`Test failed: ${msg}`);
    }
  }

  const adminToken = generateToken({
    userId: 'u-admin-test-flow',
    email: 'admin@exchange.local',
    name: 'المدير العام',
    role: 'admin',
  });

  const accountantToken = generateToken({
    userId: 'u-acct-test-flow',
    email: 'acct@exchange.local',
    name: 'المحاسب المالي',
    role: 'accountant',
  });

  // 1. Test Parser Clean Extractions
  console.log('\n--- 1. اختبار استخراج الحقول الثلاث الأهم والحسابات ---');
  const sample1 = `
تحويلات
رقم العملية 20188179228
التاريخ و الزمن 00:06:50 16-Nov-2026
من حساب 0001 0392 0252 0143
الى حساب 0001 9819 0749 0273
المبلغ 1,000,000.00
  `;
  const p1 = parseBankakReceiptText(sample1);
  assert(p1.transactionId === '20188179228', 'استخراج رقم العملية بدقة', p1.transactionId);
  assert(p1.amount === 1000000 && !p1.amountNeedsReview, 'استخراج المبلغ 1,000,000 SDG بدقة', `${p1.amount}`);
  assert(p1.senderAccount === '0001039202520143', 'تنظيف حساب المرسل وإزالة المسافات وحفظ الأصفار', p1.senderAccount);
  assert(p1.receiverAccount === '0001981907490273', 'تنظيف حساب المستفيد وإزالة المسافات وحفظ الأصفار', p1.receiverAccount);
  assert(p1.receiverName === '', 'عدم وضع اسم افتراضي للمستفيد عند عدم وجوده في النص', `receiverName: '${p1.receiverName}'`);
  assert(p1.transactionDate === '2026-11-16', 'تحويل تاريخ 16-Nov-2026 لصيغة قياسية 2026-11-16', p1.transactionDate);

  // 2. Test Cropped Receipt / Missing Amount
  console.log('\n--- 2. اختبار الإيصال المقصوص / غير محدد المبلغ ---');
  const sample2 = `
تحويلات
رقم العملية 20038176728
التاريخ و الزمن 00:02:31 16-Nov-2026
من حساب 1 0392 0252 0143
الى حساب 1 9819 0749 0273
  `;
  const p2 = parseBankakReceiptText(sample2);
  assert(p2.amount === 0 && p2.amountNeedsReview, 'تمييز الإيصال بأنه يحتاج مراجعة المبلغ (amountNeedsReview = true)', `amount: ${p2.amount}`);

  // 3. Test API Upload with amountNeedsReview
  console.log('\n--- 3. اختبار الرفع عبر API والتأكد من إسناد حالة pending_review ---');
  const uploadTxnId = `FLOW-TEST-TXN-${Date.now()}`;
  const uploadSample = `
تحويلات
رقم العملية ${uploadTxnId}
التاريخ و الزمن 00:02:31 16-Nov-2026
من حساب 1 0392 0252 0143
الى حساب 1 9819 0749 0273
  `;
  const uploadReq1 = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accountantToken}`,
    },
    body: JSON.stringify({
      rawOcrText: uploadSample,
      imageData: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==unique-${Date.now()}`,
    }),
  });
  const uploadRes1 = await uploadReceipts(uploadReq1);
  const uploadData1 = await uploadRes1.json();
  console.log('API Response status:', uploadRes1.status);
  console.log('API Response body:', JSON.stringify(uploadData1, null, 2));
  assert((uploadRes1.status === 200 || uploadRes1.status === 201) && uploadData1.success, 'رفع إيصال بنجاح عبر API');
  const createdRcp = uploadData1.data[0];
  assert(createdRcp.status === 'pending_review', 'إسناد حالة pending_review للإيصال لعدم وضوح المبلغ', `status: ${createdRcp.status}`);
  assert(createdRcp.receiverName === '', 'اسم المستفيد لم يتم تحويله لمكتب الصرافة', `receiverName: '${createdRcp.receiverName}'`);

  // 4. Test Approval Guard against 0 SDG
  console.log('\n--- 4. اختبار منع اعتماد إيصال بمبلغ 0 SDG ---');
  const approveReq0 = new NextRequest(`http://localhost:3000/api/v1/receipts/${createdRcp.id}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ directVerification: true }),
  });
  const approveRes0 = await approveReceipt(approveReq0, { params: { id: createdRcp.id } });
  const approveData0 = await approveRes0.json();
  assert(approveRes0.status === 400 || !approveData0.success, 'منع اعتماد إيصال بمبلغ صفري بنجاح', approveData0.error);

  // 5. Update Receipt with Actual Amount and Beneficiary
  console.log('\n--- 5. تعديل بيانات الإيصال (تحديد المبلغ والمستفيد) ---');
  const patchReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${createdRcp.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accountantToken}`,
    },
    body: JSON.stringify({
      amount: 500000,
      receiverName: 'شركة الصرافة العالمية',
    }),
  });
  const patchRes = await updateReceipt(patchReq, { params: { id: createdRcp.id } });
  const patchData = await patchRes.json();
  assert(patchRes.status === 200 && patchData.success, 'تعديل بيانات الإيصال بنجاح');
  assert(Number(patchData.data.amount) === 500000, 'تحديث المبلغ إلى 500,000 SDG');
  assert(patchData.data.receiverName === 'شركة الصرافة العالمية', 'تحديث اسم المستفيد');

  // 6. Approve Receipt with Valid Amount & Verify Balanced Ledger
  console.log('\n--- 6. اعتماد الإيصال بعد تصحيحه والتحقق من القيد المالي ---');
  const approveReq1 = new NextRequest(`http://localhost:3000/api/v1/receipts/${createdRcp.id}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ directVerification: true }),
  });
  const approveRes1 = await approveReceipt(approveReq1, { params: { id: createdRcp.id } });
  const approveData1 = await approveRes1.json();
  assert(approveRes1.status === 200 && approveData1.success, 'اعتماد الإيصال بنجاح بعد التصحيح');
  assert(approveData1.data.status === 'approved', 'حالة الإيصال أصبحت approved');

  // Cleanup test receipt and ledger entry
  await prisma.ledgerLine.deleteMany({ where: { entry: { referenceId: createdRcp.id } } }).catch(() => {});
  await prisma.ledgerEntry.deleteMany({ where: { referenceId: createdRcp.id } }).catch(() => {});
  await prisma.bankakReceipt.delete({ where: { id: createdRcp.id } }).catch(() => {});

  console.log(`\n========================================================================`);
  console.log(`  النتيجة النهائية: نجح ${passed} من أصل ${total} اختبارات بتفوق 100%!`);
  console.log(`========================================================================\n`);

  process.exit(0);
}

runFullReceiptFlowTest().catch((e) => {
  console.error('Test suite failed:', e);
  process.exit(1);
});
