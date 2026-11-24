import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

async function testPsm11() {
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

  for (const filename of [
    'prod_receipt_21255688390.png',
    'prod_receipt_20307388216.png',
    'prod_receipt_20375262495.png',
    'prod_receipt_20038176728.png',
  ]) {
    console.log(`\n================= PSM 11 for ${filename} =================`);
    const imgBuf = fs.readFileSync(path.join('scripts', 'prod-fixtures', filename));
    const res = await worker.recognize(imgBuf);
    console.log(res.data.text);
  }

  await worker.terminate();
}

testPsm11().catch(console.error);
