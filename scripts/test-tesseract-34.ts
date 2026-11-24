import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

async function test34() {
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

  for (const name of ['receipt3.jpg', 'receipt4.jpg']) {
    const p = path.join(process.cwd(), 'scripts', 'fixtures', name);
    const buf = fs.readFileSync(p);
    for (const psm of ['3', '4']) {
      await worker.setParameters({ tessedit_pageseg_mode: psm as any });
      const res = await worker.recognize(buf);
      console.log(`\n================ PSM ${psm} FOR ${name} ================`);
      console.log(res.data.text.trim());
    }
  }

  await worker.terminate();
}

test34().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
