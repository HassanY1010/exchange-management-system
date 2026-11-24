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
  console.log('--- UPDATING USER DISPLAY NAMES ---');

  // 1. Admin -> مدير النظام
  const updatedAdmin = await prisma.user.update({
    where: { email: 'admin@exchange.com' },
    data: { name: 'مدير النظام' },
    select: { id: true, name: true, email: true, role: { select: { name: true } } },
  });
  console.log(`Updated Admin: ${updatedAdmin.name} (${updatedAdmin.email})`);

  // 2. Accountant -> المحاسب
  const updatedAccountant = await prisma.user.update({
    where: { email: 'accountant@exchange.com' },
    data: { name: 'المحاسب' },
    select: { id: true, name: true, email: true, role: { select: { name: true } } },
  });
  console.log(`Updated Accountant: ${updatedAccountant.name} (${updatedAccountant.email})`);

  // 3. Custody Officer -> أمين الصندوق
  const updatedCustody = await prisma.user.update({
    where: { email: 'mohammed@exchange.com' },
    data: { name: 'أمين الصندوق' },
    select: { id: true, name: true, email: true, role: { select: { name: true } } },
  });
  console.log(`Updated Custody Officer: ${updatedCustody.name} (${updatedCustody.email})`);

  // Update associated employee name for consistency
  const updatedEmp = await prisma.employee.updateMany({
    where: { userId: updatedCustody.id },
    data: { name: 'أمين الصندوق', jobTitle: 'مسؤول تسليم النقدية والخزينة' },
  });
  console.log(`Updated Employee record: ${updatedEmp.count} records`);

  console.log('--- DISPLAY NAMES UPDATED SUCCESSFULLY ---');
}

main().catch(console.error).finally(() => prisma.$disconnect());
