import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';
import { uploadReceiptImage } from '../lib/storage/supabase-storage';
import { prisma } from '../lib/db';

async function diagnose() {
  console.log('=== STARTING DIAGNOSTIC TRACE ===');

  // 1. Check Sample Image
  const samplePath = path.join(process.cwd(), 'test-receipt-sample.png');
  const buffer = fs.readFileSync(samplePath);
  const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
  console.log(`[Diagnostic] Sample image size: ${(buffer.length / 1024).toFixed(1)} KB`);

  // 2. Measure OCR
  console.log('[Diagnostic] 1. Testing processReceiptImageWithOcr...');
  const t0 = performance.now();
  const ocrRes = await processReceiptImageWithOcr(base64);
  const durOcr = performance.now() - t0;
  console.log(`[Diagnostic] OCR completed in ${durOcr.toFixed(1)}ms. Engine: ${ocrRes.engineUsed}, Conf: ${ocrRes.parsed.ocrConfidence}%, Txn: ${ocrRes.parsed.transactionId}`);

  // 3. Measure Storage Upload
  console.log('[Diagnostic] 2. Testing uploadReceiptImage...');
  const t1 = performance.now();
  const storageRes = await uploadReceiptImage(base64, `diag-${Date.now()}.png`);
  const durStorage = performance.now() - t1;
  console.log(`[Diagnostic] Storage completed in ${durStorage.toFixed(1)}ms. Source: ${storageRes.source}, Key: ${storageRes.storageKey}`);

  // 4. Measure Database Query
  console.log('[Diagnostic] 3. Testing DB findMany existing receipts...');
  const t2 = performance.now();
  const existing = await prisma.bankakReceipt.findMany({
    where: { status: { not: 'rejected' } },
    take: 50,
    select: { id: true, transactionId: true, imageHash: true },
  });
  const durDb = performance.now() - t2;
  console.log(`[Diagnostic] DB query completed in ${durDb.toFixed(1)}ms. Found: ${existing.length} receipts`);

  // 5. Test 4 Images Sequentially vs in Upload Endpoint
  console.log('[Diagnostic] 4. Simulating 4 images sequential loop (as in current upload endpoint)...');
  const tSeq = performance.now();
  for (let i = 0; i < 4; i++) {
    const tItem = performance.now();
    const [ocr, st] = await Promise.all([
      processReceiptImageWithOcr(base64),
      uploadReceiptImage(base64, `diag-loop-${Date.now()}-${i}.png`),
    ]);
    console.log(`   -> Item ${i + 1}/4 took ${(performance.now() - tItem).toFixed(1)}ms (OCR=${ocr.durationMs}ms, Storage=${st.source})`);
  }
  const durTotalSeq = performance.now() - tSeq;
  console.log(`[Diagnostic] Total time for 4 items: ${durTotalSeq.toFixed(1)}ms (${(durTotalSeq / 1000).toFixed(2)} seconds)`);

  console.log('=== DIAGNOSTIC TRACE COMPLETE ===');
}

diagnose()
  .catch((e) => console.error('Diagnostic error:', e))
  .finally(() => prisma.$disconnect());
