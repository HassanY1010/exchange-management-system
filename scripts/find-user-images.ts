import fs from 'fs';
import path from 'path';
import { processReceiptImageWithOcr } from '../lib/ocr/image-ocr';

async function scanDownloads() {
  const dir = 'C:\\Users\\HP\\Downloads';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png'));

  console.log(`Found ${files.length} images in Downloads. Scanning for target receipts...`);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > 200000) continue; // Skip huge files
      const buf = fs.readFileSync(fullPath);
      const base64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
      const res = await processReceiptImageWithOcr(base64);

      if (
        res.rawText.includes('21255688390') ||
        res.rawText.includes('20375262495') ||
        res.rawText.includes('20038176728') ||
        res.rawText.includes('5427') ||
        res.rawText.includes('5,000,000') ||
        res.rawText.includes('1,500,000')
      ) {
        console.log(`\n*** MATCH FOUND: ${file} (Size: ${stat.size} bytes) ***`);
        console.log(res.rawText);
        console.log('----------------------------------------------------');
      }
    } catch (e) {
      // ignore
    }
  }
}

scanDownloads().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
