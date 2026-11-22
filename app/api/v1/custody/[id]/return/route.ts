import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction, assertBusinessDateOpen } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant', 'custody_officer'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية استرجاع مبالغ العهدة للصندوق مقتصرة على مسؤول العهدة أو المحاسب أو المدير' },
      { status: 403 }
    );
  }

  try {
    const { amount, targetAccountId, notes } = await req.json();

    const dAmount = new Decimal(amount || 0);
    if (dAmount.isNaN() || dAmount.lessThanOrEqualTo(0)) {
      return NextResponse.json(
        { error: 'مبلغ الاسترجاع يجب أن يكون رقماً موجباً أكبر من صفر' },
        { status: 400 }
      );
    }

    const returnAmount = dAmount.toNumber();

    // Execute atomic return within a single Prisma transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Row-level lock on EmployeeCustody
      const lockedCustodies = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "currentAmount", "status", "accountId", "employeeId", "currency", "businessDate" FROM "EmployeeCustody" WHERE id = $1 FOR UPDATE',
        params.id
      );
      const lockedCustody = lockedCustodies[0];
      if (!lockedCustody) {
        throw new Error('سجل العهدة غير موجود');
      }

      // Assert that the custody's business date is open and not frozen
      await assertBusinessDateOpen(lockedCustody.businessDate, tx);

      if (lockedCustody.status === 'closed') {
        throw new Error('هذه العهدة مغلقة بالفعل ولا يمكن استرجاع مبالغ منها');
      }

      const currentCustodyAmount = new Decimal(lockedCustody.currentAmount.toString());
      if (currentCustodyAmount.lessThan(dAmount)) {
        throw new Error(
          `مبلغ الاسترجاع المطلوبة (${dAmount.toFixed(2)} ${lockedCustody.currency}) أكبر من الرصيد المتبقي بالعهدة (${currentCustodyAmount.toFixed(2)} ${lockedCustody.currency})`
        );
      }

      const employee = await tx.employee.findUnique({
        where: { id: lockedCustody.employeeId },
      });

      // 2. Determine target safe account
      let targetSafe: any;
      if (targetAccountId) {
        targetSafe = await tx.account.findUnique({ where: { id: targetAccountId } });
      } else {
        const defaultSafeCode = lockedCustody.currency === 'SDG' ? '1020' : '1010';
        targetSafe = await tx.account.findFirst({
          where: { accountCode: defaultSafeCode },
        });
        if (!targetSafe) {
          targetSafe = await tx.account.findFirst({
            where: { accountType: 'cash_safe', currency: lockedCustody.currency },
          });
        }
      }

      if (!targetSafe) {
        throw new Error(`الخزينة المستلمة لعملة (${lockedCustody.currency}) غير مهيأة`);
      }

      if (targetSafe.currency !== lockedCustody.currency) {
        throw new Error(`عملة الخزينة المستلمة (${targetSafe.currency}) تختلف عن عملة العهدة (${lockedCustody.currency})`);
      }

      // 3. Update custody balance and status atomically
      const newCustodyBalance = currentCustodyAmount.minus(dAmount).toNumber();
      const newStatus = newCustodyBalance === 0 ? 'settled' : 'partially_settled';

      await tx.employeeCustody.update({
        where: { id: params.id },
        data: {
          currentAmount: newCustodyBalance,
          status: newStatus,
        },
      });

      // 4. Create CustodyTransaction record
      const custodyTxn = await tx.custodyTransaction.create({
        data: {
          custodyId: params.id,
          transactionType: 'return_to_safe',
          amount: returnAmount,
          currency: lockedCustody.currency,
          accountId: targetSafe.id,
          referenceNumber: `RET-${Date.now()}`,
          description: `استرجاع نقدية من عهدة ${employee?.name || 'الموظف'} إلى ${targetSafe.name}${notes ? ` (${notes})` : ''}`,
          createdBy: user.name,
        },
      });

      // 5. Post Double-Entry Ledger Entry (Debit Safe Asset, Credit Custody Asset) inside same tx
      await postLedgerTransaction({
        entryType: 'custody_return',
        referenceType: 'CustodyTransaction',
        referenceId: custodyTxn.id,
        entryDate: lockedCustody.businessDate,
        description: `استرجاع نقدية ${returnAmount.toLocaleString()} ${lockedCustody.currency} من عهدة ${employee?.name || 'الموظف'} إلى ${targetSafe.name}`,
        createdBy: user.name,
        tx,
        lines: [
          {
            accountId: targetSafe.id,
            currency: lockedCustody.currency,
            debit: returnAmount,
            credit: 0,
            description: `استرجاع متبقي عهدة إلى ${targetSafe.name}`,
          },
          {
            accountId: lockedCustody.accountId,
            currency: lockedCustody.currency,
            debit: 0,
            credit: returnAmount,
            description: `إيداع مسترجع من عهدة ${employee?.name || 'الموظف'}`,
          },
        ],
      });

      return {
        newCustodyBalance,
        newStatus,
        custodyTxn,
        safeName: targetSafe.name,
        employeeName: employee?.name || 'الموظف',
        currency: lockedCustody.currency,
      };
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CUSTODY_RETURN',
      entityType: 'EmployeeCustody',
      entityId: params.id,
      newValues: {
        returnAmount,
        currency: result.currency,
        targetSafe: result.safeName,
        remainingCustody: result.newCustodyBalance,
        status: result.newStatus,
      },
      reason: `استرجاع مبالغ نقدية من عهدة ${result.employeeName} إلى ${result.safeName}`,
    });

    return NextResponse.json({
      success: true,
      message: `تم استرجاع مبلغ ${returnAmount.toLocaleString()} ${result.currency} إلى ${result.safeName} بنجاح`,
      data: {
        custodyBalanceRemaining: result.newCustodyBalance,
        status: result.newStatus,
        custodyTxn: result.custodyTxn,
      },
    });
  } catch (error: any) {
    console.error('Custody return error:', error);
    return NextResponse.json({ error: error.message || 'خطأ في استرجاع المبلغ للصندوق' }, { status: 500 });
  }
}
