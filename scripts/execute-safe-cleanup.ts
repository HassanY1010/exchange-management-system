import { PrismaClient } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL || '';
const sep = rawUrl.includes('?') ? '&' : '?';
const dbUrl = rawUrl.includes('connect_timeout') ? rawUrl : `${rawUrl}${sep}connect_timeout=30`;

const prisma = new PrismaClient({
  datasources: {
    db: { url: dbUrl },
  },
});

async function safeCleanup() {
  console.log('================ STARTING SAFE TRANSACTIONAL CLEANUP ================');

  // We run inside prisma.$transaction with an extended timeout to ensure atomicity
  const result = await prisma.$transaction(async (tx) => {
    console.log('1. Deleting BankakReceipt records...');
    const deletedReceipts = await tx.bankakReceipt.deleteMany({});

    console.log('2. Deleting CashPayoutVoucher records...');
    const deletedVouchers = await tx.cashPayoutVoucher.deleteMany({});

    console.log('3. Deleting ExchangeTransaction records...');
    const deletedTransactions = await tx.exchangeTransaction.deleteMany({});

    console.log('4. Deleting CustomerSession records...');
    const deletedSessions = await tx.customerSession.deleteMany({});

    console.log('5. Deleting Customer records...');
    const deletedCustomers = await tx.customer.deleteMany({});

    console.log('6. Deleting SupplierTransaction records...');
    const deletedSupplierTxns = await tx.supplierTransaction.deleteMany({});

    console.log('7. Deleting Supplier records...');
    const deletedSuppliers = await tx.supplier.deleteMany({});

    console.log('8. Deleting CustodyTransaction records...');
    const deletedCustodyTxns = await tx.custodyTransaction.deleteMany({});

    console.log('9. Deleting EmployeeCustody records...');
    const deletedCustodies = await tx.employeeCustody.deleteMany({});

    console.log('10. Deleting LedgerLine records...');
    const deletedLedgerLines = await tx.ledgerLine.deleteMany({});

    console.log('11. Deleting LedgerEntry records...');
    const deletedLedgerEntries = await tx.ledgerEntry.deleteMany({});

    console.log('12. Deleting AccountTransfer records...');
    const deletedTransfers = await tx.accountTransfer.deleteMany({});

    console.log('13. Deleting CurrencyInventory records...');
    const deletedInventory = await tx.currencyInventory.deleteMany({});

    console.log('14. Deleting Expense records...');
    const deletedExpenses = await tx.expense.deleteMany({});

    console.log('15. Deleting DebtPayment records...');
    const deletedDebtPayments = await tx.debtPayment.deleteMany({});

    console.log('16. Deleting Debt records...');
    const deletedDebts = await tx.debt.deleteMany({});

    console.log('17. Deleting CapitalTransaction records...');
    const deletedCapital = await tx.capitalTransaction.deleteMany({});

    console.log('18. Deleting DailyClosing records...');
    const deletedClosings = await tx.dailyClosing.deleteMany({});

    console.log('19. Deleting BankStatementLine records...');
    const deletedStmtLines = await tx.bankStatementLine.deleteMany({});

    console.log('20. Deleting BankStatement records...');
    const deletedStatements = await tx.bankStatement.deleteMany({});

    console.log('21. Deleting FileRecord records...');
    const deletedFiles = await tx.fileRecord.deleteMany({});

    console.log('22. Deleting ExchangeRate records...');
    const deletedRates = await tx.exchangeRate.deleteMany({});

    console.log('23. Deleting Notification records...');
    const deletedNotifications = await tx.notification.deleteMany({});

    console.log('24. Deleting mock operation AuditLog records...');
    const deletedAuditLogs = await tx.auditLog.deleteMany({
      where: {
        entityType: {
          in: ['BankakReceipt', 'Customer', 'CustomerSession', 'Session', 'LedgerEntry', 'ExchangeTransaction'],
        },
      },
    });

    console.log('25. Resetting all Account balances to 0 (preserves 13 Chart of Accounts records)...');
    const resetAccounts = await tx.account.updateMany({
      data: {
        openingBalance: 0,
        currentBalance: 0,
      },
    });

    return {
      deletedReceipts: deletedReceipts.count,
      deletedVouchers: deletedVouchers.count,
      deletedTransactions: deletedTransactions.count,
      deletedSessions: deletedSessions.count,
      deletedCustomers: deletedCustomers.count,
      deletedSupplierTxns: deletedSupplierTxns.count,
      deletedSuppliers: deletedSuppliers.count,
      deletedCustodyTxns: deletedCustodyTxns.count,
      deletedCustodies: deletedCustodies.count,
      deletedLedgerLines: deletedLedgerLines.count,
      deletedLedgerEntries: deletedLedgerEntries.count,
      deletedTransfers: deletedTransfers.count,
      deletedInventory: deletedInventory.count,
      deletedExpenses: deletedExpenses.count,
      deletedDebtPayments: deletedDebtPayments.count,
      deletedDebts: deletedDebts.count,
      deletedCapital: deletedCapital.count,
      deletedClosings: deletedClosings.count,
      deletedStmtLines: deletedStmtLines.count,
      deletedStatements: deletedStatements.count,
      deletedFiles: deletedFiles.count,
      deletedRates: deletedRates.count,
      deletedNotifications: deletedNotifications.count,
      deletedAuditLogs: deletedAuditLogs.count,
      resetAccounts: resetAccounts.count,
    };
  }, {
    timeout: 30000, // 30s timeout for transaction
  });

  console.log('Transaction committed successfully! Summary:');
  console.log(JSON.stringify(result, null, 2));

  console.log('Verifying preserved system assets:');
  const userCount = await prisma.user.count();
  const roleCount = await prisma.role.count();
  const permCount = await prisma.permission.count();
  const empCount = await prisma.employee.count();
  const accCount = await prisma.account.count();
  const expCatCount = await prisma.expenseCategory.count();
  const settingCount = await prisma.setting.count();
  const settings = await prisma.setting.findMany();

  console.log(`- Users preserved: ${userCount} (Target: 3)`);
  console.log(`- Roles preserved: ${roleCount} (Target: 4)`);
  console.log(`- Permissions preserved: ${permCount} (Target: 19)`);
  console.log(`- Employees preserved: ${empCount} (Target: 1)`);
  console.log(`- Accounts preserved: ${accCount} (Target: 13, All balances = 0)`);
  console.log(`- Expense Categories preserved: ${expCatCount} (Target: 6)`);
  console.log(`- Settings preserved: ${settingCount} (Target: 7)`);
  for (const s of settings) {
    console.log(`   * ${s.key} = ${s.value}`);
  }

  const remainingReceipts = await prisma.bankakReceipt.count();
  const remainingCustomers = await prisma.customer.count();
  const remainingSessions = await prisma.customerSession.count();
  const remainingSuppliers = await prisma.supplier.count();
  const remainingLedger = await prisma.ledgerEntry.count();
  const remainingRates = await prisma.exchangeRate.count();
  const remainingNotifications = await prisma.notification.count();

  console.log('Verification of Deleted Demo Data:');
  console.log(`- Remaining BankakReceipts: ${remainingReceipts}`);
  console.log(`- Remaining Customers: ${remainingCustomers}`);
  console.log(`- Remaining CustomerSessions: ${remainingSessions}`);
  console.log(`- Remaining Suppliers: ${remainingSuppliers}`);
  console.log(`- Remaining LedgerEntries: ${remainingLedger}`);
  console.log(`- Remaining ExchangeRates: ${remainingRates}`);
  console.log(`- Remaining Notifications: ${remainingNotifications}`);

  console.log('================ SAFE CLEANUP COMPLETED SUCCESSFULLY ================');
}

safeCleanup().catch((err) => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
