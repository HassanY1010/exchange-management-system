import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { reconcileDailyClosing, ClosingAccountItem, getSystemBusinessDate } from '@/lib/financial-core';
import Decimal from 'decimal.js';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const body = await req.json().catch(() => ({}));
    const { businessDate, countedBalances } = body;
    const dateStr = getSystemBusinessDate(businessDate);

    // 1. Check if the business day is already closed
    const existingClosing = await prisma.dailyClosing.findUnique({
      where: { businessDate: dateStr },
    });
    const isClosed = existingClosing?.status === 'closed';

    // 2. Query Cash and Liquid Asset Accounts ONLY (Physical Cash / Bank / Custody)
    const ALLOWED_CASH_TYPES = ['cash_safe', 'bank', 'bankak', 'employee_custody'];
    const cashAccounts = await prisma.account.findMany({
      where: {
        accountType: { in: ALLOWED_CASH_TYPES },
        status: 'active',
      },
      orderBy: [{ currency: 'asc' }, { accountCode: 'asc' }],
    });

    // 3. Query all Ledger lines for this business date on these accounts
    const accountIds = cashAccounts.map((a) => a.id);
    const dayLedgerLines = await prisma.ledgerLine.findMany({
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

    // Map day movements per account
    const inflowMap = new Map<string, Decimal>();
    const outflowMap = new Map<string, Decimal>();

    for (const line of dayLedgerLines) {
      const dDeb = new Decimal(line.debit?.toString() || 0);
      const dCred = new Decimal(line.credit?.toString() || 0);

      inflowMap.set(line.accountId, (inflowMap.get(line.accountId) || new Decimal(0)).plus(dDeb));
      outflowMap.set(line.accountId, (outflowMap.get(line.accountId) || new Decimal(0)).plus(dCred));
    }

    // 4. Build exact ClosingAccountItem array using real Ledger and Decimal calculations
    const items: ClosingAccountItem[] = cashAccounts.map((acc) => {
      const dCur = new Decimal(acc.currentBalance?.toString() || 0);
      const dInflow = inflowMap.get(acc.id) || new Decimal(0);
      const dOutflow = outflowMap.get(acc.id) || new Decimal(0);
      // Opening = Current - Inflow + Outflow
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

    // 5. Pre-flight Check: Blocking conditions (شروط منع الإغلاق)
    const blockingReasons: { code: string; message: string; count: number; details?: any }[] = [];

    // Check A: Open or Unbalanced Customer Sessions for this date
    const openSessions = await prisma.customerSession.findMany({
      where: {
        businessDate: dateStr,
        status: { in: ['open', 'has_balance'] },
      },
      select: { id: true, sessionNumber: true, status: true, customer: { select: { name: true } } },
    });

    if (openSessions.length > 0) {
      blockingReasons.push({
        code: 'OPEN_CUSTOMER_SESSIONS',
        count: openSessions.length,
        message: `يوجد عدد (${openSessions.length}) جلسة عملاء مفتوحة أو غير مسواة بهذا التاريخ. يجب إكمالها أو تسويتها قبل إغلاق اليوم.`,
        details: openSessions.map((s) => ({
          id: s.id,
          sessionNumber: s.sessionNumber,
          customerName: s.customer?.name || 'عميل',
          status: s.status,
        })),
      });
    }

    // Check B: Unbalanced Ledger Entries for this date
    const dayEntries = await prisma.ledgerEntry.findMany({
      where: { entryDate: dateStr },
      include: { lines: true },
    });

    const unbalancedEntries: string[] = [];
    for (const ent of dayEntries) {
      let deb = new Decimal(0);
      let cred = new Decimal(0);
      for (const line of ent.lines) {
        deb = deb.plus(line.debit?.toString() || 0);
        cred = cred.plus(line.credit?.toString() || 0);
      }
      if (!deb.equals(cred)) {
        unbalancedEntries.push(ent.entryNumber);
      }
    }

    if (unbalancedEntries.length > 0) {
      blockingReasons.push({
        code: 'UNBALANCED_LEDGER_ENTRIES',
        count: unbalancedEntries.length,
        message: `يوجد عدد (${unbalancedEntries.length}) قيد محاسبي غير متوازن في دفتر الأستاذ العام لهذا التاريخ!`,
        details: unbalancedEntries,
      });
    }

    // 6. Operational Statistics for this business date
    const totalSessions = await prisma.customerSession.count({ where: { businessDate: dateStr } });
    const completedSessions = await prisma.customerSession.count({
      where: { businessDate: dateStr, status: 'completed' },
    });

    // Receipts linked to this day's customer sessions
    const sessionReceiptsCount = await prisma.bankakReceipt.count({
      where: {
        customerSession: { businessDate: dateStr },
      },
    });

    // Read-only monitoring of non-cash accounts (Capital, Liabilities, Expenses)
    const nonCashAccounts = await prisma.account.findMany({
      where: {
        accountType: { notIn: ALLOWED_CASH_TYPES },
      },
      select: { id: true, accountCode: true, name: true, accountType: true, currency: true, currentBalance: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        businessDate: dateStr,
        isClosed,
        closingRecord: existingClosing,
        canClose: blockingReasons.length === 0 && !isClosed,
        blockingReasons,
        reconciliation,
        stats: {
          totalSessions,
          completedSessions,
          openSessionsCount: openSessions.length,
          receiptsCount: sessionReceiptsCount,
        },
        nonCashAccounts: nonCashAccounts.map((a) => ({
          ...a,
          currentBalance: Number(a.currentBalance),
        })),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في معاينة الإغلاق' }, { status: 500 });
  }
}
