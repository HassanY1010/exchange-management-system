import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

async function testTesseractPreprocessing() {
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

  const imgBuf = fs.readFileSync(path.join('scripts', 'prod-fixtures', 'prod_receipt_21255688390.png'));

  // Test with whitelist or different parameters
  console.log('Testing with PSM 11 (sparse text)...');
  await worker.setParameters({ tessedit_pageseg_mode: '11' as any });
  let res = await worker.recognize(imgBuf);
  console.log(res.data.text);

  console.log('Testing with PSM 1 (automatic with OSD)...');
  await worker.setParameters({ tessedit_pageseg_mode: '1' as any });
  res = await worker.recognize(imgBuf);
  console.log(res.data.text);

  await worker.terminate();
}

testTesseractPreprocessing().catch(console.error);
