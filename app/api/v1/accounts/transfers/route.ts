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
  const accountId = searchParams.get('accountId');
  const currency = searchParams.get('currency');

  const whereClause: any = {};
  if (accountId) {
    whereClause.OR = [{ fromAccountId: accountId }, { toAccountId: accountId }];
  }
  if (currency) {
    whereClause.currency = currency.toUpperCase();
  }

  const transfers = await prisma.accountTransfer.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Enrich with account names
  const accountIds = Array.from(
    new Set([...transfers.map((t) => t.fromAccountId), ...transfers.map((t) => t.toAccountId)])
  );
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, accountCode: true, name: true, currency: true },
  });
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const enriched = transfers.map((t) => ({
    ...t,
    amount: Number(t.amount),
    toAmount: t.toAmount ? Number(t.toAmount) : null,
    exchangeRate: t.exchangeRate ? Number(t.exchangeRate) : null,
    feeAmount: Number(t.feeAmount),
    fromAccount: accountMap.get(t.fromAccountId) || null,
    toAccount: accountMap.get(t.toAccountId) || null,
  }));

  return NextResponse.json({
    success: true,
    data: enriched,
    count: enriched.length,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant', 'cashier'].includes(user.role)) {
    return NextResponse.json(
      { error: 'غير مصرح لك بتنفيذ التحويلات المالية بين الصناديق' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const {
      fromAccountId,
      toAccountId,
      amount,
      toAmount,
      exchangeRate,
      feeAmount = 0,
      description,
      transferDate,
      businessDate,
    } = body;

    const transferDateStr = getSystemBusinessDate(transferDate || businessDate);

    const dAmount = new Decimal(amount || 0);
    const dFee = new Decimal(feeAmount || 0);

    if (!fromAccountId || !toAccountId) {
      return NextResponse.json({ error: 'يجب تحديد الصندوق المصدر والصندوق المستهدف' }, { status: 400 });
    }

    if (fromAccountId === toAccountId) {
      return NextResponse.json({ error: 'لا يمكن إجراء تحويل مالي بين الصندوق ونفسه' }, { status: 400 });
    }

    if (dAmount.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: 'مبلغ التحويل يجب أن يكون أكبر من الصفر' }, { status: 400 });
    }

    if (dFee.isNegative()) {
      return NextResponse.json({ error: 'رسوم التحويل لا يمكن أن تكون سالبة' }, { status: 400 });
    }

    const countTransfers = await prisma.accountTransfer.count();
    const transferNumber = `TRF-${Date.now()}-${countTransfers + 1}`;

    // Execute atomic transfer with Row-Level Locks
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify that the business date is open and not frozen
      await assertBusinessDateOpen(transferDateStr, tx);

      // 1. Lock accounts in deterministic sorted order to completely prevent deadlocks
      const sortedIds = [fromAccountId, toAccountId].sort();
      const lockedRowsFirst = (await tx.$queryRawUnsafe(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
        sortedIds[0]
      )) as any[];
      const lockedRowsSecond = (await tx.$queryRawUnsafe(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance", "status" FROM "Account" WHERE id = $1 FOR UPDATE',
        sortedIds[1]
      )) as any[];

      const accountMap = new Map<string, any>();
      accountMap.set(sortedIds[0], lockedRowsFirst[0]);
      accountMap.set(sortedIds[1], lockedRowsSecond[0]);

      const fromAcc = accountMap.get(fromAccountId);
      const toAcc = accountMap.get(toAccountId);

      if (!fromAcc || !toAcc) {
        throw new Error('أحد الصناديق أو الحسابات المحددة غير موجود');
      }

      if (fromAcc.status !== 'active') {
        throw new Error(`الصندوق المصدر (${fromAcc.name}) معطل أو موقوف ولا يمكن التحويل منه`);
      }

      if (toAcc.status !== 'active') {
        throw new Error(`الصندوق المستهدف (${toAcc.name}) معطل أو موقوف ولا يمكن التحويل إليه`);
      }

      // 2. Strict Balance Sufficiency Check
      const fromCurrentBal = new Decimal(fromAcc.currentBalance.toString());
      const totalDeduction = dAmount.plus(dFee);

      if (fromCurrentBal.lessThan(totalDeduction)) {
        throw new Error(
          `رصيد الصندوق المصدر (${fromAcc.name}) غير كافٍ. المتاح: ${fromCurrentBal.toFixed(2)} ${fromAcc.currency}، والمطلوب خصمه: ${totalDeduction.toFixed(2)} ${fromAcc.currency}`
        );
      }

      const isSameCurrency = fromAcc.currency === toAcc.currency;
      let finalToAmount = dAmount;
      let finalExchangeRate: Decimal | null = null;

      if (isSameCurrency) {
        // --- CASE A: SAME CURRENCY TRANSFER ---
        const descText = description?.trim() || `تحويل مالي داخلي من ${fromAcc.name} إلى ${toAcc.name}`;

        const ledgerEntry = await postLedgerTransaction({
          entryType: 'fund_transfer',
          referenceType: 'AccountTransfer',
          referenceId: transferNumber,
          entryDate: transferDateStr,
          description: descText,
          createdBy: user.name || user.email || user.userId || 'system',
          tx,
          lines: [
            {
              accountId: toAcc.id,
              currency: toAcc.currency,
              debit: dAmount.toNumber(),
              credit: 0,
              description: `استلام تحويل مالي من ${fromAcc.name}`,
            },
            {
              accountId: fromAcc.id,
              currency: fromAcc.currency,
              debit: 0,
              credit: dAmount.toNumber(),
              description: `خصم تحويل مالي إلى ${toAcc.name}`,
            },
          ],
        });

        // 3. Create AccountTransfer Record
        const transferRecord = await tx.accountTransfer.create({
          data: {
            transferNumber,
            fromAccountId: fromAcc.id,
            toAccountId: toAcc.id,
            amount: dAmount.toNumber(),
            currency: fromAcc.currency,
            toAmount: dAmount.toNumber(),
            toCurrency: toAcc.currency,
            exchangeRate: 1,
            feeAmount: dFee.toNumber(),
            description: descText,
            status: 'completed',
            ledgerEntryId: ledgerEntry.id,
            createdBy: user.name || user.email || user.userId || 'system',
          },
        });

        return { transferRecord, ledgerEntry, fromAcc, toAcc };
      } else {
        // --- CASE B: CROSS-CURRENCY TRANSFER ---
        if (!toAmount && !exchangeRate) {
          throw new Error('التحويل بين عملات مختلفة يتطلب تحديد سعر الصرف أو المبلغ المقابل المستلم');
        }

        if (toAmount) {
          finalToAmount = new Decimal(toAmount);
          if (finalToAmount.lessThanOrEqualTo(0)) {
            throw new Error('المبلغ المقابل المستلم يجب أن يكون أكبر من الصفر');
          }
          finalExchangeRate = exchangeRate ? new Decimal(exchangeRate) : finalToAmount.dividedBy(dAmount);
        } else {
          finalExchangeRate = new Decimal(exchangeRate);
          if (finalExchangeRate.lessThanOrEqualTo(0)) {
            throw new Error('سعر الصرف يجب أن يكون أكبر من الصفر');
          }
          finalToAmount = dAmount.times(finalExchangeRate);
        }

        // Locate Currency Clearing Accounts (currency-isolated to prevent currency mixing)
        let clearingFrom = await tx.account.findFirst({
          where: { currency: fromAcc.currency, accountType: { in: ['cash_safe', 'clearing'] }, accountCode: { startsWith: '106' } },
        });

        if (!clearingFrom) {
          const code = fromAcc.currency === 'EGP' ? '1060' : fromAcc.currency === 'SDG' ? '1065' : `1060-${fromAcc.currency}`;
          clearingFrom = await tx.account.upsert({
            where: { accountCode: code },
            create: {
              accountCode: code,
              name: `حساب وسيط تسوية وتبادل العملات (${fromAcc.currency})`,
              accountType: 'clearing',
              currency: fromAcc.currency,
              openingBalance: 0,
              currentBalance: 0,
              isSystem: true,
              status: 'active',
            },
            update: {},
          });
        }

        let clearingTo = await tx.account.findFirst({
          where: { currency: toAcc.currency, accountType: { in: ['cash_safe', 'clearing'] }, accountCode: { startsWith: '106' } },
        });

        if (!clearingTo) {
          const code = toAcc.currency === 'EGP' ? '1060' : toAcc.currency === 'SDG' ? '1065' : `1060-${toAcc.currency}`;
          clearingTo = await tx.account.upsert({
            where: { accountCode: code },
            create: {
              accountCode: code,
              name: `حساب وسيط تسوية وتبادل العملات (${toAcc.currency})`,
              accountType: 'clearing',
              currency: toAcc.currency,
              openingBalance: 0,
              currentBalance: 0,
              isSystem: true,
              status: 'active',
            },
            update: {},
          });
        }

        if (!clearingFrom || !clearingTo) {
          throw new Error('حسابات الوساطة وتسوية العملات غير مهيأة للتحويل متعدد العملات');
        }

        const descText =
          description?.trim() ||
          `تحويل ومبادلة عملة: ${dAmount.toNumber().toLocaleString()} ${fromAcc.currency} مقابل ${finalToAmount.toNumber().toLocaleString()} ${toAcc.currency} (سعر: ${finalExchangeRate.toFixed(4)})`;

        // Leg 1: Deduct Source Currency
        const leg1 = await postLedgerTransaction({
          entryType: 'fund_transfer_cross_from',
          referenceType: 'AccountTransfer',
          referenceId: transferNumber,
          entryDate: transferDateStr,
          description: `خصم تحويل عملة من ${fromAcc.name} (${dAmount.toNumber().toLocaleString()} ${fromAcc.currency})`,
          createdBy: user.name || user.email || user.userId || 'system',
          tx,
          lines: [
            {
              accountId: clearingFrom.id,
              currency: fromAcc.currency,
              debit: dAmount.toNumber(),
              credit: 0,
              description: `تسوية وسيط تحويل عملة من ${fromAcc.name}`,
            },
            {
              accountId: fromAcc.id,
              currency: fromAcc.currency,
              debit: 0,
              credit: dAmount.toNumber(),
              description: `صرف تحويل عملة إلى ${toAcc.name}`,
            },
          ],
        });

        // Leg 2: Credit Destination Currency
        await postLedgerTransaction({
          entryType: 'fund_transfer_cross_to',
          referenceType: 'AccountTransfer',
          referenceId: transferNumber,
          entryDate: transferDateStr,
          description: `إيداع تحويل عملة في ${toAcc.name} (${finalToAmount.toNumber().toLocaleString()} ${toAcc.currency})`,
          createdBy: user.name || user.email || user.userId || 'system',
          tx,
          lines: [
            {
              accountId: toAcc.id,
              currency: toAcc.currency,
              debit: finalToAmount.toNumber(),
              credit: 0,
              description: `استلام تحويل عملة من ${fromAcc.name}`,
            },
            {
              accountId: clearingTo.id,
              currency: toAcc.currency,
              debit: 0,
              credit: finalToAmount.toNumber(),
              description: `تسوية وسيط استلام عملة في ${toAcc.name}`,
            },
          ],
        });

        // Record Transfer
        const transferRecord = await tx.accountTransfer.create({
          data: {
            transferNumber,
            fromAccountId: fromAcc.id,
            toAccountId: toAcc.id,
            amount: dAmount.toNumber(),
            currency: fromAcc.currency,
            toAmount: finalToAmount.toNumber(),
            toCurrency: toAcc.currency,
            exchangeRate: finalExchangeRate.toNumber(),
            feeAmount: dFee.toNumber(),
            description: descText,
            status: 'completed',
            ledgerEntryId: leg1.id,
            createdBy: user.name || user.email || user.userId || 'system',
          },
        });

        return { transferRecord, ledgerEntry: leg1, fromAcc, toAcc };
      }
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'FUND_TRANSFER',
      entityType: 'AccountTransfer',
      entityId: result.transferRecord.id,
      newValues: {
        transferNumber: result.transferRecord.transferNumber,
        fromAccount: result.fromAcc.name,
        toAccount: result.toAcc.name,
        amount: Number(result.transferRecord.amount),
        currency: result.transferRecord.currency,
        toAmount: result.transferRecord.toAmount ? Number(result.transferRecord.toAmount) : null,
        toCurrency: result.transferRecord.toCurrency,
      },
      reason: description || `تحويل مالي من ${result.fromAcc.name} إلى ${result.toAcc.name}`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم تنفيذ التحويل المالي وترحيل القيود وتحديث الأرصدة بنجاح',
      data: result.transferRecord,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في التحويل المالي' }, { status: 500 });
  }
}
