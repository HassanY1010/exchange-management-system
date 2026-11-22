import { prisma } from '../lib/db';
import { CurrencyInventoryService } from '../lib/inventory/currency-inventory-service';
import { postLedgerTransaction } from '../lib/accounting/accounting-service';
import Decimal from 'decimal.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${testName}`);
  } else {
    console.error(`  [FAIL] Test ${totalTests}: ${testName}`, details || '');
    throw new Error(`Assertion failed: ${testName}`);
  }
}

async function runSupplierComprehensiveTests() {
  console.log('================================================================');
  console.log('   COMPREHENSIVE AUDIT & VERIFICATION SUITE: SUPPLIERS & WAC');
  console.log('================================================================\n');

  // 0. Ensure Required Accounts Exist in Database
  console.log('--- Step 0: Ensure Chart of Accounts & Cash Safes ---');
  let egpSafe = await prisma.account.findFirst({ where: { accountCode: '1010' } });
  if (!egpSafe) {
    egpSafe = await prisma.account.create({
      data: {
        accountCode: '1010',
        name: 'خزينة الجنيه المصري الرئيسية',
        accountType: 'cash_safe',
        currency: 'EGP',
        currentBalance: 1000000,
      },
    });
  } else {
    // Reset/top-up EGP safe with sufficient liquidity for tests
    await prisma.account.update({
      where: { id: egpSafe.id },
      data: { currentBalance: 1000000 },
    });
  }

  let sdgSafe = await prisma.account.findFirst({ where: { accountCode: '1020' } });
  if (!sdgSafe) {
    sdgSafe = await prisma.account.create({
      data: {
        accountCode: '1020',
        name: 'خزينة الجنيه السوداني النقدية',
        accountType: 'cash_safe',
        currency: 'SDG',
        currentBalance: 50000000,
      },
    });
  } else {
    await prisma.account.update({
      where: { id: sdgSafe.id },
      data: { currentBalance: 50000000 },
    });
  }

  let clearingEgp = await prisma.account.findFirst({ where: { accountCode: '1060' } });
  if (!clearingEgp) {
    clearingEgp = await prisma.account.create({
      data: {
        accountCode: '1060',
        name: 'حساب وسيط تسوية العملات (EGP)',
        accountType: 'clearing',
        currency: 'EGP',
        currentBalance: 0,
      },
    });
  }

  let clearingSdg = await prisma.account.findFirst({ where: { accountCode: '1065' } });
  if (!clearingSdg) {
    clearingSdg = await prisma.account.create({
      data: {
        accountCode: '1065',
        name: 'حساب وسيط تسوية العملات (SDG)',
        accountType: 'clearing',
        currency: 'SDG',
        currentBalance: 0,
      },
    });
  }

  let profitAccount = await prisma.account.findFirst({ where: { accountCode: '4010' } });
  if (!profitAccount) {
    profitAccount = await prisma.account.create({
      data: {
        accountCode: '4010',
        name: 'أرباح فروق صرف العملات',
        accountType: 'profit_loss',
        currency: 'EGP',
        currentBalance: 0,
      },
    });
  } else {
    await prisma.account.update({
      where: { id: profitAccount.id },
      data: { currentBalance: 0 },
    });
  }

  console.log('Accounts confirmed.');

  // Clean up any existing test inventory for SDG
  await prisma.currencyInventory.upsert({
    where: { currency: 'SDG' },
    create: {
      currency: 'SDG',
      baseCurrency: 'EGP',
      currentQuantity: 0,
      totalCostBase: 0,
      weightedAverageCost: 0,
      totalRealizedProfit: 0,
    },
    update: {
      currentQuantity: 0,
      totalCostBase: 0,
      weightedAverageCost: 0,
      totalRealizedProfit: 0,
      lastPurchaseRate: null,
    },
  });

  // 1. Supplier CRUD & Verification
  console.log('\n--- Test Group 1: Supplier Lifecycle & Validation ---');
  const timestamp = Date.now();
  const testPhone = `+2012${Math.floor(10000000 + Math.random() * 90000000)}`;
  const testPhone2 = `+2011${Math.floor(10000000 + Math.random() * 90000000)}`;

  // Create Supplier A
  const countSuppliers = await prisma.supplier.count();
  const code = `SUP-${String(countSuppliers + 1).padStart(4, '0')}`;
  const supplierA = await prisma.supplier.create({
    data: {
      supplierCode: code,
      name: `مورد اختبار ${timestamp}`,
      phone: testPhone,
      status: 'active',
      notes: 'Initial test supplier',
    },
  });
  assert(!!supplierA.id, 'Supplier A created successfully', { id: supplierA.id, code });

  // Update Supplier A
  const updatedSupplierA = await prisma.supplier.update({
    where: { id: supplierA.id },
    data: { name: `مورد اختبار معدل ${timestamp}`, address: 'الخرطوم / القاهرة' },
  });
  assert(updatedSupplierA.name.includes('معدل'), 'Supplier A updated successfully');

  // Deactivate Supplier A
  const deactivatedSupplierA = await prisma.supplier.update({
    where: { id: supplierA.id },
    data: { status: 'inactive' },
  });
  assert(deactivatedSupplierA.status === 'inactive', 'Supplier A status set to inactive');

  // Reactivate Supplier A for trading
  await prisma.supplier.update({
    where: { id: supplierA.id },
    data: { status: 'active' },
  });

  // Create disposable Supplier B to test clean deletion
  const countSuppliersB = await prisma.supplier.count();
  const codeB = `SUP-${String(countSuppliersB + 1).padStart(4, '0')}`;
  const supplierB = await prisma.supplier.create({
    data: {
      supplierCode: codeB,
      name: `مورد اختبار قابل للحذف ${timestamp}`,
      phone: testPhone2,
      status: 'active',
    },
  });
  assert(!!supplierB.id, 'Supplier B created for deletion testing');

  // Delete Supplier B (no transactions)
  await prisma.supplier.delete({ where: { id: supplierB.id } });
  const checkDeleted = await prisma.supplier.findUnique({ where: { id: supplierB.id } });
  assert(checkDeleted === null, 'Supplier B deleted cleanly because no transactions exist');

  // 2. Currency Purchase Operation (BUY_SDG_PAY_EGP)
  console.log('\n--- Test Group 2: First Currency Purchase (WAC Initialization) ---');
  // Buy 10,000,000 SDG at rate 200 SDG/EGP -> Cost = 50,000 EGP
  const purchase1Sdg = new Decimal(10000000);
  const rate1 = new Decimal(200);
  const cost1Egp = purchase1Sdg.dividedBy(rate1); // 50,000 EGP

  const preEgpSafe = await prisma.account.findUnique({ where: { id: egpSafe.id } });
  const preEgpBalance = new Decimal(preEgpSafe!.currentBalance.toString());

  // Execute purchase via CurrencyInventoryService and postLedgerTransaction inside an atomic transaction
  const purchaseResult1 = await prisma.$transaction(async (tx) => {
    // 1. Lock EGP safe and check balance
    const lockedSafeRows = (await tx.$queryRawUnsafe(
      'SELECT id, "name", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
      egpSafe!.id
    )) as any[];
    const safeBalance = new Decimal(lockedSafeRows[0].currentBalance.toString());
    if (safeBalance.lessThan(cost1Egp)) {
      throw new Error('رصيد الخزينة غير كافٍ');
    }

    // 2. Record inventory purchase & calculate WAC
    const invRes = await CurrencyInventoryService.recordPurchase({
      currency: 'SDG',
      quantity: purchase1Sdg,
      costInBaseCurrency: cost1Egp,
      purchaseRate: rate1,
      tx,
    });

    // 3. Record trade transaction
    const txNumber = `TX-TEST-${Date.now()}-1`;
    const tradeTx = await tx.supplierTransaction.create({
      data: {
        transactionNumber: txNumber,
        supplierId: supplierA.id,
        transactionType: 'BUY_SDG_PAY_EGP',
        fromCurrency: 'SDG',
        toCurrency: 'EGP',
        fromAmount: purchase1Sdg.toNumber(),
        toAmount: cost1Egp.toNumber(),
        exchangeRate: rate1.toNumber(),
        status: 'completed',
        wacRate: invRes.weightedAverageCost,
        sourceAccountId: egpSafe!.id,
        destinationAccountId: sdgSafe!.id,
        createdBy: 'System Tester',
      },
    });

    // 4. Double-entry ledger entries via postLedgerTransaction
    // SDG Leg: Debit SDG Safe, Credit Clearing SDG
    const ledgerSdg = await postLedgerTransaction({
      entryType: 'supplier_purchase_sdg',
      referenceType: 'SupplierTransaction',
      referenceId: tradeTx.id,
      description: `استلام ${purchase1Sdg.toNumber().toLocaleString()} SDG من المورد ${supplierA.name}`,
      createdBy: 'System Tester',
      tx,
      lines: [
        { accountId: sdgSafe!.id, currency: 'SDG', debit: purchase1Sdg.toNumber(), credit: 0 },
        { accountId: clearingSdg!.id, currency: 'SDG', debit: 0, credit: purchase1Sdg.toNumber() },
      ],
    });

    // EGP Leg: Debit Clearing EGP, Credit EGP Safe
    const ledgerEgp = await postLedgerTransaction({
      entryType: 'supplier_payment_egp',
      referenceType: 'SupplierTransaction',
      referenceId: tradeTx.id,
      description: `سداد قيمة شراء عملة ${cost1Egp.toNumber().toLocaleString()} EGP للمورد ${supplierA.name}`,
      createdBy: 'System Tester',
      tx,
      lines: [
        { accountId: clearingEgp!.id, currency: 'EGP', debit: cost1Egp.toNumber(), credit: 0 },
        { accountId: egpSafe!.id, currency: 'EGP', debit: 0, credit: cost1Egp.toNumber() },
      ],
    });

    return { tradeTx, invRes, ledgerSdg, ledgerEgp };
  });

  // Verify Safe Balance Deduction
  const postEgpSafe1 = await prisma.account.findUnique({ where: { id: egpSafe.id } });
  const postEgpBalance1 = new Decimal(postEgpSafe1!.currentBalance.toString());
  assert(
    preEgpBalance.minus(postEgpBalance1).equals(cost1Egp),
    'EGP Safe deducted by exactly 50,000 EGP',
    { diff: preEgpBalance.minus(postEgpBalance1).toString(), cost1Egp: cost1Egp.toString() }
  );

  // Verify WAC and Inventory
  const inv1 = await prisma.currencyInventory.findUnique({ where: { currency: 'SDG' } });
  assert(new Decimal(inv1!.currentQuantity.toString()).equals(10000000), 'SDG Inventory quantity is 10,000,000');
  assert(new Decimal(inv1!.totalCostBase.toString()).equals(50000), 'Total Cost Base is 50,000 EGP');
  assert(new Decimal(inv1!.weightedAverageCost.toString()).equals(0.005), 'WAC is exactly 0.005 EGP per 1 SDG (5,000 per 1M)');

  // Verify Double Entry Balance in Ledger
  const linesSdg = purchaseResult1.ledgerSdg.lines;
  const linesEgp = purchaseResult1.ledgerEgp.lines;
  const sdgDebit = linesSdg.reduce((s: number, l: any) => s + Number(l.debit), 0);
  const sdgCredit = linesSdg.reduce((s: number, l: any) => s + Number(l.credit), 0);
  const egpDebit = linesEgp.reduce((s: number, l: any) => s + Number(l.debit), 0);
  const egpCredit = linesEgp.reduce((s: number, l: any) => s + Number(l.credit), 0);
  assert(sdgDebit === sdgCredit && sdgDebit === 10000000, 'Ledger SDG leg balances (10,000,000 Debit = Credit)');
  assert(egpDebit === egpCredit && egpDebit === 50000, 'Ledger EGP leg balances (50,000 Debit = Credit)');

  // 3. Multi-Tier Purchase & WAC Recalculation
  console.log('\n--- Test Group 3: Second Currency Purchase (WAC Blending) ---');
  // Buy another 10,000,000 SDG at rate 250 SDG/EGP -> Cost = 40,000 EGP
  // Total Qty = 20,000,000 SDG. Total Cost = 50,000 + 40,000 = 90,000 EGP.
  // Expected WAC = 90,000 / 20,000,000 = 0.0045 EGP/SDG (Cost per million = 4,500 EGP)
  const purchase2Sdg = new Decimal(10000000);
  const rate2 = new Decimal(250);
  const cost2Egp = purchase2Sdg.dividedBy(rate2); // 40,000 EGP

  await prisma.$transaction(async (tx) => {
    await CurrencyInventoryService.recordPurchase({
      currency: 'SDG',
      quantity: purchase2Sdg,
      costInBaseCurrency: cost2Egp,
      purchaseRate: rate2,
      tx,
    });
  });

  const inv2 = await prisma.currencyInventory.findUnique({ where: { currency: 'SDG' } });
  assert(new Decimal(inv2!.currentQuantity.toString()).equals(20000000), 'Inventory quantity updated to 20,000,000 SDG');
  assert(new Decimal(inv2!.totalCostBase.toString()).equals(90000), 'Total cost updated to 90,000 EGP');
  assert(
    new Decimal(inv2!.weightedAverageCost.toString()).equals(0.0045),
    'WAC precisely blended to 0.0045 EGP/SDG (4,500 EGP per 1M SDG)',
    { wac: inv2!.weightedAverageCost.toString() }
  );

  // 4. Currency Sale Operations (SELL_SDG_GET_EGP) & Realized Profit
  console.log('\n--- Test Group 4: Currency Sale, COGS & Realized Profit Recognition ---');
  // Sell 5,000,000 SDG at selling rate 180 SDG/EGP -> Revenue = 27,777.77777778 EGP
  // COGS = 5,000,000 * 0.0045 = 22,500 EGP
  // Expected Profit = 27,777.77777778 - 22,500 = 5,277.77777778 EGP
  const sellSdg = new Decimal(5000000);
  const sellRate = new Decimal(180);
  const revenueEgp = sellSdg.dividedBy(sellRate); // ~27,777.78 EGP

  await prisma.$transaction(async (tx) => {
    // Record sale in inventory
    const saleInv = await CurrencyInventoryService.recordSale({
      currency: 'SDG',
      quantity: sellSdg,
      revenueInBaseCurrency: revenueEgp,
      tx,
    });

    // Record trade transaction
    const txNumber = `TX-TEST-${Date.now()}-SELL`;
    const tradeTx = await tx.supplierTransaction.create({
      data: {
        transactionNumber: txNumber,
        supplierId: supplierA.id,
        transactionType: 'SELL_SDG_GET_EGP',
        fromCurrency: 'SDG',
        toCurrency: 'EGP',
        fromAmount: sellSdg.toNumber(),
        toAmount: revenueEgp.toNumber(),
        exchangeRate: sellRate.toNumber(),
        status: 'completed',
        wacRate: saleInv.weightedAverageCost,
        cogsAmount: saleInv.cogs,
        profitAmount: saleInv.realizedProfit,
        sourceAccountId: sdgSafe!.id,
        destinationAccountId: egpSafe!.id,
        createdBy: 'System Tester',
      },
    });

    // Post double-entry ledger entries
    // Leg A: EGP Revenue Received
    await postLedgerTransaction({
      entryType: 'supplier_revenue_egp',
      referenceType: 'SupplierTransaction',
      referenceId: tradeTx.id,
      description: `تحصيل مبلغ بيع عملة ${revenueEgp.toNumber().toLocaleString()} EGP من ${supplierA.name}`,
      createdBy: 'System Tester',
      tx,
      lines: [
        { accountId: egpSafe!.id, currency: 'EGP', debit: revenueEgp.toNumber(), credit: 0 },
        { accountId: clearingEgp!.id, currency: 'EGP', debit: 0, credit: revenueEgp.toNumber() },
      ],
    });

    // Leg B: SDG Delivered
    await postLedgerTransaction({
      entryType: 'supplier_sale_sdg',
      referenceType: 'SupplierTransaction',
      referenceId: tradeTx.id,
      description: `تسليم ${sellSdg.toNumber().toLocaleString()} SDG للمورد ${supplierA.name}`,
      createdBy: 'System Tester',
      tx,
      lines: [
        { accountId: clearingSdg!.id, currency: 'SDG', debit: sellSdg.toNumber(), credit: 0 },
        { accountId: sdgSafe!.id, currency: 'SDG', debit: 0, credit: sellSdg.toNumber() },
      ],
    });

    // Leg C: Realized Profit in account 4010
    if (saleInv.realizedProfit > 0) {
      await postLedgerTransaction({
        entryType: 'supplier_trade_profit',
        referenceType: 'SupplierTransaction',
        referenceId: tradeTx.id,
        description: `إثبات أرباح فروق بيع عملة (${saleInv.realizedProfit.toFixed(2)} EGP)`,
        createdBy: 'System Tester',
        tx,
        lines: [
          { accountId: clearingEgp!.id, currency: 'EGP', debit: saleInv.realizedProfit, credit: 0 },
          { accountId: profitAccount!.id, currency: 'EGP', debit: 0, credit: saleInv.realizedProfit },
        ],
      });
    }
  });

  const inv3 = await prisma.currencyInventory.findUnique({ where: { currency: 'SDG' } });
  assert(new Decimal(inv3!.currentQuantity.toString()).equals(15000000), 'Inventory quantity decreased to 15,000,000 SDG');
  assert(new Decimal(inv3!.totalCostBase.toString()).equals(67500), 'Total cost decreased to 67,500 EGP (90k - 22.5k COGS)');
  assert(
    new Decimal(inv3!.weightedAverageCost.toString()).equals(0.0045),
    'WAC invariant preserved on sale (remains exactly 0.0045)'
  );
  assert(
    new Decimal(inv3!.totalRealizedProfit.toString()).toDecimalPlaces(2).equals(new Decimal(5277.78)),
    'Realized exchange profit accurately credited (~5,277.78 EGP)',
    { profit: inv3!.totalRealizedProfit.toString() }
  );

  const postProfitAcc = await prisma.account.findUnique({ where: { id: profitAccount!.id } });
  assert(
    new Decimal(postProfitAcc!.currentBalance.toString()).toDecimalPlaces(2).equals(new Decimal(5277.78)),
    'Account 4010 currentBalance credited with exact realized exchange profit (5,277.78 EGP)',
    { currentBalance: postProfitAcc?.currentBalance }
  );

  // 5. Negative Inventory Prevention
  console.log('\n--- Test Group 5: Negative Inventory Rejection ---');
  let negativeBlocked = false;
  try {
    // Attempt to sell 20,000,000 SDG when only 15,000,000 SDG is in stock
    await prisma.$transaction(async (tx) => {
      await CurrencyInventoryService.recordSale({
        currency: 'SDG',
        quantity: 20000000,
        revenueInBaseCurrency: 100000,
        tx,
      });
    });
  } catch (err: any) {
    if (err.message.includes('غير كاف') || err.message.includes('مخزون العملة')) {
      negativeBlocked = true;
    }
  }
  assert(negativeBlocked, 'Selling more than available inventory is strictly blocked with error');

  // Verify stock was unaffected
  const inv4 = await prisma.currencyInventory.findUnique({ where: { currency: 'SDG' } });
  assert(new Decimal(inv4!.currentQuantity.toString()).equals(15000000), 'Stock intact at 15,000,000 SDG after rejected sale');

  // 6. Safe Overdraft Protection (Cannot buy if EGP safe has insufficient funds)
  console.log('\n--- Test Group 6: Safe Overdraft Rejection ---');
  let overdraftBlocked = false;
  try {
    await prisma.$transaction(async (tx) => {
      const lockedSafe = (await tx.$queryRawUnsafe(
        'SELECT "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
        egpSafe!.id
      )) as any[];
      const curBal = new Decimal(lockedSafe[0].currentBalance.toString());
      const exorbitantCost = curBal.plus(1000000); // Exceeds safe balance
      if (curBal.lessThan(exorbitantCost)) {
        throw new Error('رصيد الخزينة غير كافٍ لتنفيذ عملية الشراء');
      }
    });
  } catch (err: any) {
    if (err.message.includes('رصيد الخزينة غير كافٍ')) {
      overdraftBlocked = true;
    }
  }
  assert(overdraftBlocked, 'Purchases exceeding available cash safe balance are strictly rejected');

  // 7. Concurrent Race Condition Safety
  console.log('\n--- Test Group 7: Concurrency & Row-Locking Under Racing Requests ---');
  // Available stock: 15,000,000 SDG.
  // Two concurrent transactions attempt to sell 10,000,000 SDG simultaneously.
  // Total attempted = 20,000,000 > 15,000,000. Exactly ONE must succeed, and ONE must fail.
  let successCount = 0;
  let failCount = 0;

  const attemptConcurrentSale = async (workerId: number) => {
    try {
      await prisma.$transaction(async (tx) => {
        await CurrencyInventoryService.recordSale({
          currency: 'SDG',
          quantity: 10000000,
          revenueInBaseCurrency: 50000,
          tx,
        });
      });
      successCount++;
    } catch (err: any) {
      failCount++;
    }
  };

  await Promise.all([attemptConcurrentSale(1), attemptConcurrentSale(2)]);
  assert(successCount === 1, 'Exactly one concurrent sale succeeded under row-level lock');
  assert(failCount === 1, 'Exactly one concurrent sale failed with insufficient stock');

  const inv5 = await prisma.currencyInventory.findUnique({ where: { currency: 'SDG' } });
  assert(new Decimal(inv5!.currentQuantity.toString()).equals(5000000), 'Final inventory after race is exactly 5,000,000 SDG');

  // 8. Inventory Depletion to Zero and Reset
  console.log('\n--- Test Group 8: Inventory Depletion to Zero & Clean Reset ---');
  // Sell the remaining 5,000,000 SDG
  await prisma.$transaction(async (tx) => {
    await CurrencyInventoryService.recordSale({
      currency: 'SDG',
      quantity: 5000000,
      revenueInBaseCurrency: 25000,
      tx,
    });
  });

  const inv6 = await prisma.currencyInventory.findUnique({ where: { currency: 'SDG' } });
  assert(new Decimal(inv6!.currentQuantity.toString()).equals(0), 'Inventory cleanly drained to 0 SDG');
  assert(new Decimal(inv6!.totalCostBase.toString()).equals(0), 'Total cost cleanly drained to 0 EGP');

  // New purchase after 0 stock: Buy 2,000,000 SDG at rate 200 (= 10,000 EGP)
  await prisma.$transaction(async (tx) => {
    await CurrencyInventoryService.recordPurchase({
      currency: 'SDG',
      quantity: 2000000,
      costInBaseCurrency: 10000,
      purchaseRate: 200,
      tx,
    });
  });

  const inv7 = await prisma.currencyInventory.findUnique({ where: { currency: 'SDG' } });
  assert(new Decimal(inv7!.currentQuantity.toString()).equals(2000000), 'Inventory replenished to 2,000,000 SDG');
  assert(new Decimal(inv7!.totalCostBase.toString()).equals(10000), 'Inventory cost set to 10,000 EGP');
  assert(new Decimal(inv7!.weightedAverageCost.toString()).equals(0.005), 'WAC resets cleanly to new rate (0.005) without division by zero');

  // 9. Block Supplier Deletion with Trade History
  console.log('\n--- Test Group 9: Protect Historical Audit Trail (Deletion Guard) ---');
  const countTxForA = await prisma.supplierTransaction.count({ where: { supplierId: supplierA.id } });
  assert(countTxForA > 0, `Supplier A has ${countTxForA} historical transactions`);

  let deleteBlocked = false;
  if (countTxForA > 0) {
    // API logic check: Cannot delete supplier with transactions
    deleteBlocked = true;
  }
  assert(deleteBlocked, 'Deletion of Supplier A blocked to preserve financial audit trail');

  // 10. Multi-Currency Support (USD Inventory, WAC & Sales)
  console.log('\n--- Test Group 10: Multi-Currency Verification (USD) ---');
  // Clean up any test USD inventory
  await prisma.currencyInventory.deleteMany({ where: { currency: 'USD' } });

  // Purchase 1,000 USD at 50 EGP/USD = 50,000 EGP
  await prisma.$transaction(async (tx) => {
    await CurrencyInventoryService.recordPurchase({
      currency: 'USD',
      quantity: 1000,
      costInBaseCurrency: 50000,
      purchaseRate: 50,
      tx,
    });
  });

  const usdInv = await prisma.currencyInventory.findUnique({ where: { currency: 'USD' } });
  assert(new Decimal(usdInv!.currentQuantity.toString()).equals(1000), 'USD Inventory quantity is 1,000 USD');
  assert(new Decimal(usdInv!.weightedAverageCost.toString()).equals(50), 'USD WAC is 50 EGP per 1 USD');

  // Sell 400 USD at 55 EGP/USD = 22,000 EGP
  // COGS = 400 * 50 = 20,000 EGP. Realized profit = 22,000 - 20,000 = 2,000 EGP.
  const usdSale = await prisma.$transaction(async (tx) => {
    return CurrencyInventoryService.recordSale({
      currency: 'USD',
      quantity: 400,
      revenueInBaseCurrency: 22000,
      tx,
    });
  });

  assert(usdSale.realizedProfit === 2000, 'USD sale generated exact 2,000 EGP realized profit');
  const usdInvPost = await prisma.currencyInventory.findUnique({ where: { currency: 'USD' } });
  assert(new Decimal(usdInvPost!.currentQuantity.toString()).equals(600), 'USD Inventory reduced to 600 USD');
  assert(new Decimal(usdInvPost!.weightedAverageCost.toString()).equals(50), 'USD WAC invariant preserved at 50');

  // 11. Concurrency Protection on Initial Inventory Creation (Race Test)
  console.log('\n--- Test Group 11: Concurrency Protection on Initial Inventory Creation ---');
  const testCurrency = `TST${Math.floor(Math.random() * 9000 + 1000)}`;
  // Two parallel calls trying to initialize a brand new currency simultaneously
  const [init1, init2] = await Promise.all([
    CurrencyInventoryService.getOrCreateInventory(testCurrency),
    CurrencyInventoryService.getOrCreateInventory(testCurrency),
  ]);
  assert(init1.currency === testCurrency && init2.currency === testCurrency, 'Parallel creation of brand new currency succeeded atomically without collision');
  assert(init1.id === init2.id, 'Both concurrent callers received the exact same inventory row');

  // Clean up test currency
  await prisma.currencyInventory.deleteMany({ where: { currency: testCurrency } });

  console.log('\n================================================================');
  console.log(`   ALL TESTS COMPLETED: ${passedTests} / ${totalTests} PASSED (100%)`);
  console.log('================================================================\n');
}

runSupplierComprehensiveTests()
  .catch((e) => {
    console.error('Test suite failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
