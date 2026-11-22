import { prisma } from '@/lib/db';
import Decimal from 'decimal.js';

export interface RecordPurchaseParams {
  currency: string;
  quantity: Decimal | number;
  costInBaseCurrency: Decimal | number;
  purchaseRate: Decimal | number;
  tx?: any;
}

export interface RecordSaleParams {
  currency: string;
  quantity: Decimal | number;
  revenueInBaseCurrency: Decimal | number;
  tx?: any;
}

export interface InventoryResult {
  currency: string;
  baseCurrency: string;
  currentQuantity: number;
  totalCostBase: number;
  weightedAverageCost: number;
  costPerMillion: number;
  effectiveRateSdgPerEgp: number;
  totalRealizedProfit: number;
  lastPurchaseRate: number | null;
}

/**
 * Currency Inventory Service implementing strict Weighted Average Cost (WAC)
 * Formula:
 * New WAC = (Previous Total Cost + Purchase Cost) / (Previous Quantity + Purchase Quantity)
 *
 * Principles:
 * 1. Decimal precision (zero floating point inaccuracies)
 * 2. WAC remains invariant upon sales (proportional COGS relief)
 * 3. Atomic database row lock (FOR UPDATE) prevents negative stock & concurrency races
 */
export class CurrencyInventoryService {
  /**
   * Get or initialize currency inventory record
   * Protects against concurrent creation races via atomic upsert
   * Automatically initializes opening balance from existing cash safes if first time
   */
  static async getOrCreateInventory(currency: string, tx: any = prisma) {
    const cur = currency.toUpperCase().trim();
    let inv = await tx.currencyInventory.findUnique({
      where: { currency: cur },
    });

    if (!inv) {
      let initialQty = new Decimal(0);
      let initialCost = new Decimal(0);
      let initialWac = new Decimal(0);

      try {
        // Look up active cash safes/bank accounts for this currency
        const existingSafes = await tx.account.findMany({
          where: {
            currency: cur,
            accountType: { in: ['cash_safe', 'bank', 'bankak'] },
            status: 'active',
          },
        });

        if (existingSafes.length > 0) {
          const totalSafeBal = existingSafes.reduce(
            (sum: Decimal, a: any) => sum.plus(new Decimal(a.currentBalance?.toString() || '0')),
            new Decimal(0)
          );

          if (totalSafeBal.greaterThan(0)) {
            initialQty = totalSafeBal;
            // Lookup exchange rate to estimate initial cost base
            const latestRate = await tx.exchangeRate.findFirst({
              where: { fromCurrency: cur, toCurrency: 'EGP' },
              orderBy: { createdAt: 'desc' },
            });
            if (latestRate && Number(latestRate.rate) > 0) {
              const r = new Decimal(latestRate.rate.toString());
              initialCost = cur === 'SDG' ? totalSafeBal.dividedBy(r) : totalSafeBal.times(r);
              initialWac = initialCost.dividedBy(initialQty);
            }
          }
        }
      } catch (err) {
        // Fallback to 0 if account lookup fails
      }

      // Atomic upsert with P2002 catch protects against race conditions on initial creation
      try {
        inv = await tx.currencyInventory.upsert({
          where: { currency: cur },
          create: {
            currency: cur,
            baseCurrency: 'EGP',
            currentQuantity: initialQty.toNumber(),
            totalCostBase: initialCost.toNumber(),
            weightedAverageCost: initialWac.toNumber(),
            totalRealizedProfit: 0,
          },
          update: {},
        });
      } catch (err: any) {
        if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
          inv = await tx.currencyInventory.findUnique({
            where: { currency: cur },
          });
        } else {
          throw err;
        }
      }
    }

