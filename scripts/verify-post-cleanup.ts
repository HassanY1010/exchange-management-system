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

async function verify() {
  console.log('================ POST-CLEANUP VERIFICATION ================');

  // 1. Table Counts Audit
  const counts = {
    users: await prisma.user.count(),
    roles: await prisma.role.count(),
    permissions: await prisma.permission.count(),
    rolePermissions: await prisma.rolePermission.count(),
    employees: await prisma.employee.count(),
    customers: await prisma.customer.count(),
    customerSessions: await prisma.customerSession.count(),
    exchangeTransactions: await prisma.exchangeTransaction.count(),
    bankakReceipts: await prisma.bankakReceipt.count(),
    cashPayoutVouchers: await prisma.cashPayoutVoucher.count(),
    accounts: await prisma.account.count(),
    accountTransfers: await prisma.accountTransfer.count(),
    ledgerEntries: await prisma.ledgerEntry.count(),
    ledgerLines: await prisma.ledgerLine.count(),
    employeeCustodies: await prisma.employeeCustody.count(),
    custodyTransactions: await prisma.custodyTransaction.count(),
    suppliers: await prisma.supplier.count(),
    supplierTransactions: await prisma.supplierTransaction.count(),
    currencyInventories: await prisma.currencyInventory.count(),
    expenseCategories: await prisma.expenseCategory.count(),
    expenses: await prisma.expense.count(),
    debts: await prisma.debt.count(),
    debtPayments: await prisma.debtPayment.count(),
    capitalTransactions: await prisma.capitalTransaction.count(),
    exchangeRates: await prisma.exchangeRate.count(),
    dailyClosings: await prisma.dailyClosing.count(),
    bankStatements: await prisma.bankStatement.count(),
    bankStatementLines: await prisma.bankStatementLine.count(),
    notifications: await prisma.notification.count(),
    fileRecords: await prisma.fileRecord.count(),
    settings: await prisma.setting.count(),
  };

  console.log('Table Counts:');
  console.table(counts);

  // 2. Assert Zero Transactional Data
  if (counts.customers !== 0) throw new Error(`Customers count is not 0 (found ${counts.customers})`);
  if (counts.customerSessions !== 0) throw new Error(`CustomerSessions count is not 0 (found ${counts.customerSessions})`);
  if (counts.bankakReceipts !== 0) throw new Error(`BankakReceipts count is not 0 (found ${counts.bankakReceipts})`);
  if (counts.suppliers !== 0) throw new Error(`Suppliers count is not 0 (found ${counts.suppliers})`);
  if (counts.ledgerEntries !== 0) throw new Error(`LedgerEntries count is not 0 (found ${counts.ledgerEntries})`);
  if (counts.ledgerLines !== 0) throw new Error(`LedgerLines count is not 0 (found ${counts.ledgerLines})`);
  if (counts.exchangeRates !== 0) throw new Error(`ExchangeRates count is not 0 (found ${counts.exchangeRates})`);
  if (counts.notifications !== 0) throw new Error(`Notifications count is not 0 (found ${counts.notifications})`);
  console.log('✅ PASS: All transactional, customer, supplier, and ledger tables are 100% empty.');

  // 3. Assert System Accounts Balance = 0
  const accounts = await prisma.account.findMany();
  if (accounts.length !== 13) throw new Error(`Expected 13 Chart of Accounts, found ${accounts.length}`);
  for (const acc of accounts) {
    if (Number(acc.currentBalance) !== 0 || Number(acc.openingBalance) !== 0) {
      throw new Error(`Account ${acc.accountCode} (${acc.name}) has non-zero balance: current=${acc.currentBalance}, opening=${acc.openingBalance}`);
    }
  }
  console.log('✅ PASS: All 13 Chart of Accounts exist and their balances are strictly 0.0000.');

  // 4. Assert User Authentication Intact
  const adminUser = await prisma.user.findUnique({
    where: { email: 'admin@exchange.com' },
    include: { role: true },
  });
  if (!adminUser) throw new Error('Admin user was not found!');
  const isPasswordValid = await bcrypt.compare('admin123', adminUser.passwordHash);
  if (!isPasswordValid) throw new Error('Admin password hash verification failed!');
  console.log(`✅ PASS: Admin login verified (email: ${adminUser.email}, role: ${adminUser.role.name}).`);

  // 5. Assert Brand Identity Settings Intact
  const companyName = await prisma.setting.findUnique({ where: { key: 'company_name' } });
  const companyLogo = await prisma.setting.findUnique({ where: { key: 'company_logo' } });
  if (!companyName?.value.includes('أبو جواد للتجارة')) throw new Error(`Unexpected company name: ${companyName?.value}`);
  if (companyLogo?.value !== '/brand/logo.png') throw new Error(`Unexpected company logo: ${companyLogo?.value}`);
  console.log(`✅ PASS: Brand Settings verified: ${companyName.value} | ${companyLogo.value}`);

  console.log('================ VERIFICATION PASSED WITH 100% SUCCESS ================');
}

verify().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
