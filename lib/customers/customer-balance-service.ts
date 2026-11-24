import { prisma } from '@/lib/db';
import Decimal from 'decimal.js';

export interface CustomerCurrencyBalances {
  EGP: {
    debtor: number;   // مدين بالجنيه المصري (مطلوب من العميل للمؤسسة)
    creditor: number; // دائن بالجنيه المصري (مستحق للعميل بذمة المؤسسة)
    net: number;
  };
  SDG: {
    debtor: number;   // مدين بالجنيه السوداني (مطلوب من العميل للمؤسسة)
    creditor: number; // دائن بالجنيه السوداني (مستحق للعميل بذمة المؤسسة)
    net: number;
  };
}

export interface CustomerPendingOperations {
  count: number;
  sessions: {
    id: string;
    sessionNumber: string;
    status: string;
    businessDate: string;
    expectedSdg: number;
    receivedSdg: number;
    requestedEgp: number;
    deliveredEgp: number;
    remainingDeliverableEgp: number;
  }[];
}

export interface CustomerFinancialStatus {
  customerId: string;
  customerName: string;
  customerCode: string;
  status: string; // active, closed, blocked
  balances: CustomerCurrencyBalances;
  pendingOperations: CustomerPendingOperations;
  canClose: boolean;
  blockingReasons: string[];
}

/**
 * Calculates isolated multi-currency debtor and creditor balances for a customer.
 * - Extracts EGP & SDG balances independently using Decimal.js without cross-currency netting.
 * - Examines active sessions, delivered vs requested amounts, overpayments, and debts.
 */
export async function getCustomerFinancialStatus(
  customerId: string,
  tx: any = prisma
): Promise<CustomerFinancialStatus | null> {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    include: {
      sessions: {
        where: { status: { not: 'cancelled' } },
        orderBy: { businessDate: 'desc' },
      },
    },
  });

  if (!customer) return null;

  // 1. Query active Debts for this customer
  const debts = await tx.debt.findMany({
    where: {
      status: { in: ['outstanding', 'partially_paid', 'overdue'] },
      OR: [
        { debtorType: 'customer', debtorId: customer.id },
        { creditorType: 'customer', creditorId: customer.id },
        { debtorType: 'customer', debtorId: customer.name },
        { creditorType: 'customer', creditorId: customer.name },
      ],
    },
  });

  // Isolated Decimal Accumulators
  let egpDebtorD = new Decimal(0);   // Debts where customer owes EGP
  let egpCreditorD = new Decimal(0); // Dues where customer is owed EGP
  let sdgDebtorD = new Decimal(0);   // Debts where customer owes SDG
  let sdgCreditorD = new Decimal(0); // Dues where customer is owed SDG

  // A. Process Debts
  for (const d of debts) {
    const cur = (d.currency || '').toUpperCase();
    const remD = new Decimal(d.remainingAmount.toString());

    const isDebtor = d.debtorType === 'customer' && (d.debtorId === customer.id || d.debtorId === customer.name);
    const isCreditor = d.creditorType === 'customer' && (d.creditorId === customer.id || d.creditorId === customer.name);

    if (isDebtor) {
      if (cur === 'EGP') egpDebtorD = egpDebtorD.plus(remD);
      else if (cur === 'SDG') sdgDebtorD = sdgDebtorD.plus(remD);
    }

    if (isCreditor) {
      if (cur === 'EGP') egpCreditorD = egpCreditorD.plus(remD);
      else if (cur === 'SDG') sdgCreditorD = sdgCreditorD.plus(remD);
    }
  }

  // B. Process Customer Sessions (Exchange operations)
  const pendingSessions: CustomerPendingOperations['sessions'] = [];

  for (const s of customer.sessions) {
    const isCompleted = s.status === 'completed';
    const isCancelled = s.status === 'cancelled';

    const reqEgpD = new Decimal(s.requestedAmount?.toString() || 0);
    const delEgpD = new Decimal(s.deliveredAmount?.toString() || 0);
    const recSdgD = new Decimal(s.receivedAmount?.toString() || 0);
    const expSdgD = new Decimal(s.expectedAmount?.toString() || 0);
    const overpaymentD = new Decimal(s.overpaymentAmount?.toString() || 0);

    // If session has undelivered EGP that was paid/covered: customer is creditor for this EGP
    const undeliveredEgpD = Decimal.max(0, reqEgpD.minus(delEgpD));

    // Overpayment in SDG not settled: customer is creditor in SDG
    if (overpaymentD.greaterThan(0) && !s.overpaymentSettled) {
      sdgCreditorD = sdgCreditorD.plus(overpaymentD);
    }

    if (!isCompleted && !isCancelled) {
      // Pending delivery of EGP (Target currency obligation to customer)
      if (undeliveredEgpD.greaterThan(0)) {
        egpCreditorD = egpCreditorD.plus(undeliveredEgpD);
      }

      // Note: Approved receipts in SDG that cover requested EGP are NOT counted in SDG
      // to eliminate duplicate counting of the exchanged amount across both currencies.
      // Only unsettled overpayments (overpaymentAmount) represent an SDG obligation.

      pendingSessions.push({
        id: s.id,
        sessionNumber: s.sessionNumber,
        status: s.status,
        businessDate: s.businessDate,
        expectedSdg: expSdgD.toNumber(),
        receivedSdg: recSdgD.toNumber(),
        requestedEgp: reqEgpD.toNumber(),
        deliveredEgp: delEgpD.toNumber(),
        remainingDeliverableEgp: undeliveredEgpD.toNumber(),
      });
    }
  }

  // Blocking Reasons compilation
  const blockingReasons: string[] = [];

  if (egpDebtorD.greaterThan(0)) {
    blockingReasons.push(`يوجد رصيد مدين مستحق على العميل بالجنيه المصري قدره: ${egpDebtorD.toFixed(2)} EGP`);
  }
  if (egpCreditorD.greaterThan(0)) {
    blockingReasons.push(`يوجد رصيد دائن مستحق للعميل بذمة الصندوق بالجنيه المصري قدره: ${egpCreditorD.toFixed(2)} EGP`);
  }
  if (sdgDebtorD.greaterThan(0)) {
    blockingReasons.push(`يوجد رصيد مدين مستحق على العميل بالجنيه السوداني قدره: ${sdgDebtorD.toFixed(2)} SDG`);
  }
  if (sdgCreditorD.greaterThan(0)) {
    blockingReasons.push(`يوجد رصيد دائن مستحق للعميل بالجنيه السوداني قدره: ${sdgCreditorD.toFixed(2)} SDG`);
  }
  if (pendingSessions.length > 0) {
    blockingReasons.push(`توجد عدد ${pendingSessions.length} عملية / جلسة حسابية معلقة غير مكتملة.`);
  }

  const canClose = blockingReasons.length === 0;

  return {
    customerId: customer.id,
    customerName: customer.name,
    customerCode: customer.customerCode,
    status: customer.status,
    balances: {
      EGP: {
        debtor: egpDebtorD.toNumber(),
        creditor: egpCreditorD.toNumber(),
        net: egpDebtorD.minus(egpCreditorD).toNumber(),
      },
      SDG: {
        debtor: sdgDebtorD.toNumber(),
        creditor: sdgCreditorD.toNumber(),
        net: sdgDebtorD.minus(sdgCreditorD).toNumber(),
      },
    },
    pendingOperations: {
      count: pendingSessions.length,
      sessions: pendingSessions,
    },
    canClose,
    blockingReasons,
  };
}
