import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { reconcileDailyClosing, ClosingAccountItem } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const closings = await prisma.dailyClosing.findMany({
    orderBy: { businessDate: 'desc' },
  });

  return NextResponse.json({ success: true, data: closings });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية إغلاق اليوم المالي وتجميده مقتصرة على المحاسب أو مدير النظام فقط' }, { status: 403 });
  }

  try {
    const { businessDate, countedBalances, notes } = await req.json();

    const dateStr = businessDate || new Date().toISOString().split('T')[0];

    // Check if already closed
    const existing = await prisma.dailyClosing.findUnique({
      where: { businessDate: dateStr },
    });

    if (existing && existing.status === 'closed') {
      return NextResponse.json({
        error: `اليوم المالي ${dateStr} مغلق مسبقاً. يجب إعادة فتحه بصلاحية خاصة لإجراء تعديلات.`,
      }, { status: 400 });
    }

    // Fetch accounts
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

    const reconciliation = reconcileDailyClosing(dateStr, items);

    const closing = await prisma.dailyClosing.upsert({
      where: { businessDate: dateStr },
      update: {
        status: 'closed',
        openingBalances: JSON.stringify(accounts.map((a) => ({ id: a.id, code: a.accountCode, balance: a.openingBalance }))),
        expectedBalances: JSON.stringify(accounts.map((a) => ({ id: a.id, code: a.accountCode, balance: a.currentBalance }))),
        actualBalances: JSON.stringify(countedBalances || {}),
        differences: JSON.stringify({
          diffEgp: reconciliation.totalDiffEgp,
          diffSdg: reconciliation.totalDiffSdg,
          hasVariances: reconciliation.hasVariances,
          items: reconciliation.accounts,
        }),
        notes,
        closedBy: user.name,
        closedAt: new Date(),
      },
      create: {
        businessDate: dateStr,
        status: 'closed',
        openingBalances: JSON.stringify(accounts.map((a) => ({ id: a.id, code: a.accountCode, balance: a.openingBalance }))),
        expectedBalances: JSON.stringify(accounts.map((a) => ({ id: a.id, code: a.accountCode, balance: a.currentBalance }))),
        actualBalances: JSON.stringify(countedBalances || {}),
        differences: JSON.stringify({
          diffEgp: reconciliation.totalDiffEgp,
          diffSdg: reconciliation.totalDiffSdg,
          hasVariances: reconciliation.hasVariances,
          items: reconciliation.accounts,
        }),
        notes,
        closedBy: user.name,
        closedAt: new Date(),
      },
    });

    // Close all completed customer sessions for this day
    await prisma.customerSession.updateMany({
      where: {
        businessDate: dateStr,
        status: { in: ['completed', 'has_balance', 'open'] },
      },
      data: {
        closedBy: user.name,
        closedAt: new Date(),
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'DAILY_CLOSING',
      entityType: 'DailyClosing',
      entityId: closing.id,
      newValues: reconciliation,
      reason: `إغلاق اليوم المالي ${dateStr} ${reconciliation.hasVariances ? '(يوجد فروقات)' : '(مطابق)'}`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم إغلاق اليوم المالي وحفظ تقرير المطابقة بنجاح',
      data: {
        closing,
        reconciliation,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إغلاق اليوم' }, { status: 500 });
  }
}
