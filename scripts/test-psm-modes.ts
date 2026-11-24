import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

async function testModes() {
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
    console.log(`\n================= Testing ${filename} =================`);
    const imgBuf = fs.readFileSync(path.join('scripts', 'prod-fixtures', filename));

    for (const psm of ['4', '6', '3']) {
      await worker.setParameters({ tessedit_pageseg_mode: psm as any });
      const res = await worker.recognize(imgBuf);
      console.log(`--- PSM ${psm} ---`);
      console.log(res.data.text);
    }
  }

  await worker.terminate();
}

testModes().catch(console.error);
