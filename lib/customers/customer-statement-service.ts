import { prisma } from '@/lib/db';
import Decimal from 'decimal.js';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { getCustomerFinancialStatus, CustomerCurrencyBalances } from './customer-balance-service';

export type StatementCurrency = 'EGP' | 'SDG';

export interface StatementRow {
  id: string;
  type:
    | 'receipt_credit'
    | 'exchange_entitlement'
    | 'cash_payout'
    | 'custody_payout'
    | 'sdg_conversion'
    | 'overpayment_refund'
    | 'debt_receivable'
    | 'debt_payable'
    | 'debt_payment';
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp for deterministic sort
  reference: string;
  description: string;
  currency: StatementCurrency;
  debit: number; // عليه
  credit: number; // له
  runningBalance: number; // الرصيد المتراكم
  source: string;
  exchangeRate?: number;
  sdgAmount?: number;
  egpAmount?: number;
}

export interface CustomerStatementOptions {
  customerId: string;
  currency?: StatementCurrency;
  fromDate?: string | null;
  toDate?: string | null;
  asOfTimestamp?: Date | null;
  isDataEntry?: boolean;
}

export interface CustomerStatementResult {
  customer: {
    id: string;
    code: string;
    name: string;
    phone: string;
    secondaryPhone: string | null;
    whatsapp: string | null;
    city: string | null;
    address: string | null;
    identityNumber: string | null;
    status: string;
    notes: string | null;
  };
  currency: StatementCurrency;
  fromDate: string | null;
  toDate: string | null;
  openingBalance: number;
  totalDebit: number;  // إجمالي عليه خلال الفترة
  totalCredit: number; // إجمالي له خلال الفترة
  closingBalance: number;
  allTimeNetInCurrency: number;
  allTimeBalances: CustomerCurrencyBalances;
  rows: StatementRow[];
}

interface RawLedgerItem {
  id: string;
  type: StatementRow['type'];
  date: string;
  createdAt: Date;
  reference: string;
  description: string;
  currency: StatementCurrency;
  debitD: Decimal;
  creditD: Decimal;
  source: string;
  exchangeRate?: number;
  sdgAmount?: number;
  egpAmount?: number;
}

