import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const rawUrl = process.env.DATABASE_URL || '';
const sep = rawUrl.includes('?') ? '&' : '?';
const dbUrl = rawUrl.includes('connect_timeout') ? rawUrl : `${rawUrl}${sep}connect_timeout=30`;

const prisma = new PrismaClient({
  datasources: {
    db: { url: dbUrl },
  },
});

async function main() {
  console.log('--- STARTING PRE-CLEANUP DATABASE BACKUP ---');
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `production-pre-cleanup-${timestamp}.json`);

  const backupData: Record<string, any> = {
    exportedAt: new Date().toISOString(),
    users: await prisma.user.findMany(),
    roles: await prisma.role.findMany(),
    permissions: await prisma.permission.findMany(),
    rolePermissions: await prisma.rolePermission.findMany(),
    employees: await prisma.employee.findMany(),
    customers: await prisma.customer.findMany(),
    customerSessions: await prisma.customerSession.findMany(),
    exchangeTransactions: await prisma.exchangeTransaction.findMany(),
    bankakReceipts: await prisma.bankakReceipt.findMany(),
    cashPayoutVouchers: await prisma.cashPayoutVoucher.findMany(),
    accounts: await prisma.account.findMany(),
    accountTransfers: await prisma.accountTransfer.findMany(),
    ledgerEntries: await prisma.ledgerEntry.findMany({ include: { lines: true } }),
    employeeCustodies: await prisma.employeeCustody.findMany(),
    custodyTransactions: await prisma.custodyTransaction.findMany(),
    suppliers: await prisma.supplier.findMany(),
    supplierTransactions: await prisma.supplierTransaction.findMany(),
    currencyInventories: await prisma.currencyInventory.findMany(),
    expenseCategories: await prisma.expenseCategory.findMany(),
    expenses: await prisma.expense.findMany(),
    debts: await prisma.debt.findMany({ include: { payments: true } }),
    capitalTransactions: await prisma.capitalTransaction.findMany(),
    exchangeRates: await prisma.exchangeRate.findMany(),
    dailyClosings: await prisma.dailyClosing.findMany(),
    bankStatements: await prisma.bankStatement.findMany({ include: { lines: true } }),
    notifications: await prisma.notification.findMany(),
    fileRecords: await prisma.fileRecord.findMany(),
    settings: await prisma.setting.findMany(),
    auditLogs: await prisma.auditLog.findMany(),
  };

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`Backup successfully created at: ${backupFile}`);
  console.log(`Backup size: ${fs.statSync(backupFile).size} bytes`);
  console.log('--- BACKUP FINISHED ---');
}

main().catch(console.error).finally(() => prisma.$disconnect());
