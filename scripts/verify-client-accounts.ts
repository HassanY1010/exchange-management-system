import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const rawUrl = process.env.DATABASE_URL || '';
const sep = rawUrl.includes('?') ? '&' : '?';
const dbUrl = rawUrl.includes('connect_timeout') ? rawUrl : `${rawUrl}${sep}connect_timeout=30`;

const prisma = new PrismaClient({
  datasources: {
    db: { url: dbUrl },
  },
});

async function main() {
  console.log('--- VERIFYING CLIENT USER ACCOUNTS & PERMISSIONS ---');

  const users = await prisma.user.findMany({
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  for (const u of users) {
    const isPasswordValid = await bcrypt.compare('admin123', u.passwordHash);
    const permKeys = u.role.permissions.map((p) => p.permission.key);
    console.log(`User: ${u.name} | Email: ${u.email}`);
    console.log(`   Role: ${u.role.name}`);
    console.log(`   Status: ${u.status}`);
    console.log(`   Auth Check (Password verifiable): ${isPasswordValid ? 'PASS' : 'FAIL'}`);
    console.log(`   Permissions count: ${permKeys.length}`);
    console.log(`   Sample permissions: ${permKeys.slice(0, 5).join(', ')}...`);
    console.log('----------------------------------------------------');
  }

  const auditCount = await prisma.auditLog.count();
  const auditLogs = await prisma.auditLog.findMany();
  console.log(`AuditLog records count: ${auditCount}`);
  for (const a of auditLogs) {
    console.log(`- ${a.action} (${a.entityType}) -> ${a.reason} [${a.status}] at ${a.createdAt.toISOString()}`);
  }

  const settings = await prisma.setting.findMany();
  console.log('Settings verified:');
  for (const s of settings) {
    console.log(`- ${s.key}: ${s.value}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
