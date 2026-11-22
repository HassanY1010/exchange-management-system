import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const currency = searchParams.get('currency');
  const type = searchParams.get('type'); // 'receivable' | 'payable' | 'all'
  const status = searchParams.get('status');
  const debtorType = searchParams.get('debtorType');
  const search = searchParams.get('search');
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');

  const whereClause: any = {};

  if (currency && currency !== 'ALL') {
    whereClause.currency = currency.toUpperCase();
  }

  if (status && status !== 'ALL') {
    whereClause.status = status;
  }

  if (type === 'receivable') {
    whereClause.creditorType = 'office';
  } else if (type === 'payable') {
    whereClause.debtorType = 'office';
  }

  if (debtorType && debtorType !== 'ALL') {
    whereClause.OR = [{ debtorType }, { creditorType: debtorType }];
  }

  if (fromDate || toDate) {
    whereClause.debtDate = {};
    if (fromDate) whereClause.debtDate.gte = fromDate;
    if (toDate) whereClause.debtDate.lte = toDate;
  }

  if (search) {
    whereClause.OR = [
      { debtNumber: { contains: search, mode: 'insensitive' } },
      { debtorId: { contains: search, mode: 'insensitive' } },
      { creditorId: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const rawDebts = await prisma.debt.findMany({
    where: whereClause,
    include: {
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
    },
    orderBy: [{ debtDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });

  const todayStr = new Date().toISOString().split('T')[0];

  const enrichedDebts = rawDebts.map((d) => {
    const isReceivable = d.creditorType === 'office';
    const isPayable = d.debtorType === 'office';
    const partyName = isReceivable ? d.debtorId : d.creditorId;
    const partyType = isReceivable ? d.debtorType : d.creditorType;
    const orig = new Decimal(d.originalAmount.toString());
    const rem = new Decimal(d.remainingAmount.toString());
    const paid = orig.minus(rem);
    const isOverdue =
      d.dueDate && d.dueDate < todayStr && d.status !== 'paid' && d.status !== 'cancelled';

    return {
      ...d,
      originalAmount: orig.toNumber(),
      remainingAmount: rem.toNumber(),
      paidAmount: paid.toNumber(),
      isReceivable,
      isPayable,
      partyName,
      partyType,
      isOverdue: Boolean(isOverdue),
      payments: d.payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
    };
  });

  // Multi-Currency isolated summary (strictly excluding cancelled debts)
  const activeDebts = enrichedDebts.filter((d) => d.status !== 'cancelled');
  const receivablesByCurrency: Record<string, number> = {};
  const payablesByCurrency: Record<string, number> = {};
  const netBalanceByCurrency: Record<string, number> = {};

  for (const d of activeDebts) {
    const cur = d.currency;
    const remAmt = d.remainingAmount;

    if (d.isReceivable) {
      receivablesByCurrency[cur] = (receivablesByCurrency[cur] || 0) + remAmt;
    } else {
      payablesByCurrency[cur] = (payablesByCurrency[cur] || 0) + remAmt;
    }
  }

  const allCurrencies = Array.from(
    new Set([...Object.keys(receivablesByCurrency), ...Object.keys(payablesByCurrency)])
  );
  for (const cur of allCurrencies) {
    const rec = receivablesByCurrency[cur] || 0;
    const pay = payablesByCurrency[cur] || 0;
    netBalanceByCurrency[cur] = rec - pay;
  }

  return NextResponse.json({
    success: true,
    data: enrichedDebts,
    summary: {
      totalCount: rawDebts.length,
      outstandingCount: activeDebts.filter((d) => d.status === 'outstanding').length,
      partiallyPaidCount: activeDebts.filter((d) => d.status === 'partially_paid').length,
      paidCount: rawDebts.filter((d) => d.status === 'paid').length,
      cancelledCount: rawDebts.filter((d) => d.status === 'cancelled').length,
      overdueCount: activeDebts.filter((d) => d.isOverdue).length,
      receivablesByCurrency,
      payablesByCurrency,
      netBalanceByCurrency,
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can create or register debts
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتسجيل الديون أو الالتزامات. الصلاحية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const {
      debtType = 'receivable', // 'receivable' (مستحق لنا) | 'payable' (مستحق علينا)
      partyType = 'customer', // 'customer' | 'supplier' | 'employee' | 'other'
      partyId,
      partyName,
      currency,
      originalAmount,
      dueDate,
      description,
      fundingAccountId, // Optional: if funded/disbursed directly from a safe now
    } = body;

    // 1. Validation
    const effectivePartyName = partyName?.trim() || partyId?.trim();
    if (!effectivePartyName) {
      return NextResponse.json({ error: 'اسم أو معرف الطرف (المدين أو الدائن) مطلوب' }, { status: 400 });
    }

    if (!currency) {
      return NextResponse.json({ error: 'العملة مطلوبة' }, { status: 400 });
    }

    const cur = currency.toUpperCase();
    const ALLOWED_CURRENCIES = ['EGP', 'SDG', 'USD', 'SAR', 'AED'];
    if (!ALLOWED_CURRENCIES.includes(cur)) {
      return NextResponse.json(
        { error: `العملة ${cur} غير مدعومة. العملات المدعومة: ${ALLOWED_CURRENCIES.join(', ')}` },
        { status: 400 }
      );
    }

    let dAmount: Decimal;
    try {
      dAmount = new Decimal(originalAmount);
    } catch {
      return NextResponse.json({ error: 'قيمة مبلغ الدين غير صالحة' }, { status: 400 });
    }

    if (!dAmount.isFinite() || dAmount.isNaN() || dAmount.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'مبلغ الدين يجب أن يكون رقماً موجباً أكبر من الصفر' }, { status: 400 });
    }

    if (dAmount.greaterThan(100000000000)) {
      return NextResponse.json({ error: 'المبلغ يتجاوز الحد الأقصى المسموح به' }, { status: 400 });
    }

    const isReceivable = debtType === 'receivable';
    const debtorType = isReceivable ? partyType : 'office';
    const debtorId = isReceivable ? effectivePartyName : 'office';
    const creditorType = isReceivable ? 'office' : partyType;
    const creditorId = isReceivable ? 'office' : effectivePartyName;

    const count = await prisma.debt.count();
    const debtNumber = `DEBT-${Date.now()}-${count + 1}`;
    const debtDateStr = getSystemBusinessDate(body.debtDate || body.businessDate);
    await assertBusinessDateOpen(debtDateStr);
    const desc =
      description?.trim() ||
      (isReceivable
        ? `دين مستحق لنا على ${effectivePartyName} (${partyType})`
        : `التزام مستحق علينا لصالح ${effectivePartyName} (${partyType})`);

    // 2. Execute Transaction
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify that the business date is open and not frozen
      await assertBusinessDateOpen(debtDateStr, tx);

      let ledgerEntry = null;

      // If initial funding / safe disbursement is requested
      if (fundingAccountId) {
        const safeAccount = await tx.account.findUnique({ where: { id: fundingAccountId } });
        if (!safeAccount || safeAccount.status !== 'active') {
          throw new Error('الحساب المالي المحدد للتمويل غير موجود أو غير نشط');
        }

        if (safeAccount.currency !== cur) {
          throw new Error(
            `عملة الحساب المالي (${safeAccount.currency}) لا تطابق عملة الدين (${cur})`
          );
        }

        // Determine matching debt account (customer/supplier liability or clearing)
        const debtAccountCode =
          partyType === 'supplier'
            ? cur === 'SDG' ? '2020' : `2020-${cur}`
            : cur === 'EGP' ? '2010' : cur === 'SDG' ? '2015' : `2010-${cur}`;

        let debtAcc = await tx.account.findFirst({
          where: { currency: cur, accountCode: debtAccountCode },
        });

        if (!debtAcc) {
          debtAcc = await tx.account.upsert({
            where: { accountCode: debtAccountCode },
            create: {
              accountCode: debtAccountCode,
              name: partyType === 'supplier' ? `التزامات الموردين (${cur})` : `التزامات وحسابات العملاء (${cur})`,
              accountType: partyType === 'supplier' ? 'supplier_liability' : 'customer_liability',
              currency: cur,
              openingBalance: 0,
              currentBalance: 0,
              isSystem: true,
              status: 'active',
            },
            update: {},
          });
        }

        // Lock accounts in deterministic sorted order
        const sortedIds = [safeAccount.id, debtAcc.id].sort();
        const lockedFirst = (await tx.$queryRawUnsafe(
          'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
          sortedIds[0]
        )) as any[];
        const lockedSecond = (await tx.$queryRawUnsafe(
          'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
          sortedIds[1]
        )) as any[];

        const accountMap = new Map<string, any>();
        accountMap.set(sortedIds[0], lockedFirst[0]);
        accountMap.set(sortedIds[1], lockedSecond[0]);

        const lockedSafe = accountMap.get(safeAccount.id);
        const lockedDebtAcc = accountMap.get(debtAcc.id);

        if (isReceivable) {
          // Cash disbursed to establish loan: Safe decreases, Debt increases
          const dSafeBal = new Decimal(lockedSafe.currentBalance.toString());
          if (dSafeBal.lessThan(dAmount)) {
            throw new Error(
              `رصيد الحساب المالي (${lockedSafe.name}) لا يكفي لتمويل الدين. المتاح: ${dSafeBal.toFixed(2)} ${cur}`
            );
          }

          ledgerEntry = await postLedgerTransaction({
            entryType: 'debt_origination',
            referenceType: 'Debt',
            referenceId: debtNumber,
            entryDate: debtDateStr,
            description: `إثبات وصرف دين نقدي: ${desc}`,
            createdBy: user.name || user.email || user.userId || 'system',
            tx,
            lines: [
              {
                accountId: lockedDebtAcc.id,
                currency: cur,
                debit: dAmount.toNumber(),
                credit: 0,
                description: `إثبات ذمة مدينة على ${effectivePartyName}`,
              },
              {
                accountId: lockedSafe.id,
                currency: cur,
                debit: 0,
                credit: dAmount.toNumber(),
                description: `صرف نقدي من ${lockedSafe.name}`,
              },
            ],
          });
        } else {
          // Cash received to establish liability: Safe increases, Debt liability increases
          ledgerEntry = await postLedgerTransaction({
            entryType: 'debt_origination',
            referenceType: 'Debt',
            referenceId: debtNumber,
            entryDate: debtDateStr,
            description: `إثبات واستلام التزام نقدي: ${desc}`,
            createdBy: user.name || user.email || user.userId || 'system',
            tx,
            lines: [
              {
                accountId: lockedSafe.id,
                currency: cur,
                debit: dAmount.toNumber(),
                credit: 0,
                description: `إيداع نقدي في ${lockedSafe.name}`,
              },
              {
                accountId: lockedDebtAcc.id,
                currency: cur,
                debit: 0,
                credit: dAmount.toNumber(),
                description: `إثبات التزام دائن لصالح ${effectivePartyName}`,
              },
            ],
          });
        }
      }

      // Create Debt Record
      const newDebt = await tx.debt.create({
        data: {
          debtNumber,
          debtorType,
          debtorId,
          creditorType,
          creditorId,
          currency: cur,
          originalAmount: dAmount.toNumber(),
          remainingAmount: dAmount.toNumber(),
          debtDate: debtDateStr,
          dueDate: dueDate || null,
          description: desc,
          status: 'outstanding',
          createdBy: user.name || user.email || user.userId || 'system',
        },
      });

      // Record Audit Log inside atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'CREATE_DEBT',
        entityType: 'Debt',
        entityId: newDebt.id,
        newValues: {
          debtNumber: newDebt.debtNumber,
          type: isReceivable ? 'receivable' : 'payable',
          party: effectivePartyName,
          partyType,
          amount: dAmount.toNumber(),
          currency: cur,
          dueDate,
        },
        reason: desc,
        tx,
      });

      return { newDebt, ledgerEntry };
    });

    return NextResponse.json(
      {
        success: true,
        message: isReceivable
          ? `تم تسجيل الدين المستحق لنا بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur} بنجاح`
          : `تم تسجيل الالتزام المستحق علينا بمبلغ ${dAmount.toNumber().toLocaleString()} ${cur} بنجاح`,
        data: {
          ...result.newDebt,
          originalAmount: dAmount.toNumber(),
          remainingAmount: dAmount.toNumber(),
          paidAmount: 0,
          isReceivable,
          isPayable: !isReceivable,
          partyName: effectivePartyName,
          partyType,
          ledgerEntry: result.ledgerEntry,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تسجيل الدين' }, { status: 500 });
  }
}
