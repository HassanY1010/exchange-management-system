import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

async function inspectLines() {
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

  for (const filename of ['prod_receipt_21255688390.png', 'prod_receipt_20307388216.png']) {
    console.log(`\n=== LINES IN ${filename} ===`);
    const imgBuf = fs.readFileSync(path.join('scripts', 'prod-fixtures', filename));
    const res = await worker.recognize(imgBuf);
    for (const l of res.data.lines) {
      console.log(`Line: ${JSON.stringify(l.text)} | bbox:`, l.bbox);
    }
  }

  await worker.terminate();
}

inspectLines().catch(console.error);
