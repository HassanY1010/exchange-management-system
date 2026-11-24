import fs from 'fs';
import path from 'path';
import { createWorker } from 'tesseract.js';

async function main() {
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

  for (let i = 1; i <= 4; i++) {
    const p = path.join(process.cwd(), 'scripts', 'fixtures', `receipt${i}.jpg`);
    const res = await worker.recognize(fs.readFileSync(p));
    console.log(`\n=== receipt${i}.jpg LINES in PSM 4 ===`);
    res.data.text.split('\n').forEach((l, idx) => {
      if (l.trim()) console.log(`  [${idx}] ${JSON.stringify(l)}`);
    });
  }

  await worker.terminate();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
