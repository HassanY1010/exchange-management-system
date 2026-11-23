import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';

async function runBenchmark() {
  console.log('===========================================================');
  console.log('  فحص الأداء على الصور الأربع الحقيقية للمستخدم           ');
  console.log('===========================================================');

  const files = ['receipt1.jpg', 'receipt2.jpg', 'receipt3.jpg', 'receipt4.jpg'];

  console.log('\n--- 1. تشغيل متسلسل (Sequential) كما هو في الـ API الحالي ---');
  const tTotalStart = performance.now();

  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(process.cwd(), 'scripts', 'fixtures', files[i]);
    const buffer = fs.readFileSync(filePath);
    const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;

    const tItemStart = performance.now();
    const result = await processReceiptImageWithOcr(base64);
    const itemDur = performance.now() - tItemStart;

    console.log(`[الصورة ${i + 1}/${files.length}]: ${files[i]}`);
    console.log(`   - الوقت الفعلي: ${itemDur.toFixed(0)} ms (${(itemDur / 1000).toFixed(2)}s)`);
    console.log(`   - المحرك: ${result.engineUsed} | الدقة: ${result.parsed.ocrConfidence}%`);
    console.log(`   - رقم العملية: ${result.parsed.transactionId || 'لم يستخرج'}`);
    console.log(`   - المبلغ: ${result.parsed.amount} ${result.parsed.currency}`);
    console.log(`   - الحسابات: من [${result.parsed.senderAccount}] إلى [${result.parsed.receiverAccount}]`);
  }

  const totalDur = performance.now() - tTotalStart;
  console.log('\n-----------------------------------------------------------');
  console.log(`إجمالي الوقت المستغرق لمعالجة 4 صور بالتسلسل: ${totalDur.toFixed(0)} ms (${(totalDur / 1000).toFixed(2)} ثانية)`);
  console.log('-----------------------------------------------------------\n');

  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
