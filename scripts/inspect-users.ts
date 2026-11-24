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
  const users = await prisma.user.findMany({
    include: { role: true, employee: true },
  });

  console.log('--- CURRENT USER ACCOUNTS ---');
  for (const u of users) {
    console.log(`ID: ${u.id}`);
    console.log(`Name: ${u.name}`);
    console.log(`Email: ${u.email}`);
    console.log(`Phone: ${u.phone}`);
    console.log(`Role: ${u.role.name} (${u.role.description})`);
    console.log(`Employee: ${u.employee ? `${u.employee.employeeCode} - ${u.employee.name} (${u.employee.jobTitle})` : 'None'}`);
    console.log('------------------------------');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