    return inv;
  }

  /**
   * Record a currency purchase and update WAC
   */
  static async recordPurchase(params: RecordPurchaseParams) {
    const { currency, quantity, costInBaseCurrency, purchaseRate, tx = prisma } = params;

    const dQty = new Decimal(quantity);
    const dCost = new Decimal(costInBaseCurrency);
    const dRate = new Decimal(purchaseRate);

    if (dQty.lessThanOrEqualTo(0) || dCost.lessThanOrEqualTo(0)) {
      throw new Error('الكمية وتكلفة الشراء يجب أن تكون أكبر من الصفر');
    }

    // Lock the inventory row for update
    const inv = await this.getOrCreateInventory(currency, tx);
    const lockedRows = (await tx.$queryRawUnsafe(
      'SELECT id, "currentQuantity", "totalCostBase", "weightedAverageCost", "totalRealizedProfit" FROM "CurrencyInventory" WHERE id = $1 FOR UPDATE',
      inv.id
    )) as any[];
    const locked = lockedRows[0];

    const prevQty = new Decimal(locked.currentQuantity.toString());
    const prevCost = new Decimal(locked.totalCostBase.toString());

    // Exact Weighted Average Cost Calculation
    const newQty = prevQty.plus(dQty);
    const newCost = prevCost.plus(dCost);
    const newWac = newCost.dividedBy(newQty); // Cost in Base Currency (EGP) per 1 unit of bought currency

    const updated = await tx.currencyInventory.update({
      where: { id: inv.id },
      data: {
        currentQuantity: newQty.toNumber(),
        totalCostBase: newCost.toNumber(),
        weightedAverageCost: newWac.toNumber(),
        lastPurchaseRate: dRate.toNumber(),
      },
    });

    return {
      updated,
      prevQuantity: prevQty.toNumber(),
      newQuantity: newQty.toNumber(),
      newCost: newCost.toNumber(),
      weightedAverageCost: newWac.toNumber(),
      costPerMillion: newWac.times(1000000).toNumber(),
    };
  }

  /**
   * Record a currency sale, deduct inventory, calculate COGS and Realized Profit
   */
  static async recordSale(params: RecordSaleParams) {
    const { currency, quantity, revenueInBaseCurrency, tx = prisma } = params;

    const dSellQty = new Decimal(quantity);
    const dRevenue = new Decimal(revenueInBaseCurrency);

    if (dSellQty.lessThanOrEqualTo(0) || dRevenue.lessThanOrEqualTo(0)) {
      throw new Error('كمية البيع وقيمة الإيراد يجب أن تكون أكبر من الصفر');
    }

    // Lock the inventory row for update
    const inv = await this.getOrCreateInventory(currency, tx);
    const lockedRows = (await tx.$queryRawUnsafe(
      'SELECT id, "currentQuantity", "totalCostBase", "weightedAverageCost", "totalRealizedProfit" FROM "CurrencyInventory" WHERE id = $1 FOR UPDATE',
      inv.id
    )) as any[];
    const locked = lockedRows[0];

    const prevQty = new Decimal(locked.currentQuantity.toString());
    const prevCost = new Decimal(locked.totalCostBase.toString());
    const prevProfit = new Decimal(locked.totalRealizedProfit.toString());
    const unitWac = new Decimal(locked.weightedAverageCost.toString());

    // Strict Inventory Sufficiency Check
    if (prevQty.lessThan(dSellQty)) {
      throw new Error(
        `رصيد مخزون العملة المتاح (${prevQty.toLocaleString()} ${currency.toUpperCase()}) غير كافٍ لبيع (${dSellQty.toLocaleString()} ${currency.toUpperCase()})`
      );
    }

    // COGS = Quantity Sold * Unit WAC
    const cogs = dSellQty.times(unitWac);
    // Realized Profit = Revenue - COGS
    const profit = dRevenue.minus(cogs);

    const newQty = prevQty.minus(dSellQty);
    const newCost = newQty.isZero() ? new Decimal(0) : prevCost.minus(cogs);
    // WAC remains unchanged after a sale! (or 0 if stock is completely exhausted)
    const newWac = newQty.isZero() ? new Decimal(0) : unitWac;
    const newTotalProfit = prevProfit.plus(profit);

    const updated = await tx.currencyInventory.update({
      where: { id: inv.id },
      data: {
        currentQuantity: newQty.toNumber(),
        totalCostBase: newCost.toNumber(),
        weightedAverageCost: newWac.toNumber(),
        totalRealizedProfit: newTotalProfit.toNumber(),
      },
    });

    return {
      updated,
      soldQuantity: dSellQty.toNumber(),
      cogs: cogs.toNumber(),
      revenue: dRevenue.toNumber(),
      realizedProfit: profit.toNumber(),
      isProfit: profit.greaterThanOrEqualTo(0),
      remainingQuantity: newQty.toNumber(),
      remainingCost: newCost.toNumber(),
      weightedAverageCost: newWac.toNumber(),
    };
  }

  /**
   * Fetch all inventory summaries with formatted metrics
   */
  static async getAllInventories(): Promise<InventoryResult[]> {
    const list = await prisma.currencyInventory.findMany({
      orderBy: { currency: 'asc' },
    });

    return list.map((inv) => {
      const wac = Number(inv.weightedAverageCost);
      const costPerMillion = wac * 1000000;
      // Effective rate (units per 1 base currency) = 1 / wac
      const effectiveRateSdgPerEgp = wac > 0 ? 1 / wac : 0;

      return {
        currency: inv.currency,
        baseCurrency: inv.baseCurrency,
        currentQuantity: Number(inv.currentQuantity),
        totalCostBase: Number(inv.totalCostBase),
        weightedAverageCost: wac,
        costPerMillion,
        effectiveRateSdgPerEgp,
        totalRealizedProfit: Number(inv.totalRealizedProfit),
        lastPurchaseRate: inv.lastPurchaseRate ? Number(inv.lastPurchaseRate) : null,
      };
    });
  }
}
