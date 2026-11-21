import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const tables: any[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`);
    console.log('Tables in public schema:', tables.map(t => t.tablename));

    const hasMigTable = tables.some(t => t.tablename === '_prisma_migrations');
    console.log('Has _prisma_migrations table?', hasMigTable);

    if (hasMigTable) {
      const migs: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "_prisma_migrations";`);
      console.log('Migrations in DB:', migs);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
