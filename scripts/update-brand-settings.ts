import { prisma } from '../lib/db';

async function main() {
  console.log('Updating Brand Identity Settings in Database...');

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

  const allSettings = await prisma.setting.findMany();
  console.log('Settings updated successfully:');
  for (const s of allSettings) {
    console.log(`- ${s.key}: ${s.value}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
