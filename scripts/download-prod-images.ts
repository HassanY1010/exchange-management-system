import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/db';

async function downloadImages() {
  const receipts = await prisma.bankakReceipt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 4,
  });

  const outDir = path.join(process.cwd(), 'scripts', 'prod-fixtures');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    console.log(`Downloading ${r.transactionId} from ${r.imageStorageKey.substring(0, 80)}...`);
    try {
      const resp = await fetch(r.imageStorageKey);
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const filePath = path.join(outDir, `prod_receipt_${r.transactionId}.png`);
        fs.writeFileSync(filePath, buf);
        console.log(`Saved ${filePath} (${buf.length} bytes)`);
      } else {
        console.log(`Failed to fetch ${resp.status}`);
      }
    } catch (e: any) {
      console.error('Error fetching image:', e.message);
    }
  }
}

downloadImages().finally(() => prisma.$disconnect());
