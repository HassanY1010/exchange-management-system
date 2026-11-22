import Decimal from 'decimal.js';

// Configure Decimal precision
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Returns the operational business date formatted as YYYY-MM-DD
 * in the configured system timezone (defaults to Africa/Cairo - Egypt UTC+2/UTC+3).
 * Accurately handles winter standard time (UTC+2) and summer daylight saving time (UTC+3)
 * dynamically using IANA timezone rules without hardcoding a fixed offset.
 */
export function getSystemBusinessDate(
  inputDate?: Date | string | null,
  timeZone: string = 'Africa/Cairo'
): string {
  if (inputDate && typeof inputDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(inputDate)) {
    return inputDate;
  }
  const d = inputDate ? (typeof inputDate === 'string' ? new Date(inputDate) : inputDate) : new Date();
  if (isNaN(d.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
}

export interface ExchangeCalculationInput {
  amount: number | string;
  rate: number | string;
  fromCurrency: string;
  toCurrency: string;
}

export interface ExchangeCalculationResult {
  fromAmount: number;
  toAmount: number;
  rate: number;
  fromCurrency: string;
  toCurrency: string;
  inverseRate: number;
}

/**
 * 1. Exchange Calculator
 * Handles conversion between currencies, primarily SDG <-> EGP
 * Example: 100,000 EGP * 200 SDG/EGP = 20,000,000 SDG
 */
export function calculateExchange(
  amount: number | string,
  rate: number | string,
  direction: 'EGP_TO_SDG' | 'SDG_TO_EGP'
): ExchangeCalculationResult {
  const dAmount = new Decimal(amount);
  const dRate = new Decimal(rate);

  if (dAmount.isNegative()) {
    throw new Error('المبلغ لا يمكن أن يكون سالباً');
  }
  if (dRate.isZero() || dRate.isNegative()) {
    throw new Error('سعر الصرف يجب أن يكون أكبر من الصفر');
  }

  let calculatedAmount: Decimal;
  let fromCurrency: string;
  let toCurrency: string;

  if (direction === 'EGP_TO_SDG') {
    // EGP to SDG: Amount in EGP * rate (e.g. 100,000 * 200 = 20,000,000 SDG)
    fromCurrency = 'EGP';
    toCurrency = 'SDG';
    calculatedAmount = dAmount.times(dRate);
  } else {
    // SDG to EGP: Amount in SDG / rate (e.g. 20,000,000 / 200 = 100,000 EGP)
    fromCurrency = 'SDG';
    toCurrency = 'EGP';
    calculatedAmount = dAmount.dividedBy(dRate);
  }

  const inverseRate = new Decimal(1).dividedBy(dRate);

  return {
    fromAmount: dAmount.toDecimalPlaces(4).toNumber(),
    toAmount: calculatedAmount.toDecimalPlaces(4).toNumber(),
    rate: dRate.toDecimalPlaces(6).toNumber(),
    fromCurrency,
    toCurrency,
    inverseRate: inverseRate.toDecimalPlaces(6).toNumber(),
  };
}

/**
 * 2. Customer Session Balance Calculator
 * Matches expected vs received receipts, delivered cash, and remaining obligations
 */
export interface SessionBalanceInput {
  requestedEgpAmount: number; // e.g. 100,000 EGP
  exchangeRate: number;       // e.g. 200 SDG/EGP
  approvedReceiptsTotalSdg: number; // e.g. 20,000,000 SDG
  deliveredEgpAmount: number; // e.g. 100,000 EGP
  overpaymentSettled?: boolean;
}

export interface SessionBalanceResult {
  expectedSdgAmount: number;
  receivedSdgAmount: number;
  remainingSdgAmount: number; // max(0, expected - received)
  overpaymentAmount: number;  // max(0, received - expected)
  amountAvailableForSettlement: number;
  isOverpaid: boolean;
  deliveredEgpAmount: number;
  remainingEgpToDeliver: number; // requested - delivered
  isFullyPaid: boolean;       // all SDG received (received >= expected)
  isFullyDelivered: boolean;  // all EGP delivered
  isCompleted: boolean;       // both satisfied
  status: 'open' | 'pending_receipts' | 'pending_delivery' | 'completed' | 'has_balance';
}

export function calculateSessionBalance(input: SessionBalanceInput): SessionBalanceResult {
  const dRequestedEgp = new Decimal(input.requestedEgpAmount || 0);
  const dRate = new Decimal(input.exchangeRate || 1);
  const dReceivedSdg = new Decimal(input.approvedReceiptsTotalSdg || 0);
  const dDeliveredEgp = new Decimal(input.deliveredEgpAmount || 0);

  const expectedSdg = dRequestedEgp.times(dRate);
  const rawDiffSdg = dReceivedSdg.minus(expectedSdg);

  // If received exceeds expected: remaining is 0 and overpayment is rawDiff
  let remainingSdg = new Decimal(0);
  let overpaymentSdg = new Decimal(0);
  let isOverpaid = false;

  if (rawDiffSdg.greaterThan(0.0001)) {
    overpaymentSdg = rawDiffSdg;
    remainingSdg = new Decimal(0);
    isOverpaid = true;
  } else {
    remainingSdg = expectedSdg.minus(dReceivedSdg);
    if (remainingSdg.lessThan(0)) remainingSdg = new Decimal(0);
    overpaymentSdg = new Decimal(0);
    isOverpaid = false;
  }

  const remainingEgp = dRequestedEgp.minus(dDeliveredEgp);

  const isFullyPaid = dRequestedEgp.greaterThan(0) && dReceivedSdg.greaterThanOrEqualTo(expectedSdg.minus(0.0001));
  const isFullyDelivered = dRequestedEgp.greaterThan(0) && dDeliveredEgp.greaterThanOrEqualTo(dRequestedEgp.minus(0.0001));
  const isCompleted = isFullyPaid && isFullyDelivered && (!isOverpaid || input.overpaymentSettled === true);

  let status: SessionBalanceResult['status'] = 'open';
  if (isCompleted) {
    status = 'completed';
  } else if (!isFullyPaid && isFullyDelivered) {
    status = 'pending_receipts';
  } else if (isFullyPaid && !isFullyDelivered) {
    status = 'pending_delivery';
  } else if (isFullyPaid && isFullyDelivered && isOverpaid && !input.overpaymentSettled) {
    status = 'pending_delivery';
  } else if (dReceivedSdg.greaterThan(0) || dDeliveredEgp.greaterThan(0)) {
    status = 'has_balance';
  }

  return {
    expectedSdgAmount: expectedSdg.toDecimalPlaces(2).toNumber(),
    receivedSdgAmount: dReceivedSdg.toDecimalPlaces(2).toNumber(),
    remainingSdgAmount: remainingSdg.toDecimalPlaces(2).toNumber(),
    overpaymentAmount: overpaymentSdg.toDecimalPlaces(2).toNumber(),
    amountAvailableForSettlement: overpaymentSdg.toDecimalPlaces(2).toNumber(),
    isOverpaid,
    deliveredEgpAmount: dDeliveredEgp.toDecimalPlaces(2).toNumber(),
    remainingEgpToDeliver: remainingEgp.toDecimalPlaces(2).toNumber(),
    isFullyPaid,
    isFullyDelivered,
    isCompleted,
    status,
  };
}

export interface SessionClosureValidation {
  canClose: boolean;
  reason?: string;
}

export function validateSessionClosure(session: {
  status: string;
  requestedAmount: number | string | Decimal;
  expectedAmount: number | string | Decimal;
  receivedAmount: number | string | Decimal;
  deliveredAmount: number | string | Decimal;
  overpaymentAmount?: number | string | Decimal;
  overpaymentSettled?: boolean;
}): SessionClosureValidation {
  if (session.status === 'completed') {
    return { canClose: false, reason: 'الجلسة مغلقة ومكتملة مسبقاً' };
  }
  if (session.status === 'cancelled') {
    return { canClose: false, reason: 'لا يمكن إغلاق جلسة ملغاة' };
  }

  const dExpected = new Decimal(session.expectedAmount.toString());
  const dReceived = new Decimal(session.receivedAmount.toString());
  const dRequested = new Decimal(session.requestedAmount.toString());
  const dDelivered = new Decimal(session.deliveredAmount.toString());
  const dOverpayment = new Decimal(session.overpaymentAmount?.toString() || '0');

  if (dReceived.lessThan(dExpected.minus(0.0001))) {
    return {
      canClose: false,
      reason: `لا يمكن إغلاق الجلسة قبل استيفاء كامل المبالغ المطلوبة بالسوداني. المستلم المعتمد: ${dReceived.toFixed(2)} SDG، والمطلوب: ${dExpected.toFixed(2)} SDG`,
    };
  }

  if (dDelivered.lessThan(dRequested.minus(0.0001))) {
    return {
      canClose: false,
      reason: `لا يمكن إغلاق الجلسة قبل تسليم كامل المبلغ بالجنيه المصري للعميل. المسلّم: ${dDelivered.toFixed(2)} EGP، والمطلوب: ${dRequested.toFixed(2)} EGP`,
    };
  }

  if (dOverpayment.greaterThan(0.0001) && !session.overpaymentSettled) {
    return {
      canClose: false,
      reason: `يوجد فائض سداد للعميل بمبلغ ${dOverpayment.toFixed(2)} SDG لم تتم تسويته محاسبياً بعد. يرجى تسوية الفائض أولاً`,
    };
  }

  return { canClose: true };
}

/**
 * 3. Double-Entry Ledger Engine
 * Enforces the core rule: Total Debit = Total Credit (Section 34.5)
 */
export interface LedgerLineEntry {
  accountId: string;
  accountName?: string;
  currency: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface LedgerValidationResult {
  isValid: boolean;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  errorMessage?: string;
}

export function validateDoubleEntry(lines: LedgerLineEntry[]): LedgerValidationResult {
  if (!lines || lines.length < 2) {
    return {
      isValid: false,
      totalDebit: 0,
      totalCredit: 0,
      difference: 0,
      errorMessage: 'القيد المحاسبي يجب أن يحتوي على طرفين على الأقل (مدين ودائن)',
    };
  }

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);

  for (const line of lines) {
    const dDebit = new Decimal(line.debit || 0);
    const dCredit = new Decimal(line.credit || 0);

    if (dDebit.isNegative() || dCredit.isNegative()) {
      return {
        isValid: false,
        totalDebit: 0,
        totalCredit: 0,
        difference: 0,
        errorMessage: 'المبالغ المحاسبية المدينة أو الدائنة لا يمكن أن تكون سالبة',
      };
    }

    if (dDebit.greaterThan(0) && dCredit.greaterThan(0)) {
      return {
        isValid: false,
        totalDebit: 0,
        totalCredit: 0,
        difference: 0,
        errorMessage: 'الطرف الواحد لا يمكن أن يكون مديناً ودائناً في نفس السطر',
      };
    }

    totalDebit = totalDebit.plus(dDebit);
    totalCredit = totalCredit.plus(dCredit);
  }

  const difference = totalDebit.minus(totalCredit).abs();
  const isValid = difference.lessThanOrEqualTo(0.0001);

  return {
    isValid,
    totalDebit: totalDebit.toDecimalPlaces(4).toNumber(),
    totalCredit: totalCredit.toDecimalPlaces(4).toNumber(),
    difference: difference.toDecimalPlaces(4).toNumber(),
    errorMessage: isValid ? undefined : `القيد غير متوازن: إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit})`,
  };
}

/**
 * 4. Custody Balance Calculator (إدارة العهد)
 * Section 15 & 21:
 * Opening Custody - Delivered to Customers + Received/Refills - Expenses = Remaining Balance
 */
export interface CustodySummaryInput {
  openingAmount: number;
  refills: number;
  deliveriesToCustomers: number;
  expensesPaid: number;
  returnsToSafe: number;
}

export interface CustodySummaryResult {
  openingAmount: number;
  totalFundsEntrusted: number; // opening + refills
  totalDisbursed: number;     // deliveries + expenses + returns
  currentRemainingBalance: number;
  hasSufficientBalance: (requestedAmount: number) => boolean;
}

export function calculateCustodyBalance(input: CustodySummaryInput): CustodySummaryResult {
  const dOpening = new Decimal(input.openingAmount || 0);
  const dRefills = new Decimal(input.refills || 0);
  const dDeliveries = new Decimal(input.deliveriesToCustomers || 0);
  const dExpenses = new Decimal(input.expensesPaid || 0);
  const dReturns = new Decimal(input.returnsToSafe || 0);

  const totalFunds = dOpening.plus(dRefills);
  const totalDisbursed = dDeliveries.plus(dExpenses).plus(dReturns);
  const remaining = totalFunds.minus(totalDisbursed);

  return {
    openingAmount: dOpening.toDecimalPlaces(2).toNumber(),
    totalFundsEntrusted: totalFunds.toDecimalPlaces(2).toNumber(),
    totalDisbursed: totalDisbursed.toDecimalPlaces(2).toNumber(),
    currentRemainingBalance: remaining.toDecimalPlaces(2).toNumber(),
    hasSufficientBalance: (requestedAmount: number) => {
      return remaining.greaterThanOrEqualTo(requestedAmount);
    },
  };
}

/**
 * 5. Currency Inventory & Weighted Average Costing (حساب تكلفة العملات)
 * Section 19 & 25:
 * Weighted Average Cost = Total Cost in EGP / Total Purchased Quantity in SDG
 */
export interface PurchaseBatch {
  amountSdg: number;
  costEgp: number;
}

export interface CostingResult {
  totalInventorySdg: number;
  totalCostEgp: number;
  averageRateSdgPerEgp: number; // e.g. 204 SDG per 1 EGP
  averageCostEgpPerMillionSdg: number;
  calculateSaleProfit: (soldSdg: number, receivedEgp: number) => {
    cogsEgp: number;
    revenueEgp: number;
    grossProfitEgp: number;
    isProfit: boolean;
  };
}

export function calculateWeightedAverageCost(batches: PurchaseBatch[]): CostingResult {
  let totalSdg = new Decimal(0);
  let totalCostEgp = new Decimal(0);

  for (const b of batches) {
    totalSdg = totalSdg.plus(new Decimal(b.amountSdg || 0));
    totalCostEgp = totalCostEgp.plus(new Decimal(b.costEgp || 0));
  }

  let averageRateSdgPerEgp = new Decimal(0);
  let averageCostEgpPerMillionSdg = new Decimal(0);

  if (totalCostEgp.greaterThan(0) && totalSdg.greaterThan(0)) {
    // Rate in SDG per 1 EGP = totalSdg / totalCostEgp
    averageRateSdgPerEgp = totalSdg.dividedBy(totalCostEgp);
    // Cost EGP per 1M SDG = (totalCostEgp / totalSdg) * 1,000,000
    averageCostEgpPerMillionSdg = totalCostEgp.dividedBy(totalSdg).times(1000000);
  }

  return {
    totalInventorySdg: totalSdg.toDecimalPlaces(2).toNumber(),
    totalCostEgp: totalCostEgp.toDecimalPlaces(2).toNumber(),
    averageRateSdgPerEgp: averageRateSdgPerEgp.toDecimalPlaces(4).toNumber(),
    averageCostEgpPerMillionSdg: averageCostEgpPerMillionSdg.toDecimalPlaces(2).toNumber(),
    calculateSaleProfit: (soldSdg: number, receivedEgp: number) => {
      const dSoldSdg = new Decimal(soldSdg || 0);
      const dReceivedEgp = new Decimal(receivedEgp || 0);

      // COGS = soldSdg * (totalCostEgp / totalSdg)
      let cogsEgp = new Decimal(0);
      if (totalSdg.greaterThan(0)) {
        cogsEgp = dSoldSdg.times(totalCostEgp.dividedBy(totalSdg));
      }

      const grossProfit = dReceivedEgp.minus(cogsEgp);

      return {
        cogsEgp: cogsEgp.toDecimalPlaces(2).toNumber(),
        revenueEgp: dReceivedEgp.toDecimalPlaces(2).toNumber(),
        grossProfitEgp: grossProfit.toDecimalPlaces(2).toNumber(),
        isProfit: grossProfit.greaterThanOrEqualTo(0),
      };
    },
  };
}

/**
 * 6. Daily Closing & Cash Reconciliation Engine (الإغلاق اليومي والمطابقة)
 * Section 24 & 31:
 * Difference = Actual Counted Balance - Expected Ledger Balance
 */
export interface ClosingAccountItem {
  accountId: string;
  accountName: string;
  accountCode?: string;
  accountType?: string;
  currency: string;
  openingBalance: number;
  totalInflow: number;
  totalOutflow: number;
  expectedBalance: number;
  actualCountedBalance: number;
}

export interface ClosingAccountReport extends ClosingAccountItem {
  difference: number;
  isBalanced: boolean;
  status: 'exact' | 'surplus' | 'deficit'; // مطابق / فائض / عجز
}

export interface CurrencyClosingSummary {
  currency: string;
  totalOpening: number;
  totalInflow: number;
  totalOutflow: number;
  totalExpected: number;
  totalActual: number;
  totalDiff: number;
  isBalanced: boolean;
  status: 'exact' | 'surplus' | 'deficit';
  accountsCount: number;
}

export interface DailyClosingSummary {
  businessDate: string;
  accounts: ClosingAccountReport[];
  byCurrency: Record<string, CurrencyClosingSummary>;
  totalExpectedEgp: number;
  totalActualEgp: number;
  totalDiffEgp: number;
  totalExpectedSdg: number;
  totalActualSdg: number;
  totalDiffSdg: number;
  hasVariances: boolean;
}

export function reconcileDailyClosing(
  businessDate: string,
  items: ClosingAccountItem[]
): DailyClosingSummary {
  const reports: ClosingAccountReport[] = [];
  const currencyTotals: Record<string, {
    totalOpening: Decimal;
    totalInflow: Decimal;
    totalOutflow: Decimal;
    totalExpected: Decimal;
    totalActual: Decimal;
    totalDiff: Decimal;
    accountsCount: number;
  }> = {};

  for (const item of items) {
    const cur = item.currency ? item.currency.toUpperCase() : 'EGP';
    const dOpening = new Decimal(item.openingBalance || 0);
    const dInflow = new Decimal(item.totalInflow || 0);
    const dOutflow = new Decimal(item.totalOutflow || 0);
    const dExpected = new Decimal(item.expectedBalance || 0);
    const dActual = new Decimal(item.actualCountedBalance !== undefined && item.actualCountedBalance !== null ? item.actualCountedBalance : dExpected);
    const diff = dActual.minus(dExpected);
    const isBalanced = diff.abs().lessThanOrEqualTo(0.0001);

    let status: ClosingAccountReport['status'] = 'exact';
    if (!isBalanced) {
      status = diff.isPositive() ? 'surplus' : 'deficit';
    }

    if (!currencyTotals[cur]) {
      currencyTotals[cur] = {
        totalOpening: new Decimal(0),
        totalInflow: new Decimal(0),
        totalOutflow: new Decimal(0),
        totalExpected: new Decimal(0),
        totalActual: new Decimal(0),
        totalDiff: new Decimal(0),
        accountsCount: 0,
      };
    }

    currencyTotals[cur].totalOpening = currencyTotals[cur].totalOpening.plus(dOpening);
    currencyTotals[cur].totalInflow = currencyTotals[cur].totalInflow.plus(dInflow);
    currencyTotals[cur].totalOutflow = currencyTotals[cur].totalOutflow.plus(dOutflow);
    currencyTotals[cur].totalExpected = currencyTotals[cur].totalExpected.plus(dExpected);
    currencyTotals[cur].totalActual = currencyTotals[cur].totalActual.plus(dActual);
    currencyTotals[cur].totalDiff = currencyTotals[cur].totalDiff.plus(diff);
    currencyTotals[cur].accountsCount += 1;

    reports.push({
      ...item,
      currency: cur,
      openingBalance: dOpening.toNumber(),
      totalInflow: dInflow.toNumber(),
      totalOutflow: dOutflow.toNumber(),
      expectedBalance: dExpected.toNumber(),
      actualCountedBalance: dActual.toNumber(),
      difference: diff.toDecimalPlaces(4).toNumber(),
      isBalanced,
      status,
    });
  }

  const byCurrency: Record<string, CurrencyClosingSummary> = {};
  for (const [cur, totals] of Object.entries(currencyTotals)) {
    const isCurBalanced = totals.totalDiff.abs().lessThanOrEqualTo(0.0001);
    byCurrency[cur] = {
      currency: cur,
      totalOpening: totals.totalOpening.toDecimalPlaces(4).toNumber(),
      totalInflow: totals.totalInflow.toDecimalPlaces(4).toNumber(),
      totalOutflow: totals.totalOutflow.toDecimalPlaces(4).toNumber(),
      totalExpected: totals.totalExpected.toDecimalPlaces(4).toNumber(),
      totalActual: totals.totalActual.toDecimalPlaces(4).toNumber(),
      totalDiff: totals.totalDiff.toDecimalPlaces(4).toNumber(),
      isBalanced: isCurBalanced,
      status: isCurBalanced ? 'exact' : totals.totalDiff.isPositive() ? 'surplus' : 'deficit',
      accountsCount: totals.accountsCount,
    };
  }

  const egpTotals = currencyTotals['EGP'] || {
    totalExpected: new Decimal(0),
    totalActual: new Decimal(0),
    totalDiff: new Decimal(0),
  };
  const sdgTotals = currencyTotals['SDG'] || {
    totalExpected: new Decimal(0),
    totalActual: new Decimal(0),
    totalDiff: new Decimal(0),
  };

  const hasVariances = reports.some((r) => !r.isBalanced);

  return {
    businessDate,
    accounts: reports,
    byCurrency,
    totalExpectedEgp: egpTotals.totalExpected.toDecimalPlaces(2).toNumber(),
    totalActualEgp: egpTotals.totalActual.toDecimalPlaces(2).toNumber(),
    totalDiffEgp: egpTotals.totalDiff.toDecimalPlaces(2).toNumber(),
    totalExpectedSdg: sdgTotals.totalExpected.toDecimalPlaces(2).toNumber(),
    totalActualSdg: sdgTotals.totalActual.toDecimalPlaces(2).toNumber(),
    totalDiffSdg: sdgTotals.totalDiff.toDecimalPlaces(2).toNumber(),
    hasVariances,
  };
}
