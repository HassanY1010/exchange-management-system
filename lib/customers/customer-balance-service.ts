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
    receiptBackedEgp: number;
    deliveredEgp: number;
    remainingDeliverableEgp: number;
  }[];
}

export interface CustomerFinancialBreakdown {
  expectedEgp: number;       // إجمالي المقابل المتوقع للعمليات
  receiptBackedEgp: number;  // المقابل المدعوم بإيصالات معتمدة فعلياً
  earnedPayableEgp: number;  // المستحق فعلياً للعميل (المدعوم - المصروف)
  deliveredEgp: number;      // إجمالي المبالغ المصروفة
  remainingExpectedEgp: number; // المتبقي من إجمالي العمليات المتوقعة
}

export interface CustomerFinancialStatus {
  customerId: string;
  customerName: string;
  customerCode: string;
  status: string; // active, closed, blocked
  balances: CustomerCurrencyBalances;
  breakdown: CustomerFinancialBreakdown;
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

  // B. Process Customer Sessions (Exchange operations - Receipt-backed EGP entitlement)
  const pendingSessions: CustomerPendingOperations['sessions'] = [];
  let totalExpectedEgpD = new Decimal(0);
  let totalReceiptBackedEgpD = new Decimal(0);
  let totalDeliveredEgpD = new Decimal(0);

  for (const s of customer.sessions) {
    const isCompleted = s.status === 'completed';
    const isCancelled = s.status === 'cancelled';

    const reqEgpD = new Decimal(s.requestedAmount?.toString() || 0);
    const delEgpD = new Decimal(s.deliveredAmount?.toString() || 0);
    const recSdgD = new Decimal(s.receivedAmount?.toString() || 0);
    const expSdgD = new Decimal(s.expectedAmount?.toString() || 0);
    const rateD = new Decimal(s.exchangeRate?.toString() || 1);
    const overpaymentD = new Decimal(s.overpaymentAmount?.toString() || 0);

    // Receipt-backed EGP: only approved SDG receipts create real EGP entitlement
    let receiptBackedEgpD = new Decimal(0);
    if (expSdgD.greaterThan(0) && recSdgD.greaterThanOrEqualTo(expSdgD.minus(0.0001))) {
      receiptBackedEgpD = reqEgpD;
    } else if (recSdgD.greaterThan(0) && rateD.greaterThan(0)) {
      receiptBackedEgpD = recSdgD.dividedBy(rateD).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    }

    if (!isCancelled) {
      totalExpectedEgpD = totalExpectedEgpD.plus(reqEgpD);
      totalReceiptBackedEgpD = totalReceiptBackedEgpD.plus(receiptBackedEgpD);
      totalDeliveredEgpD = totalDeliveredEgpD.plus(delEgpD);
    }

    const undeliveredEgpD = Decimal.max(0, receiptBackedEgpD.minus(delEgpD));

    // Overpayment in SDG not settled: customer is creditor in SDG
    if (overpaymentD.greaterThan(0) && !s.overpaymentSettled) {
      sdgCreditorD = sdgCreditorD.plus(overpaymentD);
    }

    if (!isCompleted && !isCancelled) {
      const netSessionEgpD = receiptBackedEgpD.minus(delEgpD);
      if (netSessionEgpD.greaterThan(0.0001)) {
        egpCreditorD = egpCreditorD.plus(netSessionEgpD);
      } else if (netSessionEgpD.lessThan(-0.0001)) {
        // Exceptional advance payout before receipts arrived -> customer owes EGP
        egpDebtorD = egpDebtorD.plus(netSessionEgpD.abs());
      }

      pendingSessions.push({
        id: s.id,
        sessionNumber: s.sessionNumber,
        status: s.status,
        businessDate: s.businessDate,
        expectedSdg: expSdgD.toNumber(),
        receivedSdg: recSdgD.toNumber(),
        requestedEgp: reqEgpD.toNumber(),
        receiptBackedEgp: receiptBackedEgpD.toNumber(),
        deliveredEgp: delEgpD.toNumber(),
        remainingDeliverableEgp: undeliveredEgpD.toNumber(),
      });
    }
  }

  const earnedPayableEgpD = Decimal.max(0, totalReceiptBackedEgpD.minus(totalDeliveredEgpD));
  const remainingExpectedEgpD = Decimal.max(0, totalExpectedEgpD.minus(totalDeliveredEgpD));

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
    breakdown: {
      expectedEgp: totalExpectedEgpD.toNumber(),
      receiptBackedEgp: totalReceiptBackedEgpD.toNumber(),
      earnedPayableEgp: earnedPayableEgpD.toNumber(),
      deliveredEgp: totalDeliveredEgpD.toNumber(),
      remainingExpectedEgp: remainingExpectedEgpD.toNumber(),
    },
    pendingOperations: {
      count: pendingSessions.length,
      sessions: pendingSessions,
    },
    canClose,
    blockingReasons,
  };
}
