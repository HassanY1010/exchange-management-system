import { prisma } from '../lib/db';

async function main() {
  console.log('Cleaning all Bankak Receipts from database...');

  // 1. Break self-referencing duplicateOfId
  await prisma.bankakReceipt.updateMany({
    data: { duplicateOfId: null },
  });

  // 2. Clear any bankStatementLine matches
  await prisma.bankStatementLine.updateMany({
    where: { matchedReceiptId: { not: null } },
    data: { matchedReceiptId: null, matchStatus: 'unmatched' },
  });

  // 3. Delete all receipts
  const deleted = await prisma.bankakReceipt.deleteMany({});
  console.log(`Successfully deleted ${deleted.count} receipts. The receipts table is now completely empty!`);
}

main()
  .catch((e) => {
    console.error('Error deleting receipts:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
