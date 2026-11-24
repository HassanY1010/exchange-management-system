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

  const p1 = path.join(process.cwd(), 'scripts', 'fixtures', 'receipt1.jpg');
  const buf1 = fs.readFileSync(p1);

  // Test PSM 3 (default), 4 (single column), 6 (uniform block), 11 (sparse text)
  for (const psm of ['3', '4', '6', '11']) {
    await worker.setParameters({
      tessedit_pageseg_mode: psm as any,
    });
    const res = await worker.recognize(buf1);
    console.log(`\n================ PSM ${psm} FOR receipt1.jpg ================`);
    console.log(res.data.text.trim());
  }

  const p2 = path.join(process.cwd(), 'scripts', 'fixtures', 'receipt2.jpg');
  const buf2 = fs.readFileSync(p2);
  for (const psm of ['3', '4', '6', '11']) {
    await worker.setParameters({
      tessedit_pageseg_mode: psm as any,
    });
    const res = await worker.recognize(buf2);
    console.log(`\n================ PSM ${psm} FOR receipt2.jpg ================`);
    console.log(res.data.text.trim());
  }

  await worker.terminate();
}

testModes().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
