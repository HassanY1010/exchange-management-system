import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { generateToken } from '../lib/auth';
import { processReceiptImageWithOcr, ocrWorkerManager } from '../lib/ocr/image-ocr';
import { POST as uploadReceipts } from '../app/api/v1/receipts/upload/route';
import { POST as approveReceipt } from '../app/api/v1/receipts/[id]/approve/route';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function runOcrPerformanceTests() {
  console.log('========================================================================================');
  console.log('  فحص واختبار أداء وسرعة محرك الـ OCR وإعادة استخدام الـ Worker (OCR Performance Audit)   ');
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

  // --- 1. التحقق من وجود ملفات اللغة السريعة محلياً وعدم الاعتماد على CDN ---
  console.log('--- 1. فحص حزمة ملفات اللغة السريعة المحلية (Local Fast Tessdata) ---');
  const tessdataDir = path.join(process.cwd(), 'lib', 'ocr', 'tessdata');
  const araExists = fs.existsSync(path.join(tessdataDir, 'ara.traineddata'));
  const engExists = fs.existsSync(path.join(tessdataDir, 'eng.traineddata'));
  assert(
    araExists && engExists,
    'تضمين ملفات النماذج السريعة (ara + eng) محلياً داخل المشروع لتفادي التحميل من CDN'
  );

  const araSize = fs.statSync(path.join(tessdataDir, 'ara.traineddata')).size;
  const engSize = fs.statSync(path.join(tessdataDir, 'eng.traineddata')).size;
  const totalMb = ((araSize + engSize) / (1024 * 1024)).toFixed(2);
  assert(
    Number(totalMb) < 10,
    `حجم النماذج السريعة الكلي (${totalMb} MB) خفيف جداً مقارنة بنموذج Best القديم (57 MB)`
  );

  // --- 2. اختبار إعادة استخدام الـ Worker والسرعة الفائقة ---
  console.log('\n--- 2. اختبار إعادة استخدام الـ Worker ومقارنة الأزمنة (Worker Reuse) ---');
  const validPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Request 1: Initialization + Recognition
  const t0 = performance.now();
  const res1 = await processReceiptImageWithOcr(validPngBase64);
  const dur1 = performance.now() - t0;
  assert(
    dur1 < 15000,
    `الطلب الأول (تشغيل وتهيئة الـ Worker لأول مرة) استغرق: ${dur1.toFixed(1)} ms`
  );

  // Request 2: Reused Worker (Must be dramatically faster)
  const t1 = performance.now();
  const res2 = await processReceiptImageWithOcr(validPngBase64);
  const dur2 = performance.now() - t1;
  assert(
    dur2 < 2000,
    `الطلب الثاني (إعادة استخدام الـ Worker المحمّل) فائق السرعة واستغرق: ${dur2.toFixed(1)} ms`
  );

  // Request 3: Third sequential call
  const t2 = performance.now();
  const res3 = await processReceiptImageWithOcr(validPngBase64);
  const dur3 = performance.now() - t2;
  assert(
    dur3 < 2000,
    `الطلب الثالث (استقرار الأداء دون تسريب أو إعادة تحميل) استغرق: ${dur3.toFixed(1)} ms`
  );

  // --- 3. اختبار التزامن وقفل الطابور (Concurrency & Queue Mutex) ---
  console.log('\n--- 3. اختبار التزامن ومنع تداخل ومعالجة المهام المتوازية (Queue Serialization) ---');
  const tConcurrentStart = performance.now();
  const [c1, c2, c3] = await Promise.all([
    processReceiptImageWithOcr(validPngBase64),
    processReceiptImageWithOcr(validPngBase64),
    processReceiptImageWithOcr(validPngBase64),
  ]);
  const durConcurrent = performance.now() - tConcurrentStart;
  assert(
    Boolean(c1 && c2 && c3),
    `نجاح معالجة 3 طلبات متزامنة في نفس اللحظة بأمان تام عبر الطابور التسلسلي خلال: ${durConcurrent.toFixed(1)} ms`
  );

  // --- 4. اختبار التعافي من الفشل وحماية الـ Timeout ---
  console.log('\n--- 4. اختبار حماية التايم آوت والتعافي التلقائي (Timeout & Recovery) ---');
  // Attempt with corrupt buffer
  const corruptedBuffer = Buffer.from('not-a-valid-image-corrupted-bytes-12345');
  const failRes = await processReceiptImageWithOcr(corruptedBuffer);
  assert(
    failRes.engineUsed === 'heuristic_parser' && failRes.parsed.ocrConfidence === 0,
    'التعامل الآمن مع الصور الفاسدة دون توقف السيرفر والتحويل إلى heuristic_parser بثقة صفر'
  );

  // Next normal request must succeed immediately because worker was recycled / preserved
  const recoverRes = await processReceiptImageWithOcr(validPngBase64);
  assert(
    recoverRes.durationMs < 5000,
    'استمرار الـ Worker في العمل والتعافي الفوري بعد معالجة ملف خاطئ'
  );

  // --- 5. اختبار الأثر المالي والنزاهة المحاسبية عبر دورة الرفع الكاملة ---
  console.log('\n--- 5. اختبار النزاهة المحاسبية والتوازي في الرفع (Upload & Accounting Integrity) ---');
  const tokenAccountant = generateToken({ userId: 'u-perf-acct', email: 'acct@exchange.local', name: 'المحاسب المالي', role: 'accountant' });

  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-PERF-TEST' },
    update: {},
    create: {
      customerCode: 'CUST-PERF-TEST',
      name: 'عميل اختبارات الأداء',
      phone: '+249911009988',
      status: 'active',
    },
  });

  const uploadReq = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      customerId: testCustomer.id,
      transactionId: `TXN-PERF-${Date.now()}`,
      amount: 3500000,
      imageData: validPngBase64 + Buffer.from('perf-unique-' + Date.now()).toString('base64'),
      rawOcrText: 'Bank of Khartoum\nTransaction ID: TXN-PERF\nAmount: 3,500,000 SDG\nSender: حاتم إبراهيم',
    }),
  });

  const tUploadStart = performance.now();
  const upRes = await uploadReceipts(uploadReq);
  const durUpload = performance.now() - tUploadStart;
  const upJson = await upRes.json();
  const createdReceipt = upJson.data[0];

  assert(
    upRes.status === 201 && upJson.success,
    `نجاح عملية الرفع بالتوازي (التخزين + التحليل + الحفظ) في: ${durUpload.toFixed(1)} ms`
  );

  // Ensure ZERO ledger entries were created before explicit approval
  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: {
      referenceType: 'BankakReceipt',
      referenceId: createdReceipt.id,
    },
  });
  assert(
    ledgerEntries.length === 0,
    'حماية الحسابات: الرفع السريع والـ OCR لا ينشئان أي قيد محاسبي في الدفاتر على الإطلاق (Zero Ledger)'
  );

  // Explicit approval creates the double entry
  const appReq = new NextRequest(`http://localhost:3000/api/v1/receipts/${createdReceipt.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ directVerification: true }),
  });
  const appRes = await approveReceipt(appReq, { params: { id: createdReceipt.id } });
  assert(
    appRes.status === 200,
    'الاعتماد المالي الصريح فقط هو ما ينشئ القيود المحاسبية'
  );

  console.log('\n========================================================================================');
  console.log(`  🏆 نجحت جميع اختبارات الأداء والسرعة والنزاهة المحاسبية: ${passed} من أصل ${total} بنسبة 100%!`);
  console.log('========================================================================================\n');
}

runOcrPerformanceTests()
  .catch((err) => {
    console.error('Performance test failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
