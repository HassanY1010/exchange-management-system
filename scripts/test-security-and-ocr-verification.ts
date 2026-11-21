import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { generateToken } from '../lib/auth';
import { supabase, getReceiptSignedUrl, uploadReceiptImage } from '../lib/storage/supabase-storage';
import { parseBankakReceiptText, normalizeDigits } from '../lib/ocr/bankak-parser';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';
import { GET as getReceiptImage } from '../app/api/v1/receipts/[id]/image/route';
import { POST as uploadReceipts } from '../app/api/v1/receipts/upload/route';

const prisma = new PrismaClient();

async function runSecurityAndOcrVerification() {
  console.log('========================================================================================');
  console.log('  التحقق الأمني النهائي ودقة محرك الـ OCR لإيصالات بنكك (Security & OCR Final Audit)    ');
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

  // --- 1. فحص أمان التخزين السحابي Supabase Storage ---
  console.log('--- 1. فحص أمان تخزين صور الإيصالات (Supabase Storage Security) ---');

  if (supabase) {
    const { data: buckets } = await supabase.storage.listBuckets();
    const receiptsBucket = buckets?.find((b) => b.name === 'receipts' || b.id === 'receipts');

    assert(
      Boolean(receiptsBucket && receiptsBucket.public === false),
      'حاوية التخزين (receipts bucket) خاصة تماماً (public: false) ومحمية ضد الوصول العام'
    );

    // Test uploading an image to private bucket
    const testFilename = `sec-audit-${Date.now()}.png`;
    const uploadRes = await uploadReceiptImage(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      testFilename
    );

    assert(
      Boolean(uploadRes.signedUrl && uploadRes.signedUrl.includes('token=')),
      'توليد روابط موقعة مشفرة (Cryptographic Signed URLs) مع رمز Token بدلاً من الروابط العامة'
    );

    // Test public URL fails
    const { data: pubData } = supabase.storage.from('receipts').getPublicUrl(uploadRes.storageKey);
    const pubFetch = await fetch(pubData.publicUrl);
    assert(
      pubFetch.status !== 200,
      'فشل الوصول العام غير المصرح للرابط المجرد على الحاوية الخاصة (Status: ' + pubFetch.status + ')'
    );

    // Test signed URL succeeds
    const signedFetch = await fetch(uploadRes.signedUrl!);
    assert(
      signedFetch.status === 200,
      'نجاح فتح الصورة بالرابط الموقع والمشفر بـ Token صالح'
    );
  } else {
    console.log('  ⚠️ Supabase client غير مفعل محلياً');
  }

  // --- 2. فحص أمان مسار الصور والـ RBAC على نقطة /api/v1/receipts/[id]/image ---
  console.log('\n--- 2. فحص حماية الصلاحيات (RBAC) على استعراض صور الإيصالات ---');

  const tokenAdmin = generateToken({ userId: 'u-sec-admin', email: 'admin@exchange.local', name: 'المدير العام', role: 'admin' });
  const tokenAccountant = generateToken({ userId: 'u-sec-acct', email: 'acct@exchange.local', name: 'المحاسب المالي', role: 'accountant' });
  const tokenCustody = generateToken({ userId: 'u-sec-cust', email: 'cust@exchange.local', name: 'مسؤول العهدة', role: 'custody_officer' });

  // Create a test receipt in DB
  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-SEC-TEST' },
    update: {},
    create: {
      customerCode: 'CUST-SEC-TEST',
      name: 'عميل الفحص الأمني',
      phone: '+249911998877',
      status: 'active',
    },
  });

  const uploadReq = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      customerId: testCustomer.id,
      transactionId: `TXN-SEC-${Date.now()}`,
      amount: 1500000,
      imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    }),
  });
  const upRes = await uploadReceipts(uploadReq);
  const testReceipt = (await upRes.json()).data[0];

  // Request 1: Unauthenticated request (No token)
  const unauthReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${testReceipt.id}/image`, {
    method: 'GET',
  });
  const unauthRes = await getReceiptImage(unauthReq, { params: { id: testReceipt.id } });
  assert(
    unauthRes.status === 401,
    'حظر الوصول غير المصرح تماماً بدون تسجيل دخول (401 Unauthorized)'
  );

  // Request 2: Unauthorized role (Custody Officer)
  const custodyReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${testReceipt.id}/image`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenCustody}` },
  });
  const custodyRes = await getReceiptImage(custodyReq, { params: { id: testReceipt.id } });
  assert(
    custodyRes.status === 403,
    'تطبيق مبدأ أقل الصلاحيات: حظر مسؤول العهدة من الاطلاع على صور إيصالات بنكك (403 Forbidden)'
  );

  // Request 3: Authorized role (Accountant)
  const acctReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${testReceipt.id}/image`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenAccountant}` },
  });
  const acctRes = await getReceiptImage(acctReq, { params: { id: testReceipt.id } });
  assert(
    acctRes.status === 302 || acctRes.status === 200,
    'تمكين المحاسب المالي المخول من الوصول لصورة الإيصال (Status: ' + acctRes.status + ')'
  );

  // --- 3. التحقق من دقة محرك الـ OCR وقواعد تحليل بنكك ---
  console.log('\n--- 3. التحقق من دقة قواعد تحليل إشعار بنكك (Bankak Parser Accuracy) ---');

  // Test 1: Full Bankak Notification with Arabic & Latin text
  const fullBankakText = `
    بنك الخرطوم
    Bank of Khartoum
    إشعار تحويل بنكك
    رقم العملية: FT260908871234
    المبلغ: 12,450,000.00 SDG
    اسم المرسل: الفاتح عز الدين أحمد
    من الحساب: 1982341
    المستفيد: شركة الصرافة الحديثة
    إلى حساب: 2049981
    التاريخ: 2026-11-21
    الوقت: 15:42:10
    تمت العملية بنجاح
  `;
  const parsedFull = parseBankakReceiptText(fullBankakText);
  assert(
    parsedFull.transactionId === 'FT260908871234' &&
    parsedFull.amount === 12450000 &&
    parsedFull.currency === 'SDG' &&
    parsedFull.senderName === 'الفاتح عز الدين أحمد' &&
    parsedFull.senderAccount === '1982341' &&
    parsedFull.receiverName === 'شركة الصرافة الحديثة' &&
    parsedFull.receiverAccount === '2049981' &&
    parsedFull.transactionDate === '2026-11-21' &&
    parsedFull.transactionTime === '15:42:10',
    'استخراج كامل حقول إشعار بنكك بدقة متناهية (رقم العملية، المبلغ، العملة، المرسل، المستفيد، الحسابات، التاريخ، الوقت)'
  );

  // Test 2: Eastern Arabic Numerals (٠١٢٣٤٥٦٧٨٩)
  const easternDigitsText = `
    إشعار بنكك
    رقم المرجع: ٩٨١٢٣٤٥٦٧
    المبلغ: ٧,٨٥٠,٠٠٠ ج.س
    المرسل: عمر المختار
    التاريخ: ٢٠٢٦/١١/٢١
  `;
  const parsedEastern = parseBankakReceiptText(easternDigitsText);
  assert(
    parsedEastern.transactionId === '981234567' &&
    parsedEastern.amount === 7850000 &&
    parsedEastern.senderName === 'عمر المختار' &&
    parsedEastern.transactionDate === '2026-11-21',
    'التحويل الدقيق للأرقام المشرقية إلى أرقام مالية قياسية دولية'
  );

  // Test 3: Failure handling & Zero Hallucination
  const emptyText = '';
  const parsedEmpty = parseBankakReceiptText(emptyText);
  assert(
    parsedEmpty.transactionId === '' &&
    parsedEmpty.amount === 0 &&
    parsedEmpty.senderName === '' &&
    parsedEmpty.ocrConfidence === 0 &&
    parsedEmpty.extractedFieldsCount === 0,
    'حماية عدم اختراع أي بيانات مالية عند تعذر أو فشل الـ OCR (Zero Hallucination)'
  );

  // Test 4: Low confidence image routes to pending_review
  const lowConfRes = await uploadReceipts(
    new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
      body: JSON.stringify({
        customerId: testCustomer.id,
        rawOcrText: 'نص غير مفهوم ومجهول الهوية ????',
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' + Buffer.from('low-conf-' + Date.now()).toString('base64'),
      }),
    })
  );
  const lowConfReceipt = (await lowConfRes.json()).data[0];
  assert(
    lowConfReceipt.status === 'pending_review' &&
    lowConfReceipt.ocrConfidence < 70,
    'عدم اعتماد البيانات منخفضة الثقة وحجز الإيصال في حالة pending_review للمراجعة البشرية'
  );

  console.log('\n========================================================================================');
  console.log(`  🏆 نجح التدقيق الأمني وفحص دقة الـ OCR بالكامل: ${passed} من أصل ${total} بنسبة 100%!`);
  console.log('========================================================================================\n');
}

runSecurityAndOcrVerification()
  .catch((err) => {
    console.error('Audit failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
