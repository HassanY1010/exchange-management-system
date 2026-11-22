import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { reconcileDailyClosing, ClosingAccountItem } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const rawClosings = await prisma.dailyClosing.findMany({
    orderBy: { businessDate: 'desc' },
  });

  const closings = rawClosings.map((c) => {
    let parsedDifferences: any = null;
    let parsedExpected: any = null;
    let parsedActual: any = null;
    let parsedOpening: any = null;

    try {
      parsedDifferences = JSON.parse(c.differences);
    } catch {}
    try {
      parsedExpected = JSON.parse(c.expectedBalances);
    } catch {}
    try {
      parsedActual = JSON.parse(c.actualBalances);
    } catch {}
    try {
      parsedOpening = JSON.parse(c.openingBalances);
    } catch {}

    return {
      ...c,
      parsedDifferences,
      parsedExpected,
      parsedActual,
      parsedOpening,
    };
  });

  return NextResponse.json({ success: true, data: closings });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية إغلاق اليوم المالي وتجميده مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { businessDate, countedBalances, notes } = body;
    const dateStr = businessDate || new Date().toISOString().split('T')[0];

    // Atomic execution within a single Prisma Transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Concurrency Check: Check if already closed
      const existing = await tx.dailyClosing.findUnique({
        where: { businessDate: dateStr },
      });

      if (existing && existing.status === 'closed') {
        throw new Error(`اليوم المالي ${dateStr} مغلق مسبقاً. يجب إعادة فتحه بصلاحية خاصة من قبل المدير لإجراء أي تعديل.`);
      }

      // 2. Pre-flight Check: Block closing if there are open or unsettled customer sessions
      const openSessions = await tx.customerSession.findMany({
        where: {
          businessDate: dateStr,
          status: { in: ['open', 'has_balance'] },
        },
        select: { sessionNumber: true },
      });

      if (openSessions.length > 0) {
        const sessionList = openSessions.slice(0, 5).map((s) => s.sessionNumber).join(', ');
        throw new Error(
          `لا يمكن إغلاق اليوم لوجود عدد (${openSessions.length}) جلسة عملاء مفتوحة أو غير مسواة (${sessionList}). يجب تسويتها أولاً.`
        );
      }

      // 3. Pre-flight Check: Block closing if there are unbalanced ledger entries
      const dayEntries = await tx.ledgerEntry.findMany({
        where: { entryDate: dateStr },
        include: { lines: true },
      });

      const unbalancedList: string[] = [];
      for (const ent of dayEntries) {
        let deb = new Decimal(0);
        let cred = new Decimal(0);
        for (const line of ent.lines) {
          deb = deb.plus(line.debit?.toString() || 0);
          cred = cred.plus(line.credit?.toString() || 0);
        }
        if (!deb.equals(cred)) {
          unbalancedList.push(ent.entryNumber);
        }
      }

      if (unbalancedList.length > 0) {
        throw new Error(
          `لا يمكن إغلاق اليوم لوجود عدد (${unbalancedList.length}) قيد محاسبي غير متوازن في دفتر الأستاذ (${unbalancedList.join(', ')}).`
        );
      }

      // 4. Fetch Cash / Liquid Accounts ONLY
      const ALLOWED_CASH_TYPES = ['cash_safe', 'bank', 'bankak', 'employee_custody'];
      const cashAccounts = await tx.account.findMany({
        where: {
          accountType: { in: ALLOWED_CASH_TYPES },
          status: 'active',
        },
        orderBy: [{ currency: 'asc' }, { accountCode: 'asc' }],
      });

      const accountIds = cashAccounts.map((a) => a.id);
      const dayLedgerLines = await tx.ledgerLine.findMany({
        where: {
          accountId: { in: accountIds },
          ledgerEntry: {
            entryDate: dateStr,
            status: 'posted',
          },
        },
        select: {
          accountId: true,
          debit: true,
          credit: true,
        },
      });

      const inflowMap = new Map<string, Decimal>();
      const outflowMap = new Map<string, Decimal>();

      for (const line of dayLedgerLines) {
        const dDeb = new Decimal(line.debit?.toString() || 0);
        const dCred = new Decimal(line.credit?.toString() || 0);

        inflowMap.set(line.accountId, (inflowMap.get(line.accountId) || new Decimal(0)).plus(dDeb));
        outflowMap.set(line.accountId, (outflowMap.get(line.accountId) || new Decimal(0)).plus(dCred));
      }

      // Build real ClosingAccountItems
      const items: ClosingAccountItem[] = cashAccounts.map((acc) => {
        const dCur = new Decimal(acc.currentBalance?.toString() || 0);
        const dInflow = inflowMap.get(acc.id) || new Decimal(0);
        const dOutflow = outflowMap.get(acc.id) || new Decimal(0);
        const dOpening = dCur.minus(dInflow).plus(dOutflow);

        const actualInput = countedBalances ? countedBalances[acc.id] : undefined;
        const dActual =
          actualInput !== undefined && actualInput !== null && actualInput !== ''
            ? new Decimal(actualInput)
            : dCur;

        return {
          accountId: acc.id,
          accountName: acc.name,
          accountCode: acc.accountCode,
          accountType: acc.accountType,
          currency: acc.currency.toUpperCase(),
          openingBalance: dOpening.toDecimalPlaces(4).toNumber(),
          totalInflow: dInflow.toDecimalPlaces(4).toNumber(),
          totalOutflow: dOutflow.toDecimalPlaces(4).toNumber(),
          expectedBalance: dCur.toDecimalPlaces(4).toNumber(),
          actualCountedBalance: dActual.toDecimalPlaces(4).toNumber(),
        };
      });

      const reconciliation = reconcileDailyClosing(dateStr, items);

      // Preserve previous closing snapshot and reopen reasons if re-closing a reopened day
      let historicalNotes = notes || '';
      if (existing?.notes) {
        historicalNotes = historicalNotes ? `${existing.notes} | ${historicalNotes}` : existing.notes;
      }
      if (existing?.closedAt) {
        const prevSnapshotNote = `[إغلاق سابق محفوظ بتاريخ ${existing.closedAt.toISOString()}]`;
        historicalNotes = `${historicalNotes} | ${prevSnapshotNote}`;
      }

      // 5. Save Immutable Closing Snapshot in DailyClosing
      const closing = await tx.dailyClosing.upsert({
        where: { businessDate: dateStr },
        update: {
          status: 'closed',
          openingBalances: JSON.stringify(
            reconciliation.accounts.map((a) => ({
              id: a.accountId,
              code: a.accountCode,
              name: a.accountName,
              currency: a.currency,
              opening: a.openingBalance,
              inflow: a.totalInflow,
              outflow: a.totalOutflow,
            }))
          ),
          expectedBalances: JSON.stringify(
            reconciliation.accounts.map((a) => ({
              id: a.accountId,
              code: a.accountCode,
              name: a.accountName,
              currency: a.currency,
              expected: a.expectedBalance,
            }))
          ),
          actualBalances: JSON.stringify(countedBalances || {}),
          differences: JSON.stringify({
            diffEgp: reconciliation.totalDiffEgp,
            diffSdg: reconciliation.totalDiffSdg,
            hasVariances: reconciliation.hasVariances,
            byCurrency: reconciliation.byCurrency,
            items: reconciliation.accounts,
          }),
          notes: historicalNotes,
          closedBy: user.name || user.email || user.userId,
          closedAt: new Date(),
        },
        create: {
          businessDate: dateStr,
          status: 'closed',
          openingBalances: JSON.stringify(
            reconciliation.accounts.map((a) => ({
              id: a.accountId,
              code: a.accountCode,
              name: a.accountName,
              currency: a.currency,
              opening: a.openingBalance,
              inflow: a.totalInflow,
              outflow: a.totalOutflow,
            }))
          ),
          expectedBalances: JSON.stringify(
            reconciliation.accounts.map((a) => ({
              id: a.accountId,
              code: a.accountCode,
              name: a.accountName,
              currency: a.currency,
              expected: a.expectedBalance,
            }))
          ),
          actualBalances: JSON.stringify(countedBalances || {}),
          differences: JSON.stringify({
            diffEgp: reconciliation.totalDiffEgp,
            diffSdg: reconciliation.totalDiffSdg,
            hasVariances: reconciliation.hasVariances,
            byCurrency: reconciliation.byCurrency,
            items: reconciliation.accounts,
          }),
          notes: historicalNotes,
          closedBy: user.name || user.email || user.userId,
          closedAt: new Date(),
        },
      });

      // 6. Stamp completed customer sessions for this day
      await tx.customerSession.updateMany({
        where: {
          businessDate: dateStr,
          status: 'completed',
        },
        data: {
          closedBy: user.name || user.email || user.userId,
          closedAt: new Date(),
        },
      });

      // 7. Record Audit Log inside transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'DAILY_CLOSING',
        entityType: 'DailyClosing',
        entityId: closing.id,
        newValues: {
          businessDate: dateStr,
          hasVariances: reconciliation.hasVariances,
          byCurrency: reconciliation.byCurrency,
          closedBy: user.name || user.email,
        },
        reason: `إغلاق وتجميد اليوم المالي ${dateStr} ${
          reconciliation.hasVariances ? '(مع وجود فروقات جرد موثقة)' : '(مطابق تماماً 100%)'
        }`,
        tx,
      });

      return { closing, reconciliation };
    });

    return NextResponse.json(
      {
        success: true,
        message: 'تم إغلاق وتجميد اليوم المالي وتثبيت تقرير المطابقة بنجاح',
        data: result,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء إغلاق اليوم المالي' }, { status: 400 });
  }
}
