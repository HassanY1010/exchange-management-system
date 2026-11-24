import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { createWorker } from 'tesseract.js';

async function benchmarkPsm11() {
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
    const imgBuf = fs.readFileSync(path.join('scripts', 'prod-fixtures', filename));
    const t0 = performance.now();
    const res = await worker.recognize(imgBuf);
    const duration = performance.now() - t0;
    console.log(`${filename}: ${duration.toFixed(2)} ms (${(duration / 1000).toFixed(2)} s)`);
  }

  await worker.terminate();
}

benchmarkPsm11().catch(console.error);
