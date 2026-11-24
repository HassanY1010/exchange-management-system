import { prisma } from '../lib/db';

async function main() {
  const receipts = await prisma.bankakReceipt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log(`Found ${receipts.length} receipts in DB:`);
  for (const r of receipts) {
    console.log('====================================================');
    console.log(`ID: ${r.id} | Txn: ${r.transactionId} | Amount: ${r.amount} | Date: ${r.transactionDate} | Time: ${r.transactionTime}`);
    console.log(`Sender: "${r.senderName}" (Acc: ${r.senderAccount}) | Receiver: "${r.receiverName}" (Acc: ${r.receiverAccount})`);
    console.log(`Status: ${r.status} | Confidence: ${r.ocrConfidence}`);
    console.log(`Storage Key: ${r.imageStorageKey}`);
    console.log('RAW OCR TEXT:');
    console.log(r.ocrText);
    console.log('====================================================\n');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
