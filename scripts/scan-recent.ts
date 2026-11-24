import fs from 'fs';
import path from 'path';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';

async function scanRecent() {
  const dir = 'C:\\Users\\HP\\Downloads';
  const targets = [
    '1794824114344.jpg',
    '1794824114376.jpg',
    '1794766918289.jpg',
    '1794766918323.jpg',
    '1794766918353.jpg',
    '1794766918382.jpg',
    'IMG-20261114-WA0009.jpg',
    'IMG-20261114-WA0010.jpg',
    'IMG-20261114-WA0011.jpg',
    'IMG-20261114-WA0012.jpg',
  ];

  for (const f of targets) {
    const fullPath = path.join(dir, f);
    if (!fs.existsSync(fullPath)) continue;
    const buf = fs.readFileSync(fullPath);
    const base64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
    const res = await processReceiptImageWithOcr(base64);
    console.log(`\n=================== ${f} ===================`);
    console.log(res.rawText);
  }
}

scanRecent().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