function fmtNum(val: Decimal | number): string {
  const num = val instanceof Decimal ? val.toNumber() : val;
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Generates an accurate, chronological, single-currency customer ledger statement
 * from verified database sources using Decimal.js with zero double-counting.
 */
export async function generateCustomerStatement(
  options: CustomerStatementOptions
): Promise<CustomerStatementResult | null> {
  const currency: StatementCurrency = options.currency === 'SDG' ? 'SDG' : 'EGP';
  const fromDate = options.fromDate?.trim() || null;
  const toDate = options.toDate?.trim() || null;
  const asOf = options.asOfTimestamp || null;

  const customer = await prisma.customer.findUnique({
    where: { id: options.customerId },
  });

  if (!customer) return null;

  // Fetch all verified financial sources for this customer in parallel
  const [sessions, standaloneReceipts, custodyTxns, debts, financialStatus] = await Promise.all([
    prisma.customerSession.findMany({
      where: {
        customerId: customer.id,
        status: { not: 'cancelled' },
        ...(asOf ? { createdAt: { lte: asOf } } : {}),
      },
      include: {
        receipts: {
          where: {
            status: 'approved',
            ...(asOf ? { approvedAt: { lte: asOf } } : {}),
          },
          orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
        vouchers: {
          where: {
            status: 'issued',
            ...(asOf ? { paidAt: { lte: asOf } } : {}),
          },
          orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.bankakReceipt.findMany({
      where: {
        customerId: customer.id,
        customerSessionId: null,
        status: 'approved',
        ...(asOf ? { approvedAt: { lte: asOf } } : {}),
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.custodyTransaction.findMany({
      where: {
        customerId: customer.id,
        transactionType: 'delivery_to_customer',
        ...(asOf ? { createdAt: { lte: asOf } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.debt.findMany({
      where: {
        status: { not: 'cancelled' },
        ...(asOf ? { createdAt: { lte: asOf } } : {}),
        OR: [
          { debtorType: 'customer', debtorId: customer.id },
          { creditorType: 'customer', creditorId: customer.id },
          { debtorType: 'customer', debtorId: customer.name },
          { creditorType: 'customer', creditorId: customer.name },
        ],
      },
      include: {
        payments: {
          where: asOf ? { createdAt: { lte: asOf } } : undefined,
          orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ debtDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    getCustomerFinancialStatus(customer.id),
  ]);

  const rawItems: RawLedgerItem[] = [];

  // =========================================================================
  // 1. CUSTOMER SESSIONS, APPROVED RECEIPTS & CASH PAYOUT VOUCHERS
  // =========================================================================
  for (const s of sessions) {
    const rateD = new Decimal(s.exchangeRate?.toString() || '1');
    const expectedSdgD = new Decimal(s.expectedAmount?.toString() || '0');
    const requestedEgpD = new Decimal(s.requestedAmount?.toString() || '0');
    const receivedSdgD = new Decimal(s.receivedAmount?.toString() || '0');

    if (currency === 'EGP') {
      // Each approved receipt contributes EGP entitlement up to requestedAmount
      let remainingCapSdgD = expectedSdgD;
      let remainingCapEgpD = requestedEgpD;

      for (const r of s.receipts) {
        if (remainingCapSdgD.lessThanOrEqualTo(0)) break;

        const rSdgD = new Decimal(r.amount?.toString() || '0');
        const usedSdgD = Decimal.min(rSdgD, remainingCapSdgD);
        if (usedSdgD.lessThanOrEqualTo(0)) continue;

        let rEgpD: Decimal;
        // If this receipt completes the expected SDG of the session, allocate exact remaining EGP
        if (
          usedSdgD.equals(remainingCapSdgD) &&
          receivedSdgD.greaterThanOrEqualTo(expectedSdgD.minus(0.0001))
        ) {
          rEgpD = remainingCapEgpD;
        } else {
          rEgpD = usedSdgD.dividedBy(rateD).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        }

        remainingCapSdgD = remainingCapSdgD.minus(usedSdgD);
        remainingCapEgpD = Decimal.max(0, remainingCapEgpD.minus(rEgpD));

        const rDate = r.transactionDate || s.businessDate;
        rawItems.push({
          id: `egp-rcp-${r.id}`,
          type: 'exchange_entitlement',
          date: rDate,
          createdAt: r.approvedAt || r.createdAt,
          reference: r.receiptNumber,
          description: `إيصال بنكك #${r.receiptNumber} (${s.sessionNumber}) — ${fmtNum(usedSdgD)} SDG ÷ ${fmtNum(rateD)} = ${fmtNum(rEgpD)} EGP`,
          currency: 'EGP',
          debitD: new Decimal(0),
          creditD: rEgpD,
          source: 'BankakReceipt',
          exchangeRate: rateD.toNumber(),
          sdgAmount: usedSdgD.toNumber(),
          egpAmount: rEgpD.toNumber(),
        });
      }

      // Cash Payout Vouchers (issued in EGP) -> Debit (عليه)
      if (!options.isDataEntry) {
        for (const v of s.vouchers) {
          const vAmtD = new Decimal(v.amount?.toString() || '0');
          if (vAmtD.lessThanOrEqualTo(0)) continue;
          const vDate = getSystemBusinessDate(v.paidAt);

          rawItems.push({
            id: `egp-vch-${v.id}`,
            type: 'cash_payout',
            date: vDate,
            createdAt: v.paidAt,
            reference: v.voucherNumber,
            description: `صرف نقدي — سند ${v.voucherNumber} (${s.sessionNumber})${v.recipientName ? ` • المستلم: ${v.recipientName}` : ''}`,
            currency: 'EGP',
            debitD: vAmtD,
            creditD: new Decimal(0),
            source: 'CashPayoutVoucher',
            exchangeRate: rateD.toNumber(),
            egpAmount: vAmtD.toNumber(),
          });
        }
      }
    } else {
      // SDG Statement:
      // A. Each approved receipt is a Credit (له) in SDG
      let totalApprovedInSessionD = new Decimal(0);
      for (const r of s.receipts) {
        const rSdgD = new Decimal(r.amount?.toString() || '0');
        totalApprovedInSessionD = totalApprovedInSessionD.plus(rSdgD);
        const rDate = r.transactionDate || s.businessDate;

        rawItems.push({
          id: `sdg-rcp-${r.id}`,
          type: 'receipt_credit',
          date: rDate,
          createdAt: r.approvedAt || r.createdAt,
          reference: r.receiptNumber,
          description: `إيداع بنكك معتمد #${r.receiptNumber} (مرجع: ${r.transactionId}) — ${s.sessionNumber}`,
          currency: 'SDG',
          debitD: new Decimal(0),
          creditD: rSdgD,
          source: 'BankakReceipt',
          sdgAmount: rSdgD.toNumber(),
        });
      }

      // B. Actual SDG cleared against delivered EGP payouts -> Debit (عليه) in SDG
      // Matches Ledger 2015 Debit (currency_exchange_sdg_clear) without premature zeroing
      const deliveredEgpD = new Decimal(s.deliveredAmount?.toString() || '0');
      const maxConvertibleSdgD = Decimal.min(totalApprovedInSessionD, expectedSdgD);
      const clearedSdgD = Decimal.min(
        maxConvertibleSdgD,
        deliveredEgpD.times(rateD).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      );
      if (clearedSdgD.greaterThan(0)) {
        const clearedEgpD = clearedSdgD.greaterThanOrEqualTo(expectedSdgD.minus(0.0001))
          ? requestedEgpD
          : deliveredEgpD;

        const lastVoucher = s.vouchers[s.vouchers.length - 1];
        const lastReceipt = s.receipts[s.receipts.length - 1];
        const convCreatedAt = lastVoucher
          ? lastVoucher.paidAt
          : lastReceipt
          ? new Date((lastReceipt.approvedAt || lastReceipt.createdAt).getTime() + 1)
          : s.createdAt;
        const convDate = lastVoucher ? getSystemBusinessDate(lastVoucher.paidAt) : s.businessDate;

        rawItems.push({
          id: `sdg-conv-${s.id}`,
          type: 'sdg_conversion',
          date: convDate,
          createdAt: convCreatedAt,
          reference: s.sessionNumber,
          description: `تسوية مقابل صرف نقدي (${s.sessionNumber}) — ${fmtNum(clearedSdgD)} SDG ÷ ${fmtNum(rateD)} = ${fmtNum(clearedEgpD)} EGP`,
          currency: 'SDG',
          debitD: clearedSdgD,
          creditD: new Decimal(0),
          source: 'CustomerSession',
          exchangeRate: rateD.toNumber(),
          sdgAmount: clearedSdgD.toNumber(),
          egpAmount: clearedEgpD.toNumber(),
        });
      }

      // C. Cash refund of SDG overpayment -> Debit (عليه) in SDG
      const overpaymentD = new Decimal(s.overpaymentAmount?.toString() || '0');
      if (s.overpaymentSettled && s.overpaymentAction === 'cash_refund' && overpaymentD.greaterThan(0)) {
        const refundDate = s.closedAt ? getSystemBusinessDate(s.closedAt) : s.businessDate;
        rawItems.push({
          id: `sdg-refund-${s.id}`,
          type: 'overpayment_refund',
          date: refundDate,
          createdAt: s.closedAt || s.updatedAt,
          reference: s.sessionNumber,
          description: `رد فائض سداد للعميل (بنكك) — عملية ${s.sessionNumber}`,
          currency: 'SDG',
          debitD: overpaymentD,
          creditD: new Decimal(0),
          source: 'OverpaymentSettlement',
          sdgAmount: overpaymentD.toNumber(),
        });
      }
    }
  }

  // =========================================================================
  // 2. STANDALONE APPROVED RECEIPTS (Not linked to any session) -> SDG Credit
  // =========================================================================
  if (currency === 'SDG') {
    for (const r of standaloneReceipts) {
      const rSdgD = new Decimal(r.amount?.toString() || '0');
      const rDate = r.transactionDate || getSystemBusinessDate(r.createdAt);
      rawItems.push({
        id: `sdg-standalone-${r.id}`,
        type: 'receipt_credit',
        date: rDate,
        createdAt: r.approvedAt || r.createdAt,
        reference: r.receiptNumber,
        description: `إيداع بنكك مباشر #${r.receiptNumber} (مرجع: ${r.transactionId})`,
        currency: 'SDG',
        debitD: new Decimal(0),
        creditD: rSdgD,
        source: 'BankakReceipt',
        sdgAmount: rSdgD.toNumber(),
      });
    }
  }

  // =========================================================================
  // 3. CUSTODY DELIVERIES TO CUSTOMER (Distinct from CashPayoutVoucher)
  // =========================================================================
  if (!options.isDataEntry) {
    for (const ct of custodyTxns) {
      const ctCur = (ct.currency || 'EGP').toUpperCase();
      if (ctCur !== currency) continue;

      const ctAmtD = new Decimal(ct.amount?.toString() || '0');
      if (ctAmtD.lessThanOrEqualTo(0)) continue;

      const ctDate = getSystemBusinessDate(ct.createdAt);
      rawItems.push({
        id: `custody-${ct.id}`,
        type: 'custody_payout',
        date: ctDate,
        createdAt: ct.createdAt,
        reference: ct.referenceNumber || ct.id.slice(0, 8),
        description: ct.description || `تسليم نقدي من العهدة (${ct.referenceNumber || ''})`,
        currency,
        debitD: ctAmtD,
        creditD: new Decimal(0),
        source: 'CustodyTransaction',
      });
    }
  }

  // =========================================================================
  // 4. CUSTOMER DEBTS & DEBT PAYMENTS (Isolated by currency)
  // =========================================================================
  for (const d of debts) {
    const dCur = (d.currency || '').toUpperCase();
    if (dCur !== currency) continue;

    const origD = new Decimal(d.originalAmount?.toString() || '0');
    const isDebtor =
      d.debtorType === 'customer' && (d.debtorId === customer.id || d.debtorId === customer.name);
    const isCreditor =
      d.creditorType === 'customer' && (d.creditorId === customer.id || d.creditorId === customer.name);

    if (isDebtor) {
      // Customer owes office -> Debit (عليه)
      rawItems.push({
        id: `debt-${d.id}`,
        type: 'debt_receivable',
        date: d.debtDate,
        createdAt: d.createdAt,
        reference: d.debtNumber,
        description: `دين مسجل على العميل — ${d.description}`,
        currency,
        debitD: origD,
        creditD: new Decimal(0),
        source: 'Debt',
      });

      for (const p of d.payments) {
        const pAmtD = new Decimal(p.amount?.toString() || '0');
        rawItems.push({
          id: `debtpay-${p.id}`,
          type: 'debt_payment',
          date: p.paymentDate,
          createdAt: p.createdAt,
          reference: p.reference || d.debtNumber,
          description: `سداد من العميل على الدين ${d.debtNumber}${p.reference ? ` (${p.reference})` : ''}`,
          currency,
          debitD: new Decimal(0),
          creditD: pAmtD,
          source: 'DebtPayment',
        });
      }
    } else if (isCreditor) {
      // Office owes customer -> Credit (له)
      rawItems.push({
        id: `debt-cr-${d.id}`,
        type: 'debt_payable',
        date: d.debtDate,
        createdAt: d.createdAt,
        reference: d.debtNumber,
        description: `التزام / رصيد مستحق للعميل — ${d.description}`,
        currency,
        debitD: new Decimal(0),
        creditD: origD,
        source: 'Debt',
      });

      for (const p of d.payments) {
        const pAmtD = new Decimal(p.amount?.toString() || '0');
        rawItems.push({
          id: `debtpay-cr-${p.id}`,
          type: 'debt_payment',
          date: p.paymentDate,
          createdAt: p.createdAt,
          reference: p.reference || d.debtNumber,
          description: `سداد مستحق للعميل على الالتزام ${d.debtNumber}${p.reference ? ` (${p.reference})` : ''}`,
          currency,
          debitD: pAmtD,
          creditD: new Decimal(0),
          source: 'DebtPayment',
        });
      }
    }
  }

  // =========================================================================
  // 5. DETERMINISTIC CHRONOLOGICAL SORT & RUNNING BALANCE (Decimal.js)
  // =========================================================================
  rawItems.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const tA = a.createdAt.getTime();
    const tB = b.createdAt.getTime();
    if (tA !== tB) return tA - tB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let openingBalanceD = new Decimal(0);
  let periodDebitD = new Decimal(0);
  let periodCreditD = new Decimal(0);
  let allTimeNetD = new Decimal(0);

  const periodItems: RawLedgerItem[] = [];

  for (const item of rawItems) {
    const netDeltaD = item.creditD.minus(item.debitD);
    allTimeNetD = allTimeNetD.plus(netDeltaD);

    if (fromDate && item.date < fromDate) {
      openingBalanceD = openingBalanceD.plus(netDeltaD);
      continue;
    }

    if (toDate && item.date > toDate) {
      continue;
    }

    periodItems.push(item);
  }

  let runningD = openingBalanceD;
  const rows: StatementRow[] = periodItems.map((item) => {
    periodDebitD = periodDebitD.plus(item.debitD);
    periodCreditD = periodCreditD.plus(item.creditD);
    runningD = runningD.plus(item.creditD).minus(item.debitD);

    return {
      id: item.id,
      type: item.type,
      date: item.date,
      createdAt: item.createdAt.toISOString(),
      reference: item.reference,
      description: item.description,
      currency: item.currency,
      debit: item.debitD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      credit: item.creditD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      runningBalance: runningD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      source: item.source,
      exchangeRate: item.exchangeRate,
      sdgAmount: item.sdgAmount,
      egpAmount: item.egpAmount,
    };
  });

  const closingBalanceD = openingBalanceD.plus(periodCreditD).minus(periodDebitD);

  return {
    customer: {
      id: customer.id,
      code: customer.customerCode,
      name: customer.name,
      phone: customer.phone,
      secondaryPhone: customer.secondaryPhone,
      whatsapp: customer.whatsapp,
      city: customer.city,
      address: customer.address,
      identityNumber: options.isDataEntry
        ? customer.identityNumber
          ? '****' + customer.identityNumber.slice(-4)
          : null
        : customer.identityNumber,
      status: customer.status,
      notes: options.isDataEntry ? null : customer.notes,
    },
    currency,
    fromDate,
    toDate,
    openingBalance: openingBalanceD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    totalDebit: periodDebitD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    totalCredit: periodCreditD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    closingBalance: closingBalanceD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    allTimeNetInCurrency: allTimeNetD.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    allTimeBalances: financialStatus?.balances || {
      EGP: { debtor: 0, creditor: 0, net: 0 },
      SDG: { debtor: 0, creditor: 0, net: 0 },
    },
    rows,
  };
}
