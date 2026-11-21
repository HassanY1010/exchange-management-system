import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

/**
 * Calculates start of day in the configured timezone (e.g. Africa/Cairo)
 */
function getStartOfDayForTimezone(tz: string = 'Africa/Cairo'): { todayStr: string; startOfDay: Date } {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = formatter.format(new Date());

    const now = new Date();
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const diffMinutes = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);

    const [year, month, day] = todayStr.split('-').map(Number);
    const midnightUtcTimestamp = Date.UTC(year, month - 1, day, 0, 0, 0) - diffMinutes * 60 * 1000;
    const startOfDay = new Date(midnightUtcTimestamp);

    return { todayStr, startOfDay };
  } catch (e) {
    const todayStr = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    return { todayStr, startOfDay };
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Resolve configured timezone
  const tzSetting = await prisma.setting.findUnique({ where: { key: 'timezone' } }).catch(() => null);
  const timeZone = tzSetting?.value || 'Africa/Cairo';
  const { todayStr, startOfDay } = getStartOfDayForTimezone(timeZone);

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

  // Accounting Equity (Invested Capital)
  const capitalBalance = accounts
    .filter((a) => a.accountType === 'capital')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  // 2. Today's sessions & counts (strictly excluding cancelled sessions)
  const todaySessions = await prisma.customerSession.findMany({
    where: {
      businessDate: todayStr,
      status: { not: 'cancelled' },
    },
    include: { customer: true },
  });

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

  // 4. Expenses today
  const expensesToday = await prisma.expense.findMany({
    where: { expenseDate: todayStr },
  });
  const totalExpensesToday = expensesToday.reduce((sum, e) => sum + Number(e.amount), 0);

  // 5. Debts
  const debts = await prisma.debt.findMany({
    where: { status: { in: ['outstanding', 'partially_paid', 'overdue'] } },
  });
  const totalCustomerDebts = debts
    .filter((d) => d.debtorType === 'customer')
    .reduce((sum, d) => sum + Number(d.remainingAmount), 0);
  const totalSupplierDebts = debts
    .filter((d) => d.debtorType === 'supplier')
    .reduce((sum, d) => sum + Number(d.remainingAmount), 0);

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

  // Role-based permissions matrix for Dashboard UI
  const permissions = {
    canDeliver: ['admin', 'custody_officer'].includes(user.role),
    canCloseDay: ['admin', 'accountant'].includes(user.role),
    canManageSuppliers: ['admin', 'accountant'].includes(user.role),
    canUploadReceipts: ['admin', 'data_entry', 'accountant'].includes(user.role),
    canOpenSession: ['admin', 'data_entry', 'accountant'].includes(user.role),
    canAuditBankak: ['admin', 'bankak_auditor', 'accountant'].includes(user.role),
    canViewLedger,
  };

  return NextResponse.json({
    success: true,
    data: {
      userRole: user.role,
      userName: user.name,
      permissions,
      businessDate: todayStr,
      timeZone,
      kpi: {
        totalEgp,
        totalSdg,
        mainEgpSafe,
        mainSdgSafe,
        bankakBalance,
        bankBalance,
        custodyBalance,
        capitalBalance,
        totalExpensesToday,
        totalCustomerDebts,
        totalSupplierDebts,
        totalCustomersToday,
        totalReceivedSdgToday,
        totalDeliveredEgpToday,
        totalReceiptsCount,
        pendingReceiptsCount,
        pendingVerificationCount,
        verifiedAwaitingApprovalCount,
        duplicateReceiptsCount,
        suspiciousReceiptsCount,
        approvedReceiptsCount,
        rejectedReceiptsCount,
      },
      recentLedger,
      alerts,
    },
  });
}
