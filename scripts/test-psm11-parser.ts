import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { parseBankakReceiptText } from '../lib/ocr/bankak-parser';

async function testPsm11Parser() {
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

  await worker.setParameters({ tessedit_pageseg_mode: '11' as any });

  const files = [
    'prod_receipt_21255688390.png',
    'prod_receipt_20307388216.png',
    'prod_receipt_20375262495.png',
    'prod_receipt_20038176728.png',
  ];

  for (const f of files) {
    const imgBuf = fs.readFileSync(path.join('scripts', 'prod-fixtures', f));
    const res = await worker.recognize(imgBuf);
    const parsed = parseBankakReceiptText(res.data.text);
    console.log(`\n=== Result for ${f} ===`);
    console.log(`Txn ID:        ${parsed.transactionId}`);
    console.log(`Amount:        ${parsed.amount}`);
    console.log(`Receiver Name: "${parsed.receiverName}"`);
    console.log(`Sender Name:   "${parsed.senderName}"`);
    console.log(`Date:          "${parsed.transactionDate}"`);
    console.log(`Time:          "${parsed.transactionTime}"`);
    console.log(`Confidence:    ${parsed.ocrConfidence}%`);
    console.log(`From Acc:      "${parsed.senderAccount}"`);
    console.log(`To Acc:        "${parsed.receiverAccount}"`);
  }

  await worker.terminate();
}

testPsm11Parser().catch(console.error);
