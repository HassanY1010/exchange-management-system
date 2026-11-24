import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { createWorker } from 'tesseract.js';
import { parseBankakReceiptText } from '../lib/ocr/bankak-parser';

async function benchmark() {
  const fixturesDir = path.join(process.cwd(), 'scripts', 'prod-fixtures');
  const files = [
    'prod_receipt_21255688390.png',
    'prod_receipt_20307388216.png',
    'prod_receipt_20375262495.png',
    'prod_receipt_20038176728.png',
  ];

  console.log('========================================================================');
  console.log('  OCR & Processing Performance Benchmark (Real Production Images)');
  console.log('========================================================================\n');

  // 1. Worker Initialization timing
  const initStart = performance.now();
  const localWorkerScript = path.join(
    process.cwd(),
    'node_modules',
    'tesseract.js',
    'src',
    'worker-script',
    'node',
    'index.js'
  );
  const localTessdata = path.join(process.cwd(), 'lib', 'ocr', 'tessdata');

  const worker = await createWorker(['ara', 'eng'], 1, {
    langPath: localTessdata,
    cachePath: path.join(process.cwd(), '.tesseract_cache'),
    gzip: false,
    workerPath: localWorkerScript,
  });
  await worker.setParameters({ tessedit_pageseg_mode: '4' as any });
  const initDuration = performance.now() - initStart;
  console.log(`[OCR Engine Init]: ${initDuration.toFixed(2)} ms (Cached Local Traineddata + Node Worker)`);

  const results = [];

  for (const filename of files) {
    const filePath = path.join(fixturesDir, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping missing ${filename}`);
      continue;
    }

    console.log(`\n--- Benchmarking ${filename} ---`);

    // Stage 1: File reading / decoding
    const t0 = performance.now();
    const rawBuffer = fs.readFileSync(filePath);
    const decodeTime = performance.now() - t0;

    // Stage 2: Preprocessing (Base64 conversion / buffer validation / hash)
    const t1 = performance.now();
    const base64 = `data:image/png;base64,${rawBuffer.toString('base64')}`;
    const base64Clean = base64.replace(/^data:image\/[a-z]+;base64,/, '');
    const cleanBuffer = Buffer.from(base64Clean, 'base64');
    const preprocessTime = performance.now() - t1;

    // Stage 3: OCR Recognition (Arabic + English jointly in PSM 4)
    const t2 = performance.now();
    const ocrResult = await worker.recognize(cleanBuffer);
    const rawText = ocrResult.data.text || '';
    const ocrTime = performance.now() - t2;

    // Stage 4: Text Parsing & Financial Field Extraction
    const t3 = performance.now();
    const parsed = parseBankakReceiptText(rawText);
    const parseTime = performance.now() - t3;

    const totalTime = decodeTime + preprocessTime + ocrTime + parseTime;

    console.log(`  - Image Decoding:     ${decodeTime.toFixed(2)} ms`);
    console.log(`  - Image Preprocess:   ${preprocessTime.toFixed(2)} ms`);
    console.log(`  - OCR Recognition:    ${ocrTime.toFixed(2)} ms (${(ocrTime / 1000).toFixed(2)} s)`);
    console.log(`  - Text Parsing:       ${parseTime.toFixed(2)} ms`);
    console.log(`  - Total Time:         ${totalTime.toFixed(2)} ms`);
    console.log(`  Extracted -> Txn: ${parsed.transactionId} | Amount: ${parsed.amount} | Recv: "${parsed.receiverName}" | Date: "${parsed.transactionDate}"`);

    results.push({
      file: filename,
      decodeTime,
      preprocessTime,
      ocrTime,
      parseTime,
      totalTime,
      parsed,
      rawText,
    });
  }

  await worker.terminate();

  console.log('\n========================================================================');
  console.log('  Summary Table:');
  console.log('========================================================================');
  for (const r of results) {
    console.log(`${r.file}: Total ${r.totalTime.toFixed(0)}ms (OCR: ${r.ocrTime.toFixed(0)}ms, Parsing: ${r.parseTime.toFixed(2)}ms)`);
  }
}

benchmark().catch(console.error);
