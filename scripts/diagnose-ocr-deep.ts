import fs from 'fs';
import path from 'path';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';

async function diagnose() {
  for (let i = 1; i <= 4; i++) {
    const filename = `receipt${i}.jpg`;
    const p = path.join(process.cwd(), 'scripts', 'fixtures', filename);
    const buf = fs.readFileSync(p);
    const base64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
    const res = await processReceiptImageWithOcr(base64);
    console.log(`\n======================================================`);
    console.log(`FILE: ${filename} (Size: ${buf.length} bytes)`);
    console.log(`======================================================`);
    console.log('--- RAW OCR TEXT ---');
    console.log(res.rawText);
    console.log('--- PARSED OBJECT ---');
    console.log(JSON.stringify(res.parsed, null, 2));
  }
}

diagnose().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
