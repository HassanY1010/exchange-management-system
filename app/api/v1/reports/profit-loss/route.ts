import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');

  const expenseWhere: any = { status: 'approved' };
  if (fromDate || toDate) {
    expenseWhere.expenseDate = {};
    if (fromDate) expenseWhere.expenseDate.gte = fromDate;
    if (toDate) expenseWhere.expenseDate.lte = toDate;
  }

  // 1. Real Operating Expenses from Database
  const expenses = await prisma.expense.findMany({
    where: expenseWhere,
    include: { category: true },
  });

  const totalOperatingExpenses = expenses.reduce(
    (sum, e) => sum.plus(new Decimal(e.amount.toString())),
    new Decimal(0)
  );

  // 2. Real Supplier Trading Profits from Database
  const supplierTxns = await prisma.supplierTransaction.findMany({
    where: { status: 'completed' },
  });

  let totalSupplierProfits = new Decimal(0);
  for (const st of supplierTxns) {
    // If supplier sale: revenue in EGP minus cost in EGP
    if (st.transactionType === 'SELL_SDG_GET_EGP') {
      const revEgp = new Decimal(st.toAmount.toString());
      const sdgAmount = new Decimal(st.fromAmount.toString());
      // Cost at standard benchmark rate (~200)
      const costEgp = sdgAmount.dividedBy(new Decimal(200));
      const spread = revEgp.minus(costEgp);
      if (spread.isPositive()) {
        totalSupplierProfits = totalSupplierProfits.plus(spread);
      }
    }
  }

  // 3. Real Customer Exchange Spreads from Completed Sessions
  const completedSessions = await prisma.customerSession.findMany({
    where: { status: 'completed' },
  });

  let totalExchangeProfits = new Decimal(0);
  for (const cs of completedSessions) {
    // Customer received EGP (deliveredAmount), paid SDG (receivedAmount)
    // Profit = (receivedAmount / marketBenchmarkRate) - deliveredAmount
    const receivedSdg = new Decimal(cs.receivedAmount.toString());
    const deliveredEgp = new Decimal(cs.deliveredAmount.toString());
    const marketRate = new Decimal(190); // wholesale buy rate
    if (receivedSdg.greaterThan(0)) {
      const costBasis = receivedSdg.dividedBy(marketRate);
      const spread = costBasis.minus(deliveredEgp);
      if (spread.isPositive()) {
        totalExchangeProfits = totalExchangeProfits.plus(spread);
      }
    }
  }

  // 4. Ledger profit/loss account lines
  const profitAccount = await prisma.account.findFirst({
    where: { accountType: 'profit_loss' },
    include: { ledgerLines: true },
  });

  let ledgerProfitTotal = new Decimal(0);
  if (profitAccount) {
    for (const l of profitAccount.ledgerLines) {
      ledgerProfitTotal = ledgerProfitTotal.plus(new Decimal(l.credit.toString())).minus(new Decimal(l.debit.toString()));
    }
  }

  const exchangeProfits = totalExchangeProfits.greaterThan(0)
    ? totalExchangeProfits
    : ledgerProfitTotal.greaterThan(0) ? ledgerProfitTotal : new Decimal(0);

  const totalRevenues = exchangeProfits.plus(totalSupplierProfits);
  const netProfit = totalRevenues.minus(totalOperatingExpenses);

  return NextResponse.json({
    success: true,
    data: {
      revenues: {
        exchangeProfits: exchangeProfits.toDecimalPlaces(2).toNumber(),
        supplierProfits: totalSupplierProfits.toDecimalPlaces(2).toNumber(),
        otherRevenues: 0,
        totalRevenues: totalRevenues.toDecimalPlaces(2).toNumber(),
      },
      expenses: {
        totalOperatingExpenses: totalOperatingExpenses.toDecimalPlaces(2).toNumber(),
        byCategory: expenses.map((e) => ({
          category: e.category.name,
          amount: new Decimal(e.amount.toString()).toNumber(),
          date: e.expenseDate,
        })),
      },
      netProfit: netProfit.toDecimalPlaces(2).toNumber(),
      isProfit: netProfit.greaterThanOrEqualTo(0),
    },
  });
}
