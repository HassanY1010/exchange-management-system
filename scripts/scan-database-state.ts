import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function scan() {
  console.log('================ DATABASE INVENTORY SCAN ================');
  
  const tables = [
    { name: 'User', count: await prisma.user.count(), sample: await prisma.user.findMany({ select: { id: true, name: true, email: true, role: { select: { name: true } } } }) },
    { name: 'Role', count: await prisma.role.count() },
    { name: 'Permission', count: await prisma.permission.count() },
    { name: 'RolePermission', count: await prisma.rolePermission.count() },
    { name: 'Employee', count: await prisma.employee.count(), sample: await prisma.employee.findMany({ select: { id: true, employeeCode: true, name: true } }) },
    { name: 'Customer', count: await prisma.customer.count(), sample: await prisma.customer.findMany({ select: { id: true, customerCode: true, name: true, phone: true } }) },
    { name: 'CustomerSession', count: await prisma.customerSession.count() },
    { name: 'ExchangeTransaction', count: await prisma.exchangeTransaction.count() },
    { name: 'BankakReceipt', count: await prisma.bankakReceipt.count(), sample: await prisma.bankakReceipt.findMany({ select: { id: true, receiptNumber: true, transactionId: true, amount: true, senderName: true, receiverName: true } }) },
    { name: 'CashPayoutVoucher', count: await prisma.cashPayoutVoucher.count() },
    { name: 'Account', count: await prisma.account.count(), sample: await prisma.account.findMany({ select: { id: true, accountCode: true, name: true, currency: true, currentBalance: true, isSystem: true } }) },
    { name: 'AccountTransfer', count: await prisma.accountTransfer.count() },
    { name: 'LedgerEntry', count: await prisma.ledgerEntry.count() },
    { name: 'LedgerLine', count: await prisma.ledgerLine.count() },
    { name: 'EmployeeCustody', count: await prisma.employeeCustody.count() },
    { name: 'CustodyTransaction', count: await prisma.custodyTransaction.count() },
    { name: 'Supplier', count: await prisma.supplier.count(), sample: await prisma.supplier.findMany({ select: { id: true, supplierCode: true, name: true } }) },
    { name: 'SupplierTransaction', count: await prisma.supplierTransaction.count() },
    { name: 'CurrencyInventory', count: await prisma.currencyInventory.count(), sample: await prisma.currencyInventory.findMany() },
    { name: 'ExpenseCategory', count: await prisma.expenseCategory.count(), sample: await prisma.expenseCategory.findMany() },
    { name: 'Expense', count: await prisma.expense.count() },
    { name: 'Debt', count: await prisma.debt.count() },
    { name: 'DebtPayment', count: await prisma.debtPayment.count() },
    { name: 'CapitalTransaction', count: await prisma.capitalTransaction.count() },
    { name: 'ExchangeRate', count: await prisma.exchangeRate.count(), sample: await prisma.exchangeRate.findMany() },
    { name: 'DailyClosing', count: await prisma.dailyClosing.count() },
    { name: 'BankStatement', count: await prisma.bankStatement.count() },
    { name: 'BankStatementLine', count: await prisma.bankStatementLine.count() },
    { name: 'Notification', count: await prisma.notification.count() },
    { name: 'FileRecord', count: await prisma.fileRecord.count() },
    { name: 'AuditLog', count: await prisma.auditLog.count() },
    { name: 'Setting', count: await prisma.setting.count(), sample: await prisma.setting.findMany() },
  ];

  for (const t of tables) {
    console.log(`Table: ${t.name.padEnd(22)} Count: ${t.count}`);
    if (t.sample && t.sample.length > 0) {
      console.log(`   Sample records: ${JSON.stringify(t.sample, null, 2)}`);
    }
  }

  console.log('================ SCAN COMPLETED ================');
  await prisma.$disconnect();
}

scan().catch(err => {
  console.error('Scan error:', err);
  process.exit(1);
});
