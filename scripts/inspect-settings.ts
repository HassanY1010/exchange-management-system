import { prisma } from '../lib/db';

async function main() {
  const settings = await prisma.setting.findMany();
  console.log('Current settings in DB:');
  console.log(JSON.stringify(settings, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
