import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { reconcileDailyClosing, ClosingAccountItem } from '@/lib/financial-core';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { businessDate, countedBalances } = await req.json();
    const dateStr = businessDate || new Date().toISOString().split('T')[0];

    const accounts = await prisma.account.findMany();
    const items: ClosingAccountItem[] = accounts.map((acc) => {
      const curBal = Number(acc.currentBalance);
      const openBal = Number(acc.openingBalance);
      const actualInput = countedBalances ? countedBalances[acc.id] : undefined;
      const actualCounted = actualInput !== undefined ? Number(actualInput) : curBal;

      return {
        accountId: acc.id,
        accountName: acc.name,
        currency: acc.currency,
        openingBalance: openBal,
        totalInflow: curBal > openBal ? curBal - openBal : 0,
        totalOutflow: openBal > curBal ? openBal - curBal : 0,
        expectedBalance: curBal,
        actualCountedBalance: actualCounted,
      };
    });

    const preview = reconcileDailyClosing(dateStr, items);

    // Also get daily stats for customer sessions, receipts, custody
    const sessions = await prisma.customerSession.findMany({
      where: { businessDate: dateStr },
    });
    const receipts = await prisma.bankakReceipt.findMany({
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        reconciliation: preview,
        stats: {
          totalSessions: sessions.length,
          completedSessions: sessions.filter((s) => s.status === 'completed').length,
          totalReceipts: receipts.length,
          approvedReceipts: receipts.filter((r) => r.status === 'approved').length,
          duplicateReceipts: receipts.filter((r) => r.status === 'duplicate').length,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في معاينة الإغلاق' }, { status: 500 });
  }
}
