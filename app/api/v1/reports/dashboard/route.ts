import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const today = new Date().toISOString().split('T')[0];

  // 1. Fetch Accounts
  const accounts = await prisma.account.findMany();

  const totalEgp = accounts
    .filter((a) => a.currency === 'EGP')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const totalSdg = accounts
    .filter((a) => a.currency === 'SDG')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const mainEgpSafe = Number(accounts.find((a) => a.accountCode === '1010')?.currentBalance || 0);
  const mainSdgSafe = Number(accounts.find((a) => a.accountCode === '1020')?.currentBalance || 0);
  const bankakBalance = Number(accounts.find((a) => a.accountCode === '1030')?.currentBalance || 0);
  const bankBalance = Number(accounts.find((a) => a.accountCode === '1040')?.currentBalance || 0);
  const custodyBalance = accounts
    .filter((a) => a.accountType === 'employee_custody')
    .reduce((sum, a) => sum + Number(a.currentBalance), 0);

  const capitalBalance = Number(accounts.find((a) => a.accountType === 'capital')?.currentBalance || 0);

  // 2. Today's sessions & counts
  const todaySessions = await prisma.customerSession.findMany({
    where: { businessDate: today },
    include: { customer: true },
  });

  const totalCustomersToday = new Set(todaySessions.map((s) => s.customerId)).size;
  const totalReceivedSdgToday = todaySessions.reduce((sum, s) => sum + Number(s.receivedAmount), 0);
  const totalDeliveredEgpToday = todaySessions.reduce((sum, s) => sum + Number(s.deliveredAmount), 0);

  // 3. Receipts counts
  const receipts = await prisma.bankakReceipt.findMany({
    where: {
      createdAt: {
        gte: new Date(new Date().setHours(0, 0, 0, 0)),
      },
    },
  });

  const totalReceiptsCount = receipts.length;
  const pendingReceiptsCount = receipts.filter((r) => r.status === 'pending_review' || r.status === 'uploaded').length;
  const duplicateReceiptsCount = receipts.filter((r) => r.status === 'duplicate').length;
  const approvedReceiptsCount = receipts.filter((r) => r.status === 'approved').length;

  // 4. Expenses today
  const expensesToday = await prisma.expense.findMany({
    where: { expenseDate: today },
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

  // 6. Recent Ledger Entries
  const recentLedger = await prisma.ledgerEntry.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      lines: {
        include: { account: true },
      },
    },
  });

  // 7. System Alerts (Section 5.4)
  const alerts = [];
  if (duplicateReceiptsCount > 0) {
    alerts.push({
      type: 'warning',
      title: 'إيصالات بنكك مكررة',
      message: `تم رصد ${duplicateReceiptsCount} إيصال مكرر بانتظار التحقق أو الإلغاء`,
    });
  }
  if (pendingReceiptsCount > 0) {
    alerts.push({
      type: 'info',
      title: 'إيصالات بانتظار المراجعة',
      message: `يوجد ${pendingReceiptsCount} إيصال جديد مستلم جاهز للمراجعة والاعتماد`,
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

  return NextResponse.json({
    success: true,
    data: {
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
        duplicateReceiptsCount,
        approvedReceiptsCount,
      },
      recentLedger,
      alerts,
    },
  });
}
