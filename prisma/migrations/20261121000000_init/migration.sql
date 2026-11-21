-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "secondaryPhone" TEXT,
    "whatsapp" TEXT,
    "identityNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "sessionNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "exchangeRate" DECIMAL(20,4) NOT NULL,
    "currencyFrom" TEXT NOT NULL DEFAULT 'SDG',
    "currencyTo" TEXT NOT NULL DEFAULT 'EGP',
    "requestedAmount" DECIMAL(20,4) NOT NULL,
    "expectedAmount" DECIMAL(20,4) NOT NULL,
    "receivedAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "deliveredAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "remainingAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "overpaymentAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "overpaymentSettled" BOOLEAN NOT NULL DEFAULT false,
    "overpaymentAction" TEXT,
    "payoutIdempotencyKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeTransaction" (
    "id" TEXT NOT NULL,
    "transactionNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerSessionId" TEXT,
    "transactionType" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "fromAmount" DECIMAL(20,4) NOT NULL,
    "toAmount" DECIMAL(20,4) NOT NULL,
    "exchangeRate" DECIMAL(20,4) NOT NULL,
    "feeAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceAccountId" TEXT,
    "destinationAccountId" TEXT,
    "employeeId" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankakReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerSessionId" TEXT,
    "exchangeTransactionId" TEXT,
    "senderName" TEXT,
    "senderAccount" TEXT,
    "receiverName" TEXT,
    "receiverAccount" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SDG',
    "transactionDate" TEXT,
    "transactionTime" TEXT,
    "bankName" TEXT NOT NULL DEFAULT 'بنكك - بنك الخرطوم',
    "ocrText" TEXT,
    "ocrConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "imageStorageKey" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "duplicateOfId" TEXT,
    "reviewedBy" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationSource" TEXT,
    "verificationBankAccountId" TEXT,
    "verificationNotes" TEXT,
    "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "suspicionReason" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankakReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "parentAccountId" TEXT,
    "openingBalance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "entryDate" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerLine" (
    "id" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "debit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "identityNumber" TEXT,
    "jobTitle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCustody" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "openingAmount" DECIMAL(20,4) NOT NULL,
    "currentAmount" DECIMAL(20,4) NOT NULL,
    "businessDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "issuedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeCustody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyTransaction" (
    "id" TEXT NOT NULL,
    "custodyId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "customerId" TEXT,
    "exchangeTransactionId" TEXT,
    "accountId" TEXT,
    "referenceNumber" TEXT,
    "description" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierTransaction" (
    "id" TEXT NOT NULL,
    "transactionNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "fromAmount" DECIMAL(20,4) NOT NULL,
    "toAmount" DECIMAL(20,4) NOT NULL,
    "exchangeRate" DECIMAL(20,4) NOT NULL,
    "feeAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "expenseNumber" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "expenseDate" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "receiptStorageKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "debtNumber" TEXT NOT NULL,
    "debtorType" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "creditorType" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "originalAmount" DECIMAL(20,4) NOT NULL,
    "remainingAmount" DECIMAL(20,4) NOT NULL,
    "debtDate" TEXT NOT NULL,
    "dueDate" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtPayment" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "paymentDate" TEXT NOT NULL,
    "reference" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalTransaction" (
    "id" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "transactionDate" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "rate" DECIMAL(20,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyClosing" (
    "id" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openingBalances" TEXT NOT NULL,
    "expectedBalances" TEXT NOT NULL,
    "actualBalances" TEXT NOT NULL,
    "differences" TEXT NOT NULL,
    "notes" TEXT,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" TEXT,
    "newValues" TEXT,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "recipientRole" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashPayoutVoucher" (
    "id" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "customerSessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "exchangeRate" DECIMAL(20,4) NOT NULL,
    "equivalentSdg" DECIMAL(20,4) NOT NULL,
    "cashSourceAccountId" TEXT NOT NULL,
    "paidBy" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientName" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashPayoutVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "statementNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL DEFAULT 'بنكك - بنك الخرطوم',
    "accountId" TEXT,
    "filename" TEXT NOT NULL,
    "fileStorageKey" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "totalLines" INTEGER NOT NULL DEFAULT 0,
    "matchedLines" INTEGER NOT NULL DEFAULT 0,
    "unmatchedLines" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "transactionDate" TEXT NOT NULL,
    "transactionTime" TEXT,
    "transactionId" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SDG',
    "senderName" TEXT,
    "beneficiaryName" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedReceiptId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileRecord" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_sessionNumber_key" ON "CustomerSession"("sessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeTransaction_transactionNumber_key" ON "ExchangeTransaction"("transactionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BankakReceipt_receiptNumber_key" ON "BankakReceipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Account_accountCode_key" ON "Account"("accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_entryNumber_key" ON "LedgerEntry"("entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierCode_key" ON "Supplier"("supplierCode");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierTransaction_transactionNumber_key" ON "SupplierTransaction"("transactionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_expenseNumber_key" ON "Expense"("expenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Debt_debtNumber_key" ON "Debt"("debtNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosing_businessDate_key" ON "DailyClosing"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashPayoutVoucher_voucherNumber_key" ON "CashPayoutVoucher"("voucherNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_statementNumber_key" ON "BankStatement"("statementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FileRecord_storageKey_key" ON "FileRecord"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeTransaction" ADD CONSTRAINT "ExchangeTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeTransaction" ADD CONSTRAINT "ExchangeTransaction_customerSessionId_fkey" FOREIGN KEY ("customerSessionId") REFERENCES "CustomerSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankakReceipt" ADD CONSTRAINT "BankakReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankakReceipt" ADD CONSTRAINT "BankakReceipt_customerSessionId_fkey" FOREIGN KEY ("customerSessionId") REFERENCES "CustomerSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankakReceipt" ADD CONSTRAINT "BankakReceipt_exchangeTransactionId_fkey" FOREIGN KEY ("exchangeTransactionId") REFERENCES "ExchangeTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCustody" ADD CONSTRAINT "EmployeeCustody_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyTransaction" ADD CONSTRAINT "CustodyTransaction_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "EmployeeCustody"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierTransaction" ADD CONSTRAINT "SupplierTransaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPayoutVoucher" ADD CONSTRAINT "CashPayoutVoucher_customerSessionId_fkey" FOREIGN KEY ("customerSessionId") REFERENCES "CustomerSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPayoutVoucher" ADD CONSTRAINT "CashPayoutVoucher_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

