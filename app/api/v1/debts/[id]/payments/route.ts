import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { id } = params;
  const debt = await prisma.debt.findFirst({
    where: { OR: [{ id }, { debtNumber: id }] },
  });

  if (!debt) {
    return NextResponse.json({ error: 'سجل الدين غير موجود' }, { status: 404 });
  }

  const payments = await prisma.debtPayment.findMany({
    where: { debtId: debt.id },
    orderBy: { paymentDate: 'desc' },
  });

  // Enrich with account names
  const accountIds = Array.from(new Set(payments.map((p) => p.accountId)));
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, accountCode: true, name: true, currency: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const enrichedPayments = payments.map((p) => ({
    ...p,
    amount: Number(p.amount),
    account: accountMap.get(p.accountId) || null,
  }));

  return NextResponse.json({ success: true, data: enrichedPayments });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  // Strict RBAC: Only Admin and Accountant can register debt payments
  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتسجيل دفعات وسداد الديون. الصلاحية مقتصرة على المحاسب أو مدير النظام فقط' },
      { status: 403 }
    );
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: 'معرف الدين مطلوب' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { amount, accountId, paymentDate, reference, notes } = body;

    // 1. Validation
    let dPayAmount: Decimal;
    try {
      dPayAmount = new Decimal(amount);
    } catch {
      return NextResponse.json({ error: 'مبلغ السداد غير صالح' }, { status: 400 });
    }

    if (!dPayAmount.isFinite() || dPayAmount.isNaN() || dPayAmount.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'مبلغ السداد يجب أن يكون رقماً موجباً أكبر من الصفر' }, { status: 400 });
    }

    if (!accountId) {
      return NextResponse.json({ error: 'الحساب المالي (الخزينة أو البنك) مطلوب لإتمام حركة السداد' }, { status: 400 });
    }

    // 2. Fetch and validate safe account
    const safeAccount = await prisma.account.findUnique({ where: { id: accountId } });
    if (!safeAccount) {
      return NextResponse.json({ error: 'الحساب المالي المحدد غير موجود' }, { status: 404 });
    }

    if (safeAccount.status !== 'active') {
      return NextResponse.json({ error: `الحساب المالي (${safeAccount.name}) غير نشط أو معطل` }, { status: 400 });
    }

    const ALLOWED_SAFE_TYPES = ['cash_safe', 'bank', 'bankak', 'employee_custody'];
    if (!ALLOWED_SAFE_TYPES.includes(safeAccount.accountType)) {
      return NextResponse.json(
        { error: 'يجب اختيار خزينة نقدية، حساب بنكي، حساب بنكك، أو عهدة لتنفيذ السداد' },
        { status: 400 }
      );
    }

    if (['1060', '1065'].includes(safeAccount.accountCode) || safeAccount.accountType === 'clearing') {
      return NextResponse.json({ error: 'لا يمكن استخدام حسابات الوساطة المعلقة للسداد' }, { status: 400 });
    }

    const payDate = getSystemBusinessDate(paymentDate);
    await assertBusinessDateOpen(payDate);

    // 3. Execute Atomic Transaction with Row-Level Locks
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify that the business date is open and not frozen
      await assertBusinessDateOpen(payDate, tx);

      // Find debt with lock
      const debt = await tx.debt.findFirst({
        where: { OR: [{ id }, { debtNumber: id }] },
      });

      if (!debt) {
        throw new Error('سجل الدين غير موجود');
      }

      if (debt.status === 'paid') {
        throw new Error('هذا الدين تم سداده بالكامل مسبقاً');
      }

      if (debt.status === 'cancelled') {
        throw new Error('هذا الدين ملغي ولا يمكن تسجيل دفعات له');
      }

      // Currency matching
      const cur = debt.currency;
      if (safeAccount.currency !== cur) {
        throw new Error(
          `عملة الحساب المالي (${safeAccount.currency}) لا تطابق عملة الدين (${cur})`
        );
      }

      const dRemaining = new Decimal(debt.remainingAmount.toString());

      // Overpayment guard with 0.0001 epsilon
      if (dPayAmount.greaterThan(dRemaining.plus(0.0001))) {
        throw new Error(
          `مبلغ السداد (${dPayAmount.toFixed(2)} ${cur}) أكبر من المبلغ المتبقي المستحق (${dRemaining.toFixed(2)} ${cur})`
        );
      }

      const isReceivable = debt.creditorType === 'office';
      const partyType = isReceivable ? debt.debtorType : debt.creditorType;
      const partyName = isReceivable ? debt.debtorId : debt.creditorId;

      // Determine counter debt account (customer or supplier liability)
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

      let ledgerEntry = null;

      if (isReceivable) {
        // RECEIVABLE COLLECTION (تحصيل دين لنا من طرف):
        // Cash ENTERS our safe: Debit Safe | Credit Debt Account
        ledgerEntry = await postLedgerTransaction({
          entryType: 'debt_payment_collection',
          referenceType: 'DebtPayment',
          referenceId: debt.debtNumber,
          entryDate: payDate,
          description: `تحصيل دفعة دين رقم ${debt.debtNumber} من ${partyName} (${dPayAmount.toNumber().toLocaleString()} ${cur})`,
          createdBy: user.name || user.email || user.userId || 'system',
          tx,
          lines: [
            {
              accountId: lockedSafe.id,
              currency: cur,
              debit: dPayAmount.toNumber(),
              credit: 0,
              description: `تحصيل سداد دين وارد إلى ${lockedSafe.name}`,
            },
            {
              accountId: lockedDebtAcc.id,
              currency: cur,
              debit: 0,
              credit: dPayAmount.toNumber(),
              description: `تسوية وتخفيض مديونية ${partyName} (${debt.debtNumber})`,
            },
          ],
        });
      } else {
        // PAYABLE PAYMENT (سداد التزام علينا لطرف):
        // Cash LEAVES our safe: Debit Debt Account | Credit Safe
        const dSafeBal = new Decimal(lockedSafe.currentBalance.toString());
        if (dSafeBal.lessThan(dPayAmount)) {
          throw new Error(
            `رصيد الحساب المالي (${lockedSafe.name}) لا يكفي لسداد الالتزام. المتاح: ${dSafeBal.toFixed(2)} ${cur}، والمطلوب سداده: ${dPayAmount.toFixed(2)} ${cur}`
          );
        }

        ledgerEntry = await postLedgerTransaction({
          entryType: 'debt_payment_settlement',
          referenceType: 'DebtPayment',
          referenceId: debt.debtNumber,
          entryDate: payDate,
          description: `سداد دفعة التزام رقم ${debt.debtNumber} لصالح ${partyName} (${dPayAmount.toNumber().toLocaleString()} ${cur})`,
          createdBy: user.name || user.email || user.userId || 'system',
          tx,
          lines: [
            {
              accountId: lockedDebtAcc.id,
              currency: cur,
              debit: dPayAmount.toNumber(),
              credit: 0,
              description: `سداد وتخفيض التزام ${partyName} (${debt.debtNumber})`,
            },
            {
              accountId: lockedSafe.id,
              currency: cur,
              debit: 0,
              credit: dPayAmount.toNumber(),
              description: `صرف نقدي من ${lockedSafe.name}`,
            },
          ],
        });
      }

      // Record DebtPayment
      const paymentRef = reference?.trim() || `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const payment = await tx.debtPayment.create({
        data: {
          debtId: debt.id,
          amount: dPayAmount.toNumber(),
          currency: cur,
          accountId: lockedSafe.id,
          paymentDate: payDate,
          reference: paymentRef,
          createdBy: user.name || user.email || user.userId || 'system',
        },
      });

      // Calculate new remaining amount with Decimal precision
      const newRemaining = Decimal.max(0, dRemaining.minus(dPayAmount));
      const newStatus = newRemaining.lessThanOrEqualTo(0.0001) ? 'paid' : 'partially_paid';

      // Update Debt record
      const updatedDebt = await tx.debt.update({
        where: { id: debt.id },
        data: {
          remainingAmount: newRemaining.toNumber(),
          status: newStatus,
        },
      });

      return {
        payment,
        updatedDebt,
        ledgerEntry,
        lockedSafe,
        isReceivable,
        partyName,
        cur,
        newRemaining: newRemaining.toNumber(),
        newStatus,
      };
    });

    // 4. Audit Log
    await logAuditEvent({
      userId: user.userId,
      action: 'DEBT_PAYMENT',
      entityType: 'DebtPayment',
      entityId: result.payment.id,
      newValues: {
        paymentId: result.payment.id,
        debtNumber: result.updatedDebt.debtNumber,
        type: result.isReceivable ? 'collection' : 'settlement',
        amount: dPayAmount.toNumber(),
        currency: result.cur,
        paidSafe: result.lockedSafe.name,
        newRemaining: result.newRemaining,
        newStatus: result.newStatus,
      },
      reason: notes || `تسجيل سداد دين رقم ${result.updatedDebt.debtNumber}`,
    });

    return NextResponse.json(
      {
        success: true,
        message: result.isReceivable
          ? `تم تحصيل الدفعة بمبلغ ${dPayAmount.toNumber().toLocaleString()} ${result.cur} وإيداعها في ${result.lockedSafe.name} بنجاح`
          : `تم سداد الدفعة بمبلغ ${dPayAmount.toNumber().toLocaleString()} ${result.cur} من ${result.lockedSafe.name} بنجاح`,
        data: {
          payment: {
            ...result.payment,
            amount: dPayAmount.toNumber(),
            account: {
              id: result.lockedSafe.id,
              name: result.lockedSafe.name,
              currency: result.cur,
            },
          },
          debt: {
            ...result.updatedDebt,
            originalAmount: Number(result.updatedDebt.originalAmount),
            remainingAmount: result.newRemaining,
            paidAmount: Number(result.updatedDebt.originalAmount) - result.newRemaining,
          },
          ledgerEntry: result.ledgerEntry,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ أثناء تسجيل سداد الدين' }, { status: 500 });
  }
}
