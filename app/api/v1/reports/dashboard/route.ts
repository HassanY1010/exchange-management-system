import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { getSystemBusinessDate, getSystemStartOfDay } from '@/lib/financial-core';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Resolve configured timezone (defaults to Africa/Cairo for Egypt UTC+2 / UTC+3)
  const tzSetting = await prisma.setting.findUnique({ where: { key: 'timezone' } }).catch(() => null);
  const timeZone = tzSetting?.value || 'Africa/Cairo';
  const todayStr = getSystemBusinessDate(new Date(), timeZone);
  const startOfDay = getSystemStartOfDay(todayStr, timeZone);

  // 1. Fetch Accounts
  const accounts = await prisma.account.findMany({
    where: { status: 'active' },
  });

  // Accurate monetary liquid assets (Cash in safes, banks, and custodies - excluding clearing 1060/1065)
  const totalEgp = accounts
    .filter(
      (a) =>
        ['cash_safe', 'bank', 'employee_custody'].includes(a.accountType) &&
        a.currency === 'EGP' &&
        a.accountCode !== '1060'
    )
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const totalSdg = accounts
    .filter(
      (a) =>
        ['cash_safe', 'bankak', 'bank', 'employee_custody'].includes(a.accountType) &&
        a.currency === 'SDG' &&
        a.accountCode !== '1065'
    )
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const mainEgpSafe = Number(accounts.find((a) => a.accountCode === '1010')?.currentBalance || 0);
  const mainSdgSafe = Number(accounts.find((a) => a.accountCode === '1020')?.currentBalance || 0);
  const bankakBalance = Number(accounts.find((a) => a.accountCode === '1030')?.currentBalance || 0);
  const bankBalance = Number(accounts.find((a) => a.accountCode === '1040')?.currentBalance || 0);

  // Employee Custodies strictly in EGP
  const custodyBalance = accounts
    .filter((a) => a.accountType === 'employee_custody' && a.currency === 'EGP')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  // Accounting Equity (Invested Capital per Currency strictly isolated)
  const capitalBalance = accounts
    .filter((a) => a.accountType === 'capital' && a.currency === 'EGP')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const capitalByCurrency: Record<string, number> = {};
  accounts
    .filter((a) => a.accountType === 'capital')
    .forEach((a) => {
      capitalByCurrency[a.currency] = (capitalByCurrency[a.currency] || 0) + Number(a.currentBalance);
    });

  // 2. Today's sessions & counts (strictly excluding cancelled sessions)
  let todaySessions: any[] = [];
  try {
    todaySessions = await prisma.customerSession.findMany({
      where: {
        businessDate: todayStr,
        status: { not: 'cancelled' },
      },
      include: { customer: true },
    });
  } catch (err: any) {
    console.warn('Fallback fetching today sessions:', err.message);
    todaySessions = [];
  }

  const totalCustomersToday = new Set(todaySessions.map((s) => s.customerId)).size;
  const totalReceivedSdgToday = todaySessions.reduce((sum, s) => sum + Number(s.receivedAmount), 0);
  const totalDeliveredEgpToday = todaySessions.reduce((sum, s) => sum + Number(s.deliveredAmount), 0);

  // 3. Receipts counts (registered today in timezone)
  const receiptsToday = await prisma.bankakReceipt.findMany({
    where: {
      OR: [
        { createdAt: { gte: startOfDay } },
        { transactionDate: todayStr },
      ],
    },
  });

  const totalReceiptsCount = receiptsToday.length;

  // Complete lifecycle categorisation
  const pendingVerificationCount = receiptsToday.filter((r) =>
    ['uploaded', 'processing', 'ocr_completed', 'pending_review', 'pending_verification'].includes(r.status)
  ).length;
  const verifiedAwaitingApprovalCount = receiptsToday.filter((r) => r.status === 'verified').length;
  const pendingReceiptsCount = pendingVerificationCount + verifiedAwaitingApprovalCount;

  const approvedReceiptsCount = receiptsToday.filter((r) => r.status === 'approved').length;
  const duplicateReceiptsCount = receiptsToday.filter((r) => r.status === 'duplicate' || r.duplicateOfId !== null).length;
  const suspiciousReceiptsCount = receiptsToday.filter((r) => r.isSuspicious === true || r.status === 'suspicious').length;
  const rejectedReceiptsCount = receiptsToday.filter((r) => r.status === 'rejected' || r.status === 'failed').length;

  // 4. Expenses today (strictly approved, isolated per currency)
  const expensesToday = await prisma.expense.findMany({
    where: { expenseDate: todayStr, status: 'approved' },
  });
  const totalExpensesToday = expensesToday
    .filter((e) => e.currency === 'EGP')
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const expensesTodayByCurrency: Record<string, number> = {};
  for (const exp of expensesToday) {
    expensesTodayByCurrency[exp.currency] = (expensesTodayByCurrency[exp.currency] || 0) + Number(exp.amount);
  }

  // 5. Debts and Customer Obligations (strictly active, isolated by currency)
  const debts = await prisma.debt.findMany({
    where: { status: { in: ['outstanding', 'partially_paid', 'overdue'] } },
  });

  // Calculate Active Sessions' customer commitments (Undelivered EGP & Overpayment SDG)
  const activeSessions = await prisma.customerSession.findMany({
    where: { status: { in: ['open', 'pending_receipts', 'pending_delivery', 'partially_delivered', 'has_balance', 'needs_review'] } },
    select: { requestedAmount: true, deliveredAmount: true, overpaymentAmount: true, overpaymentSettled: true },
  });

  let sessionUndeliveredEgp = new Decimal(0);
  let sessionOverpaymentSdg = new Decimal(0);

  for (const s of activeSessions) {
    const reqD = new Decimal(s.requestedAmount?.toString() || 0);
    const delD = new Decimal(s.deliveredAmount?.toString() || 0);
    sessionUndeliveredEgp = sessionUndeliveredEgp.plus(Decimal.max(0, reqD.minus(delD)));
    const overD = new Decimal(s.overpaymentAmount?.toString() || 0);
    if (overD.greaterThan(0) && !s.overpaymentSettled) {
      sessionOverpaymentSdg = sessionOverpaymentSdg.plus(overD);
    }
  }

  let customerDebtorsEgp = new Decimal(0);
  let customerDebtorsSdg = new Decimal(0);
  let customerCreditorsEgp = sessionUndeliveredEgp;
  let customerCreditorsSdg = sessionOverpaymentSdg;

  let totalCustomerDebts = 0;
  let totalSupplierDebts = 0;

  const debtsByCurrency: {
    customerReceivables: Record<string, number>;
    supplierPayables: Record<string, number>;
  } = { customerReceivables: {}, supplierPayables: {} };

  for (const d of debts) {
    const cur = d.currency;
    const remD = new Decimal(d.remainingAmount.toString());
    const rem = remD.toNumber();

    if (d.debtorType === 'customer') {
      debtsByCurrency.customerReceivables[cur] = (debtsByCurrency.customerReceivables[cur] || 0) + rem;
      if (cur === 'EGP') customerDebtorsEgp = customerDebtorsEgp.plus(remD);
      else if (cur === 'SDG') customerDebtorsSdg = customerDebtorsSdg.plus(remD);
    }

    if (d.creditorType === 'customer') {
      if (cur === 'EGP') customerCreditorsEgp = customerCreditorsEgp.plus(remD);
      else if (cur === 'SDG') customerCreditorsSdg = customerCreditorsSdg.plus(remD);
    }

    if (d.debtorType === 'supplier' || d.creditorType === 'supplier') {
      debtsByCurrency.supplierPayables[cur] = (debtsByCurrency.supplierPayables[cur] || 0) + rem;
      if (cur === 'EGP') totalSupplierDebts += rem;
    }
  }

  totalCustomerDebts = customerDebtorsEgp.toNumber();

  // 6. RBAC-Protected Recent Ledger Entries
  const canViewLedger = ['admin', 'accountant'].includes(user.role);
  let recentLedger: any[] = [];

  if (canViewLedger) {
    const rawLedger = await prisma.ledgerEntry.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        lines: {
          include: {
            account: {
              select: {
                id: true,
                accountCode: true,
                name: true,
                accountType: true,
                currency: true,
              },
            },
          },
        },
      },
    });

    recentLedger = rawLedger.map((entry) => ({
      id: entry.id,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      entryType: entry.entryType,
      description: entry.description,
      status: entry.status,
      createdBy: entry.createdBy,
      createdAt: entry.createdAt,
      lines: entry.lines.map((l) => ({
        id: l.id,
        accountId: l.accountId,
        accountCode: l.account?.accountCode || '',
        accountName: l.account?.name || '',
        currency: l.currency,
        debit: Number(l.debit),
        credit: Number(l.credit),
        description: l.description,
      })),
    }));
  }

  // 7. System Alerts
  const alerts = [];
  if (duplicateReceiptsCount > 0) {
    alerts.push({
      type: 'warning',
      title: 'إيصالات بنكك مكررة',
      message: `تم رصد ${duplicateReceiptsCount} إيصال مكرر بانتظار التحقق أو الإلغاء`,
    });
  }
  if (suspiciousReceiptsCount > 0) {
    alerts.push({
      type: 'danger',
      title: 'إيصالات مشبوهة تتطلب الفحص',
      message: `يوجد ${suspiciousReceiptsCount} إيصال تم تصنيفه كمشبوه لمطابقة بياناته البنكية فوراً`,
    });
  }
  if (verifiedAwaitingApprovalCount > 0) {
    alerts.push({
      type: 'info',
      title: 'إيصالات موثقة بانتظار الاعتماد المحاسبي',
      message: `يوجد ${verifiedAwaitingApprovalCount} إيصال تم التحقق منه وجاهز للاعتماد المالي`,
    });
  } else if (pendingVerificationCount > 0) {
    alerts.push({
      type: 'info',
      title: 'إيصالات بانتظار التحقق والمراجعة',
      message: `يوجد ${pendingVerificationCount} إيصال جديد مستلم جاهز للمراجعة والتدقيق`,
    });
  }
  const unclosedSessions = todaySessions.filter((s) => s.status !== 'completed');
  if (unclosedSessions.length > 0) {
    alerts.push({
      type: 'warning',
      title: 'حسابات يومية غير مكتملة',
      message: `يوجد ${unclosedSessions.length} جلسة عملاء مفتوحة اليوم لم تكتمل بعد`,
    });
  }

  // Role-based permissions matrix for Dashboard UI & Data Access
  const isFinanceRole = ['admin', 'accountant'].includes(user.role);
  const isCustodyOfficer = user.role === 'custody_officer';
  const isBankakAuditor = user.role === 'bankak_auditor';
  const isDataEntry = user.role === 'data_entry';

  const permissions = {
    canDeliver: ['admin', 'custody_officer'].includes(user.role),
    canCloseDay: isFinanceRole,
    canManageSuppliers: isFinanceRole,
    canUploadReceipts: ['admin', 'data_entry', 'accountant'].includes(user.role),
    canOpenSession: ['admin', 'data_entry', 'accountant'].includes(user.role),
    canAuditBankak: ['admin', 'bankak_auditor', 'accountant'].includes(user.role),
    canViewLedger,
    canViewCapital: isFinanceRole,
    canViewAllBalances: isFinanceRole,
  };

  // Build role-protected KPI payload (strict zero-leakage on API level)
  const roleKpi: any = {
    // Operations & receipts stats accessible according to operational role
    totalCustomersToday: isFinanceRole || isCustodyOfficer || isDataEntry ? totalCustomersToday : 0,
    totalReceiptsCount: isFinanceRole || isBankakAuditor || isDataEntry ? totalReceiptsCount : 0,
    pendingReceiptsCount: isFinanceRole || isBankakAuditor || isDataEntry ? pendingReceiptsCount : 0,
    pendingVerificationCount: isFinanceRole || isBankakAuditor ? pendingVerificationCount : 0,
    verifiedAwaitingApprovalCount: isFinanceRole || isBankakAuditor ? verifiedAwaitingApprovalCount : 0,
    duplicateReceiptsCount: isFinanceRole || isBankakAuditor || isDataEntry ? duplicateReceiptsCount : 0,
    suspiciousReceiptsCount: isFinanceRole || isBankakAuditor ? suspiciousReceiptsCount : 0,
    approvedReceiptsCount: isFinanceRole || isBankakAuditor || isDataEntry ? approvedReceiptsCount : 0,
    rejectedReceiptsCount: isFinanceRole || isBankakAuditor ? rejectedReceiptsCount : 0,
    totalReceivedSdgToday: isFinanceRole || isBankakAuditor ? totalReceivedSdgToday : 0,
    totalDeliveredEgpToday: isFinanceRole || isCustodyOfficer ? totalDeliveredEgpToday : 0,

    // Financial balances: Strictly restricted based on duty separation
    totalEgp: isFinanceRole ? totalEgp : isCustodyOfficer ? mainEgpSafe + custodyBalance : 0,
    totalSdg: isFinanceRole ? totalSdg : 0,
    mainEgpSafe: isFinanceRole || isCustodyOfficer ? mainEgpSafe : 0,
    mainSdgSafe: isFinanceRole ? mainSdgSafe : 0,
    bankakBalance: isFinanceRole || isBankakAuditor ? bankakBalance : 0,
    bankBalance: isFinanceRole ? bankBalance : 0,
    custodyBalance: isFinanceRole || isCustodyOfficer ? custodyBalance : 0,

    // Confidential Company Equity & Debts: Admin & Accountant ONLY
    capitalBalance: isFinanceRole ? capitalBalance : 0,
    capitalByCurrency: isFinanceRole ? capitalByCurrency : {},
    totalExpensesToday: isFinanceRole ? totalExpensesToday : 0,
    expensesTodayByCurrency: isFinanceRole ? expensesTodayByCurrency : {},
    totalCustomerDebts: isFinanceRole ? totalCustomerDebts : 0,
    totalSupplierDebts: isFinanceRole ? totalSupplierDebts : 0,
    debtsByCurrency: isFinanceRole ? debtsByCurrency : { customerReceivables: {}, supplierPayables: {} },
    customerBalances: isFinanceRole
      ? {
          debtors: {
            EGP: customerDebtorsEgp.toNumber(),
            SDG: customerDebtorsSdg.toNumber(),
          },
          creditors: {
            EGP: customerCreditorsEgp.toNumber(),
            SDG: customerCreditorsSdg.toNumber(),
          },
        }
      : {
          debtors: { EGP: 0, SDG: 0 },
          creditors: { EGP: 0, SDG: 0 },
        },
  };

  return NextResponse.json({
    success: true,
    data: {
      userRole: user.role,
      userName: user.name,
      permissions,
      businessDate: todayStr,
      timeZone,
      kpi: roleKpi,
      recentLedger,
      alerts,
    },
  });
}
