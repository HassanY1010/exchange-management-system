import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';
import { parseBankakUltimate } from './test-ultimate-extraction';

async function testPsm11Only() {
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
    const p = parseBankakUltimate(res.data.text);
    console.log(`\nPSM 11 ONLY -> ${f}:`);
    console.log(`  Txn: ${p.transactionId} | Amount: ${p.amount} | Recv: "${p.receiverName}" | Date: "${p.transactionDate}" | Conf: ${p.ocrConfidence}%`);
  }

  await worker.terminate();
}

testPsm11Only().catch(console.error);
