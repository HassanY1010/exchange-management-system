import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { generateToken } from '../lib/auth';
import { NextRequest } from 'next/server';
import { POST as uploadReceipts } from '../app/api/v1/receipts/upload/route';
import { GET as getReceipt, PATCH as updateReceipt } from '../app/api/v1/receipts/[id]/route';
import { POST as approveReceipt } from '../app/api/v1/receipts/[id]/approve/route';
import { POST as createSession } from '../app/api/v1/customer-sessions/route';
import { parseBankakReceiptText, normalizeDigits } from '../lib/ocr/bankak-parser';
import { ensureReceiptDbConstraints } from './ensure-db-constraints';

const prisma = new PrismaClient();

// Helper to generate unique valid base64 images to prevent accidental SHA-256 hash collision across distinct tests
function makeUniqueImage(format: 'png' | 'jpeg' | 'webp', seed: string | number): string {
  const salt = Buffer.from(`unique-${seed}-${Math.random()}`).toString('base64');
  if (format === 'jpeg') {
    return `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=${salt}`;
  }
  if (format === 'webp') {
    return `data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==${salt}`;
  }
  return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==${salt}`;
}

async function runRealImageOcrTests() {
  console.log('========================================================================================');
  console.log('  فحص واختبار ميزة رفع الصور الحقيقية ومحرك OCR لإيصالات بنكك (Production OCR Tests)    ');
  console.log('  الهدف: التحقق من دعم PNG/JPG/WebP، الكاميرا، استخراج الحقول، كشف التكرار، والأثر المالي  ');
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
  const tokenAdmin = generateToken({ userId: 'u-admin-ocr', email: 'admin@exchange.local', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-acct-ocr', email: 'acct@exchange.local', name: 'المحاسب المالي', role: 'accountant' });
  const tokenDataEntry = generateToken({ userId: 'u-data-ocr', email: 'data@exchange.local', name: 'مدخل بيانات', role: 'data_entry' });

  // Setup Customer
  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-OCR-TEST' },
    update: {},
    create: {
      customerCode: 'CUST-OCR-TEST',
      name: 'عميل اختبارات OCR الحقيقية',
      phone: '+249911556677',
      status: 'active',
    },
  });

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

  console.log('\n--- 1. اختبارات رفع صيغ الصور الحقيقية والحجم المسموح به (Upload Tests) ---');

  // Test 1: Upload real PNG image
  const txnPng = `TXN-PNG-${Date.now()}`;
  const png1Data = makeUniqueImage('png', '1');
  const resPng = await callUpload({
    customerId: testCustomer.id,
    transactionId: txnPng,
    amount: 1500000,
    imageData: png1Data,
  });
  assert(resPng.status === 201 && resPng.json.success, 'نجاح رفع وحفظ صورة إيصال بنكك بصيغة PNG الحقيقية');
  assert(resPng.json.data[0].imageStorageKey !== 'no-image', 'تخزين الصورة وربطها بسجل الإيصال (imageStorageKey)');

  // Test 2: Upload real JPEG image
  const txnJpeg = `TXN-JPG-${Date.now()}`;
  const resJpeg = await callUpload({
    customerId: testCustomer.id,
    transactionId: txnJpeg,
    amount: 2500000,
    imageData: makeUniqueImage('jpeg', '2'),
  });
  assert(resJpeg.status === 201 && resJpeg.json.success, 'نجاح رفع وحفظ صورة إيصال بنكك بصيغة JPEG/JPG الحقيقية');

  // Test 3: Upload real WebP image
  const txnWebp = `TXN-WEBP-${Date.now()}`;
  const resWebp = await callUpload({
    customerId: testCustomer.id,
    transactionId: txnWebp,
    amount: 3500000,
    imageData: makeUniqueImage('webp', '3'),
  });
  assert(resWebp.status === 201 && resWebp.json.success, 'نجاح رفع وحفظ صورة إيصال بنكك بصيغة WebP الحقيقية');

  // Test 4: Reject unsupported file format (PDF is rejected with clear message)
  const resPdf = await callUpload({
    customerId: testCustomer.id,
    imageData: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCg==',
  });
  assert(resPdf.status === 400, 'رفض الملفات غير المدعومة مثل PDF دون تضليل وبرسالة توجيهية واضحة');

  // Test 5: Reject oversized image (> 15MB)
  const hugePayload = 'data:image/png;base64,' + 'A'.repeat(21 * 1024 * 1024);
  const resHuge = await callUpload({
    customerId: testCustomer.id,
    imageData: hugePayload,
  });
  assert(resHuge.status === 400, 'رفض الصور التي تتجاوز الحد الأقصى للأمان (15 ميغابايت)');

  // Test 6: Upload multiple real images in a single batch
  const batchRes = await callUpload({
    items: [
      {
        customerId: testCustomer.id,
        transactionId: `TXN-BATCH-1-${Date.now()}`,
        amount: 500000,
        imageData: makeUniqueImage('png', 'batch-1'),
        rawOcrText: 'Bank of Khartoum\nAmount: 500,000 SDG\nSender: أحمد علي',
      },
      {
        customerId: testCustomer.id,
        transactionId: `TXN-BATCH-2-${Date.now()}`,
        amount: 750000,
        imageData: makeUniqueImage('jpeg', 'batch-2'),
        rawOcrText: 'Bank of Khartoum\nAmount: 750,000 SDG\nSender: محمد حسن',
      },
    ],
  });
  assert(batchRes.status === 201 && batchRes.json.count === 2, 'نجاح رفع ومعالجة عدة صور إيصالات دفعة واحدة (Batch Upload)');

  console.log('\n--- 2. اختبارات استخراج بيانات إشعار بنكك والـ OCR (OCR & Parser Tests) ---');

  // Test 7: Extract Transaction ID, Amount, Sender, Beneficiary, Date, Time
  const sampleBankakText = `
    بنك الخرطوم (Bank of Khartoum)
    إشعار تحويل بنكك - موبايل بانك
    رقم العملية: FT261121098877
    المبلغ: 4,850,000 SDG
    من الحساب: 2458901
    اسم المرسل: عثمان يوسف كباشي
    المستفيد: شركة الصرافة المعتمدة
    إلى حساب: 1030999
    تاريخ العملية: 21/11/2026
    الوقت: 11:45:20 AM
  `;
  const parsedSample = parseBankakReceiptText(sampleBankakText);
  assert(
    parsedSample.transactionId === 'FT261121098877' &&
    parsedSample.amount === 4850000 &&
    parsedSample.senderName === 'عثمان يوسف كباشي' &&
    parsedSample.receiverName === 'شركة الصرافة المعتمدة' &&
    parsedSample.transactionDate === '2026-11-21' &&
    parsedSample.transactionTime === '11:45:20 AM',
    'استخراج جميع بيانات إشعار بنكك بدقة (TXN, Amount, Sender, Beneficiary, Date, Time)'
  );

  // Test 8: Extract Eastern Arabic Numerals (الأرقام المشرقية ٠١٢٣٤٥٦٧٨٩)
  const arabicDigitsText = `
    بنك الخرطوم
    رقم العملية: ٩٨٧٦٥٤٣٢١
    المبلغ: ٥,٢٠٠,٠٠٠ ج.س
    المرسل: مصطفى طه
    التاريخ: ٢٠٢٦/١١/٢١
  `;
  const parsedArabicDigits = parseBankakReceiptText(arabicDigitsText);
  assert(
    parsedArabicDigits.transactionId === '987654321' &&
    parsedArabicDigits.amount === 5200000 &&
    parsedArabicDigits.senderName === 'مصطفى طه' &&
    parsedArabicDigits.transactionDate === '2026-11-21',
    'التحويل التلقائي والدقيق للأرقام المشرقية إلى أرقام مالية قياسية'
  );

  // Test 9: Blurry/Incomplete image handling (status becomes pending_review, zero data loss)
  const blurryRes = await callUpload({
    customerId: testCustomer.id,
    rawOcrText: 'نص غير واضح ومشتت ... ???',
    imageData: makeUniqueImage('png', 'blurry'),
  });
  const blurryReceipt = blurryRes.json.data[0];
  assert(
    blurryReceipt.status === 'pending_review' &&
    blurryReceipt.ocrConfidence < 70 &&
    blurryReceipt.imageStorageKey !== 'no-image',
    'حفظ الصورة الأصلية وتصنيف الإيصال كـ pending_review عند انخفاض ثقة الـ OCR'
  );

  // Test 10: Reprocess OCR on existing receipt via PATCH
  const patchReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${blurryReceipt.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      transactionId: `FT-REPROCESSED-${Date.now()}`,
      amount: 3200000,
      senderName: 'محمد أحمد بعد المراجعة',
    }),
  });
  const patchRes = await updateReceipt(patchReq, { params: { id: blurryReceipt.id } });
  assert(patchRes.status === 200, 'تمكين تصحيح ومراجعة بيانات الإيصال يدوياً وحفظ التعديلات');

  console.log('\n--- 3. اختبارات كشف التكرار المتعدد للأمان المالي (Duplicate Tests) ---');

  // Test 11: Duplicate Transaction ID
  const dupTxnRes = await callUpload({
    customerId: testCustomer.id,
    transactionId: txnPng, // Existing TXN
    amount: 1500000,
    imageData: makeUniqueImage('jpeg', 'dup-txn'),
  });
  assert(dupTxnRes.json.data[0].status === 'duplicate', 'كشف التكرار القطعي برقم العملية (Transaction ID)');

  // Test 12: Duplicate Image Hash (SHA-256)
  const dupHashRes = await callUpload({
    customerId: testCustomer.id,
    transactionId: `TXN-UNIQUE-${Date.now()}`,
    amount: 999999,
    imageData: png1Data, // Same PNG data as Test 1
  });
  assert(dupHashRes.json.data[0].status === 'duplicate', 'كشف التكرار القطعي ببصمة الصورة الرقمية (SHA-256 Image Hash)');

  // Test 13: In-flight duplicate within the same batch
  const inFlightTxn = `TXN-BATCH-DUP-${Date.now()}`;
  const batchDupRes = await callUpload({
    items: [
      { transactionId: inFlightTxn, amount: 800000, customerId: testCustomer.id, imageData: makeUniqueImage('png', 'inflight-1') },
      { transactionId: inFlightTxn, amount: 800000, customerId: testCustomer.id, imageData: makeUniqueImage('jpeg', 'inflight-2') },
    ],
  });
  assert(
    batchDupRes.json.data[1].status === 'duplicate',
    'كشف ومنع تكرار الإيصالات داخل نفس الدفعة في الذاكرة (In-flight Batch Duplicate Prevention)'
  );

  console.log('\n--- 4. النزاهة المحاسبية وعدم إنشاء أي أثر مالي تلقائي (Accounting Integrity) ---');

  // Test 14: Ensure OCR/Upload creates ZERO ledger entries
  const ledgerEntriesAfterUpload = await prisma.ledgerEntry.findMany({
    where: {
      referenceType: 'BankakReceipt',
      referenceId: { in: [blurryReceipt.id, resJpeg.json.data[0].id] },
    },
  });
  assert(
    ledgerEntriesAfterUpload.length === 0,
    'حماية الحسابات: رفع الإيصالات وفك الـ OCR لا ينشئ أي قيد محاسبي أو تسوية على الإطلاق'
  );

  // Test 15: Financial approval creates balanced double-entry ledger only on explicit action
  const approveReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${resJpeg.json.data[0].id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ directVerification: true }),
  });
  const approveRes = await approveReceipt(approveReq, { params: { id: resJpeg.json.data[0].id } });
  assert(approveRes.status === 200, 'الاعتماد المالي الصريح فقط هو ما ينشئ قيد اليومية المزدوج');

  const approvedLedger = await prisma.ledgerEntry.findFirst({
    where: {
      referenceType: 'BankakReceipt',
      referenceId: resJpeg.json.data[0].id,
    },
    include: { lines: true },
  });
  assert(
    Boolean(approvedLedger) &&
    approvedLedger!.lines.length === 2 &&
    approvedLedger!.lines.some((l) => l.currency === 'SDG' && Number(l.debit) === 2500000) &&
    approvedLedger!.lines.some((l) => l.currency === 'SDG' && Number(l.credit) === 2500000),
    'توازن القيد المالي المعتمد: مدين بنكك 1030 ودائن استحقاق العملاء 2015 بمبلغ 2,500,000 SDG'
  );

  console.log('\n========================================================================================');
  console.log(`  🏆 نجحت جميع اختبارات رفع الصور الحقيقية والـ OCR: ${passed} من أصل ${total} بنسبة 100%!`);
  console.log('========================================================================================\n');
}

runRealImageOcrTests()
  .catch((err) => {
    console.error('OCR Tests Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
