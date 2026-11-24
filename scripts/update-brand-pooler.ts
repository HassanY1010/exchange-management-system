import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.DATABASE_URL?.replace(':5432/', ':6543/?pgbouncer=true&') || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: {
    db: { url: dbUrl }
  }
});

async function main() {
  console.log('Testing connection to Supabase pooler on port 6543...');
  const count = await prisma.setting.count();
  console.log('Success! Found settings count:', count);

  await prisma.setting.upsert({
    where: { key: 'company_name' },
    update: {
      value: 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)',
      description: 'اسم المنشأة المعتمد',
    },
    create: {
      key: 'company_name',
      value: 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)',
      description: 'اسم المنشأة المعتمد',
    },
  });

  await prisma.setting.upsert({
    where: { key: 'company_logo' },
    update: {
      value: '/brand/logo.png',
      description: 'مسار شعار المؤسسة الرسمي',
    },
    create: {
      key: 'company_logo',
      value: '/brand/logo.png',
      description: 'مسار شعار المؤسسة الرسمي',
    },
  });

  console.log('Updated brand settings successfully in Database!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
