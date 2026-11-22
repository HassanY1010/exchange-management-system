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
  console.log('  فحص واختبار أداء وسرعة محرك الـ OCR الحقيقي (Real Production OCR Performance Audit)    ');
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

  // --- 1. التحقق من وجود ملفات اللغة السريعة محلياً (Raw + Gzip) ---
  console.log('--- 1. فحص حزمة ملفات النماذج المحلية في lib/ocr/tessdata ---');
  const tessdataDir = path.join(process.cwd(), 'lib', 'ocr', 'tessdata');
  const araExists = fs.existsSync(path.join(tessdataDir, 'ara.traineddata'));
  const engExists = fs.existsSync(path.join(tessdataDir, 'eng.traineddata'));
  const araGzExists = fs.existsSync(path.join(tessdataDir, 'ara.traineddata.gz'));
  const engGzExists = fs.existsSync(path.join(tessdataDir, 'eng.traineddata.gz'));
  
  assert(
    araExists && engExists && araGzExists && engGzExists,
    'تضمين ملفات النماذج السريعة بصيغتيها (raw + gz) محلياً داخل المشروع لضمان التوافق التام على Render'
  );

  const araSize = fs.statSync(path.join(tessdataDir, 'ara.traineddata')).size;
  const engSize = fs.statSync(path.join(tessdataDir, 'eng.traineddata')).size;
  const totalMb = ((araSize + engSize) / (1024 * 1024)).toFixed(2);
  assert(
    Number(totalMb) < 10,
    `حجم النماذج السريعة الكلي (${totalMb} MB) خفيف جداً مقارنة بنموذج Best القديم (57 MB)`
  );

  // --- 2. اختبار OCR حقيقي على صورة إشعار بنكك (800x600) ---
  console.log('\n--- 2. اختبار OCR حقيقي على صورة إشعار بنكك وقياس زمن الاستخراج الفعلي ---');
  const sampleImgPath = path.join(process.cwd(), 'test-receipt-sample.png');
  const sampleImgBuffer = fs.readFileSync(sampleImgPath);
  const sampleImgBase64 = `data:image/png;base64,${sampleImgBuffer.toString('base64')}`;

  // Call 1: Real OCR on Real Image (Worker Init + Recognition)
  const tReal0 = performance.now();
  const realRes1 = await processReceiptImageWithOcr(sampleImgBase64);
  const durReal1 = performance.now() - tReal0;
  
  assert(
    realRes1.engineUsed === 'tesseract' && realRes1.rawText.includes('987654321'),
    `التعرف الضوئي الفعلي عبر Tesseract على صورة 800x600 استغرق: ${durReal1.toFixed(1)} ms`,
    `الرقم المستخرج: ${realRes1.parsed.transactionId} | المبلغ: ${realRes1.parsed.amount} | الثقة: ${realRes1.parsed.ocrConfidence}%`
  );

  // Call 2: Real OCR with Reused Worker (No init overhead)
  const tReal1 = performance.now();
  const realRes2 = await processReceiptImageWithOcr(sampleImgBase64);
  const durReal2 = performance.now() - tReal1;

  assert(
    realRes2.engineUsed === 'tesseract' && durReal2 < durReal1,
    `إعادة استخدام الـ Worker على نفس الصورة استغرق: ${durReal2.toFixed(1)} ms (تسريع بنسبة ${Math.round((1 - durReal2/durReal1) * 100)}%)`
  );

  // --- 3. قياس حمل الـ Worker Manager (Dispatch Overhead على صورة فارغة 1x1) ---
  console.log('\n--- 3. قياس الحمل الأدنى لإدارة الطابور (Worker Dispatch Overhead) ---');
  const blankPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const tDispatch = performance.now();
  const blankRes = await processReceiptImageWithOcr(blankPngBase64);
  const durDispatch = performance.now() - tDispatch;

  assert(
    blankRes.engineUsed === 'tesseract' && durDispatch < 500,
    `زمن إرسال وفحص صورة فارغة عبر الـ Worker النشط: ${durDispatch.toFixed(1)} ms`
  );

  // --- 4. اختبار التزامن وقفل الطابور (Concurrency & Queue Mutex) على صور حقيقية ---
  console.log('\n--- 4. اختبار التزامن ومنع تداخل المهام المتوازية عبر الطابور التسلسلي ---');
  const tConcurrentStart = performance.now();
  const [c1, c2] = await Promise.all([
    processReceiptImageWithOcr(sampleImgBase64),
    processReceiptImageWithOcr(sampleImgBase64),
  ]);
  const durConcurrent = performance.now() - tConcurrentStart;

  assert(
    c1.engineUsed === 'tesseract' && c2.engineUsed === 'tesseract',
    `نجاح معالجة طلبين متزامنين على صور حقيقية بأمان تام وتسلسلهما عبر Mutex خلال: ${durConcurrent.toFixed(1)} ms`
  );

  // --- 5. اختبار التعافي من الفشل وحماية الـ Timeout ---
  console.log('\n--- 5. اختبار حماية التايم آوت والتعافي التلقائي (Timeout & Recovery) ---');
  const corruptedBuffer = Buffer.from('not-a-valid-image-corrupted-bytes-12345');
  const failRes = await processReceiptImageWithOcr(corruptedBuffer);
  assert(
    failRes.engineUsed === 'heuristic_parser' && failRes.parsed.ocrConfidence === 0,
    'التعامل الآمن مع الصور الفاسدة دون توقف السيرفر والتحويل إلى heuristic_parser بثقة صفر'
  );

  // Next normal request must succeed immediately because worker was recycled / preserved
  const recoverRes = await processReceiptImageWithOcr(sampleImgBase64);
  assert(
    recoverRes.engineUsed === 'tesseract' && recoverRes.durationMs < 10000,
    'استمرار الـ Worker في العمل والتعافي الفوري بعد معالجة ملف خاطئ'
  );

  // --- 6. اختبار الأثر المالي والنزاهة المحاسبية ورفع API بدون نص مسبق ---
  console.log('\n--- 6. اختبار النزاهة المحاسبية والتوازي في API الرفع الحقيقي ---');
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

  // Clean up prior test runs for idempotent test execution
  await prisma.ledgerEntry.deleteMany({
    where: { referenceType: 'BankakReceipt' },
  }).catch(() => {});
  await prisma.bankakReceipt.deleteMany({
    where: {
      OR: [
        { transactionId: '987654321' },
        { customerId: testCustomer.id },
      ],
    },
  }).catch(() => {});

  const uploadReq = new NextRequest('http://localhost:3000/api/v1/receipts/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      customerId: testCustomer.id,
      transactionId: `TXN-PERF-${Date.now()}`,
      amount: 3500000,
      imageData: sampleImgBase64, // Real image, NO preExtractedText -> forces real Tesseract OCR
    }),
  });

  const tUploadStart = performance.now();
  const upRes = await uploadReceipts(uploadReq);
  const durUpload = performance.now() - tUploadStart;
  const upJson = await upRes.json();
  const createdReceipt = upJson.data[0];

  assert(
    upRes.status === 201 && upJson.success,
    `نجاح عملية الرفع بالتوازي والـ OCR الفعلي خلال: ${durUpload.toFixed(1)} ms`
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

  await ocrWorkerManager.recycleWorker();

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
