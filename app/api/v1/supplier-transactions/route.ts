import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';
import { CurrencyInventoryService } from '@/lib/inventory/currency-inventory-service';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const supplierId = searchParams.get('supplierId');
  const transactionType = searchParams.get('transactionType');

  const whereClause: any = {};
  if (supplierId) whereClause.supplierId = supplierId;
  if (transactionType) whereClause.transactionType = transactionType;

  const [transactions, inventories] = await Promise.all([
    prisma.supplierTransaction.findMany({
      where: whereClause,
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
    }),
    CurrencyInventoryService.getAllInventories(),
  ]);

  // Aggregate high-level trading KPIs
  let totalPurchasesSdg = 0;
  let totalPurchasesEgp = 0;
  let totalSalesSdg = 0;
  let totalSalesEgp = 0;
  let totalRealizedProfit = 0;

  for (const t of transactions) {
    if (t.status === 'completed') {
      if (t.transactionType === 'BUY_SDG_PAY_EGP') {
        totalPurchasesSdg += Number(t.fromAmount);
        totalPurchasesEgp += Number(t.toAmount);
      } else if (t.transactionType === 'SELL_SDG_GET_EGP') {
        totalSalesSdg += Number(t.fromAmount);
        totalSalesEgp += Number(t.toAmount);
        totalRealizedProfit += Number(t.profitAmount || 0);
      }
    }
  }

  const sdgInventory = inventories.find((i) => i.currency === 'SDG');

  return NextResponse.json({
    success: true,
    data: transactions,
    inventories,
    kpis: {
      totalPurchasesSdg,
      totalPurchasesEgp,
      totalSalesSdg,
      totalSalesEgp,
      totalRealizedProfit,
      activeInventorySdg: sdgInventory?.currentQuantity || 0,
      activeInventoryCostEgp: sdgInventory?.totalCostBase || 0,
      wacPerMillionEgp: sdgInventory?.costPerMillion || 0,
      effectiveWacRate: sdgInventory?.effectiveRateSdgPerEgp || 0,
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تنفيذ عمليات تداول العملات مع الموردين مقتصرة على المدير والمحاسب' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const {
      supplierId,
      transactionType, // BUY_SDG_PAY_EGP, SELL_SDG_GET_EGP
      fromAmount,
      toAmount,
      exchangeRate,
      feeAmount = 0,
      paymentAccountId,
      vaultAccountId,
      notes,
    } = body;

    if (!supplierId || !transactionType || !fromAmount || !toAmount || !exchangeRate) {
      return NextResponse.json(
        { error: 'جميع بيانات العملية (المورد، نوع العملية، المبالغ، وسعر الصرف) مطلوبة' },
        { status: 400 }
      );
    }

    const dFrom = new Decimal(fromAmount);
    const dTo = new Decimal(toAmount);
    const dRate = new Decimal(exchangeRate);

    if (dFrom.lessThanOrEqualTo(0) || dTo.lessThanOrEqualTo(0) || dRate.lessThanOrEqualTo(0)) {
      return NextResponse.json(
        { error: 'المبالغ وسعر الصرف يجب أن تكون أرقاماً موجبة أكبر من صفر' },
        { status: 400 }
      );
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) {
      return NextResponse.json({ error: 'المورد غير موجود' }, { status: 404 });
    }

    if (supplier.status !== 'active') {
      return NextResponse.json(
        { error: 'لا يمكن تنفيذ عمليات تداول مع مورد معطل أو موقوف' },
        { status: 400 }
      );
    }

    const isBuyingSdg = transactionType === 'BUY_SDG_PAY_EGP';
    const tradedCurrency = 'SDG';
    const baseCurrency = 'EGP';

    // Locate accounts: Safes, Clearing, and Profit
    const egpSafe = paymentAccountId
      ? await prisma.account.findUnique({ where: { id: paymentAccountId } })
      : await prisma.account.findFirst({ where: { accountCode: '1010' } });

    const sdgSafe = vaultAccountId
      ? await prisma.account.findUnique({ where: { id: vaultAccountId } })
      : (await prisma.account.findFirst({ where: { accountCode: '1020' } })) ||
        (await prisma.account.findFirst({ where: { accountCode: '1030' } }));

    const clearingEgp = await prisma.account.findFirst({ where: { accountCode: '1060' } });
    const clearingSdg = await prisma.account.findFirst({ where: { accountCode: '1065' } });
    const profitAccount = await prisma.account.findFirst({ where: { accountCode: '4010' } });

    if (!egpSafe || !sdgSafe || !clearingEgp || !clearingSdg) {
      return NextResponse.json(
        { error: 'الحسابات المالية والصناديق الخاصة بالعملات وحسابات الوساطة غير مهيأة' },
        { status: 500 }
      );
    }

    const count = await prisma.supplierTransaction.count();
    const transactionNumber = `SUP-TXN-${Date.now()}-${count + 1}`;

    // Execute atomic transaction with Row-Level Locks on Accounts and Inventory
    const result = await prisma.$transaction(async (tx) => {
      let cogsAmount = 0;
      let profitAmount = 0;
      let wacRate = 0;

      if (isBuyingSdg) {
        // --- OPERATION 1: BUY SDG, PAY EGP ---
        // 1. Lock EGP safe and verify sufficiency
        const lockedEgpSafeRows = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
          egpSafe.id
        );
        const lockedEgpSafe = lockedEgpSafeRows[0];
        const safeBal = new Decimal(lockedEgpSafe.currentBalance.toString());

        if (safeBal.lessThan(dTo)) {
          throw new Error(
            `رصيد خزينة الجنيه المصري (${lockedEgpSafe.name}) لا يكفي لسداد قيمة الشراء. المتاح: ${safeBal.toFixed(2)} EGP، والمطلوب: ${dTo.toFixed(2)} EGP`
          );
        }

        // 2. Lock SDG safe
        await tx.$queryRawUnsafe(
          'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
          sdgSafe.id
        );

        // 3. Update Currency Inventory & Calculate New WAC atomically
        const invResult = await CurrencyInventoryService.recordPurchase({
          currency: tradedCurrency,
          quantity: dFrom,
          costInBaseCurrency: dTo,
          purchaseRate: dRate,
          tx,
        });

        wacRate = invResult.weightedAverageCost;

        // 4. Post Double-Entry Ledger Transactions inside tx
        // Leg A: Receive SDG into SDG Vault
        await postLedgerTransaction({
          entryType: 'supplier_purchase_sdg',
          referenceType: 'SupplierTransaction',
          description: `استلام ${dFrom.toNumber().toLocaleString()} SDG من المورد ${supplier.name} في ${sdgSafe.name}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: sdgSafe.id,
              currency: 'SDG',
              debit: dFrom.toNumber(),
              credit: 0,
              description: `إيداع عملة مشتراة من المورد ${supplier.name}`,
            },
            {
              accountId: clearingSdg.id,
              currency: 'SDG',
              debit: 0,
              credit: dFrom.toNumber(),
              description: `تسوية وسيط شراء العملة مع المورد ${supplier.name}`,
            },
          ],
        });

        // Leg B: Pay EGP from EGP Safe
        await postLedgerTransaction({
          entryType: 'supplier_payment_egp',
          referenceType: 'SupplierTransaction',
          description: `سداد قيمة شراء عملة ${dTo.toNumber().toLocaleString()} EGP للمورد ${supplier.name} من ${lockedEgpSafe.name}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: clearingEgp.id,
              currency: 'EGP',
              debit: dTo.toNumber(),
              credit: 0,
              description: `تسوية وسيط مقابل شراء العملة للمورد ${supplier.name}`,
            },
            {
              accountId: lockedEgpSafe.id,
              currency: 'EGP',
              debit: 0,
              credit: dTo.toNumber(),
              description: `صرف كاش مصري من ${lockedEgpSafe.name} للمورد ${supplier.name}`,
            },
          ],
        });
      } else {
        // --- OPERATION 2: SELL SDG, GET EGP ---
        // 1. Lock SDG safe and verify sufficiency
        const lockedSdgSafeRows = await tx.$queryRawUnsafe<any[]>(
          'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
          sdgSafe.id
        );
        const lockedSdgSafe = lockedSdgSafeRows[0];
        const sdgBal = new Decimal(lockedSdgSafe.currentBalance.toString());

        if (sdgBal.lessThan(dFrom)) {
          throw new Error(
            `رصيد خزينة الجنيه السوداني (${lockedSdgSafe.name}) لا يكفي للتسليم. المتاح: ${sdgBal.toFixed(2)} SDG، والمطلوب بيعه: ${dFrom.toFixed(2)} SDG`
          );
        }

        // 2. Lock EGP safe
        await tx.$queryRawUnsafe(
          'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
          egpSafe.id
        );

        // 3. Update Currency Inventory & Deduct Stock with WAC COGS & Profit
        const invSale = await CurrencyInventoryService.recordSale({
          currency: tradedCurrency,
          quantity: dFrom,
          revenueInBaseCurrency: dTo,
          tx,
        });

        cogsAmount = invSale.cogs;
        profitAmount = invSale.realizedProfit;
        wacRate = invSale.weightedAverageCost;

        // 4. Post Double-Entry Ledger Transactions inside tx
        // Leg A: Receive EGP Revenue into EGP Safe
        await postLedgerTransaction({
          entryType: 'supplier_sale_revenue_egp',
          referenceType: 'SupplierTransaction',
          description: `استلام إيراد بيع عملة ${dTo.toNumber().toLocaleString()} EGP من المورد ${supplier.name} في ${egpSafe.name}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: egpSafe.id,
              currency: 'EGP',
              debit: dTo.toNumber(),
              credit: 0,
              description: `إيداع كاش مصري من بيع عملة للمورد ${supplier.name}`,
            },
            {
              accountId: clearingEgp.id,
              currency: 'EGP',
              debit: 0,
              credit: dTo.toNumber(),
              description: `تسوية وسيط إيراد بيع العملة للمورد ${supplier.name}`,
            },
          ],
        });

        // Leg B: Deliver SDG from SDG Safe
        await postLedgerTransaction({
          entryType: 'supplier_sale_deliver_sdg',
          referenceType: 'SupplierTransaction',
          description: `تسليم ${dFrom.toNumber().toLocaleString()} SDG للمورد ${supplier.name} من ${lockedSdgSafe.name}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: clearingSdg.id,
              currency: 'SDG',
              debit: dFrom.toNumber(),
              credit: 0,
              description: `تسوية وسيط تسليم العملة للمورد ${supplier.name}`,
            },
            {
              accountId: lockedSdgSafe.id,
              currency: 'SDG',
              debit: 0,
              credit: dFrom.toNumber(),
              description: `صرف عملة من ${lockedSdgSafe.name} للمورد ${supplier.name}`,
            },
          ],
        });

        // Leg C: Record Realized Profit in Exchange Profits Account (4010) if profitAccount exists
        if (profitAccount && Math.abs(profitAmount) > 0.0001) {
          if (profitAmount > 0) {
            await postLedgerTransaction({
              entryType: 'supplier_trade_profit',
              referenceType: 'SupplierTransaction',
              description: `تسجيل أرباح فروق أسعار بيع عملة (${profitAmount.toLocaleString()} EGP) من عملية ${transactionNumber}`,
              createdBy: user.name,
              tx,
              lines: [
                {
                  accountId: clearingEgp.id,
                  currency: 'EGP',
                  debit: profitAmount,
                  credit: 0,
                  description: `إثبات أرباح تداول عملات للمورد ${supplier.name}`,
                },
                {
                  accountId: profitAccount.id,
                  currency: 'EGP',
                  debit: 0,
                  credit: profitAmount,
                  description: `أرباح فروق أسعار الصرف المحققة`,
                },
              ],
            });
          } else {
            // Realized Loss
            const lossAmount = Math.abs(profitAmount);
            await postLedgerTransaction({
              entryType: 'supplier_trade_loss',
              referenceType: 'SupplierTransaction',
              description: `تسجيل خسائر فروق أسعار بيع عملة (${lossAmount.toLocaleString()} EGP) من عملية ${transactionNumber}`,
              createdBy: user.name,
              tx,
              lines: [
                {
                  accountId: profitAccount.id,
                  currency: 'EGP',
                  debit: lossAmount,
                  credit: 0,
                  description: `خسائر فروق أسعار الصرف المحققة`,
                },
                {
                  accountId: clearingEgp.id,
                  currency: 'EGP',
                  debit: 0,
                  credit: lossAmount,
                  description: `تسوية وسيط خسائر بيع العملة للمورد ${supplier.name}`,
                },
              ],
            });
          }
        }
      }

      // 5. Create SupplierTransaction Record
      const txn = await tx.supplierTransaction.create({
        data: {
          transactionNumber,
          supplierId: supplier.id,
          transactionType,
          fromCurrency: tradedCurrency,
          toCurrency: baseCurrency,
          fromAmount: dFrom.toNumber(),
          toAmount: dTo.toNumber(),
          exchangeRate: dRate.toNumber(),
          feeAmount: Number(feeAmount || 0),
          cogsAmount,
          profitAmount,
          wacRate,
          sourceAccountId: isBuyingSdg ? egpSafe.id : sdgSafe.id,
          destinationAccountId: isBuyingSdg ? sdgSafe.id : egpSafe.id,
          notes: notes?.trim() || null,
          status: 'completed',
          createdBy: user.name,
        },
        include: { supplier: true },
      });

      return { txn, cogsAmount, profitAmount, wacRate };
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'SUPPLIER_TRANSACTION',
      entityType: 'SupplierTransaction',
      entityId: result.txn.id,
      newValues: {
        transactionNumber,
        supplier: supplier.name,
        type: transactionType,
        fromAmount: dFrom.toNumber(),
        toAmount: dTo.toNumber(),
        exchangeRate: dRate.toNumber(),
        profitAmount: result.profitAmount,
        wacRate: result.wacRate,
      },
      reason: `تنفيذ عملية ${isBuyingSdg ? 'شراء' : 'بيع'} عملة مع المورد ${supplier.name} وتحديث WAC والمخزون`,
    });

    const updatedInventories = await CurrencyInventoryService.getAllInventories();

    return NextResponse.json(
      {
        success: true,
        message: `تم تنفيذ عملية ${isBuyingSdg ? 'شراء' : 'بيع'} العملة وترحيل القيود وتحديث WAC والمخزون بنجاح`,
        data: result.txn,
        inventories: updatedInventories,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error in supplier trade:', error);
    return NextResponse.json({ error: error.message || 'خطأ في تنفيذ عملية المورد' }, { status: 500 });
  }
}
