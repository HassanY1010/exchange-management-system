import fs from 'fs';
import path from 'path';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';

async function inspectText() {
  for (const name of ['receipt1.jpg', 'receipt2.jpg']) {
    const filePath = path.join(process.cwd(), 'scripts', 'fixtures', name);
    const buffer = fs.readFileSync(filePath);
    const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    const result = await processReceiptImageWithOcr(base64);
    console.log(`\n================== RAW TEXT FOR ${name} ==================`);
    console.log(result.rawText);
    console.log('==========================================================');
  }
  process.exit(0);
}

inspectText();
