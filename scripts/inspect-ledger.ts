import { PrismaClient } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL || '';
const sep = rawUrl.includes('?') ? '&' : '?';
const dbUrl = rawUrl.includes('connect_timeout') ? rawUrl : `${rawUrl}${sep}connect_timeout=30`;

const prisma = new PrismaClient({
  datasources: {
    db: { url: dbUrl },
  },
});

async function main() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Connecting to database (attempt ${attempt})...`);
      const entries = await prisma.ledgerEntry.findMany({
        include: {
          lines: {
            select: {
              account: { select: { accountCode: true, name: true } },
              currency: true,
              debit: true,
              credit: true,
              description: true,
            },
          },
        },
      });

      console.log('--- LEDGER ENTRIES ---');
      for (const e of entries) {
        console.log(`Entry #${e.entryNumber} | Type: ${e.entryType} | Ref: ${e.referenceType}:${e.referenceId} | Desc: ${e.description} | Date: ${e.entryDate}`);
        for (const l of e.lines) {
          console.log(`   Acc: ${l.account.accountCode} - ${l.account.name} | Curr: ${l.currency} | Dr: ${l.debit} | Cr: ${l.credit}`);
        }
      }

      const auditSample = await prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { action: true, entityType: true, entityId: true, reason: true, createdAt: true },
      });
      console.log('--- AUDIT LOG SAMPLE ---');
      console.log(JSON.stringify(auditSample, null, 2));
      return;
    } catch (e: any) {
      console.warn(`Attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
