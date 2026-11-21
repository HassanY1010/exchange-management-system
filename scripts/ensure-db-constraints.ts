import { prisma } from '../lib/db';

export async function ensureReceiptDbConstraints() {
  try {
    // 1. Partial Unique Index on active transaction IDs (excluding duplicate and rejected)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_bankak_receipt_active_txn" 
      ON "BankakReceipt"("transactionId") 
      WHERE "status" NOT IN ('duplicate', 'rejected') 
        AND "transactionId" IS NOT NULL 
        AND "transactionId" != '';
    `);
    console.log('✅ Partial unique index idx_bankak_receipt_active_txn verified.');
  } catch (err: any) {
    console.warn('Note on index creation:', err.message);
  }
}

if (require.main === module) {
  ensureReceiptDbConstraints()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      prisma.$disconnect();
    });
}
