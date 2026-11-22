import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';
import Decimal from 'decimal.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تسوية وإغلاق العهد النقدية مقتصرة على المدير أو المحاسب' },
      { status: 403 }
    );
  }

  try {
    const { returnRemainingToSafe = true, targetAccountId, notes } = await req.json().catch(() => ({}));

    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock EmployeeCustody
      const lockedCustodies = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "currentAmount", "openingAmount", "status", "accountId", "employeeId", "currency" FROM "EmployeeCustody" WHERE id = $1 FOR UPDATE',
        params.id
      );
      const lockedCustody = lockedCustodies[0];
      if (!lockedCustody) {
        throw new Error('سجل العهدة غير موجود');
      }

      if (lockedCustody.status === 'closed') {
        throw new Error('هذه العهدة مسواة ومغلقة بالفعل');
      }

      const employee = await tx.employee.findUnique({
        where: { id: lockedCustody.employeeId },
      });

      const currentCustodyAmount = new Decimal(lockedCustody.currentAmount.toString());

      // 2. Handle remaining cash if any
      let returnedAmount = 0;
      let returnTxn: any = null;

      if (currentCustodyAmount.greaterThan(0)) {
        if (!returnRemainingToSafe) {
          throw new Error(
            `لا يمكن إغلاق العهدة مع وجود رصيد معلق (${currentCustodyAmount.toFixed(2)} ${lockedCustody.currency}) دون استرجاعه للخزينة أو تسويته رسمياً`
          );
        }

        // Return remaining cash to safe
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

        returnedAmount = currentCustodyAmount.toNumber();

        // Create return CustodyTransaction
        returnTxn = await tx.custodyTransaction.create({
          data: {
            custodyId: params.id,
            transactionType: 'return_to_safe',
            amount: returnedAmount,
            currency: lockedCustody.currency,
            accountId: targetSafe.id,
            referenceNumber: `SETTLE-RET-${Date.now()}`,
            description: `استرجاع تلقائي لمتبقي العهدة عند التسوية والإغلاق النهائي إلى ${targetSafe.name}`,
            createdBy: user.name,
          },
        });

        // Post return ledger transaction inside tx
        await postLedgerTransaction({
          entryType: 'custody_return',
          referenceType: 'CustodyTransaction',
          referenceId: returnTxn.id,
          description: `تسوية وإرجاع متبقي عهدة ${employee?.name || 'الموظف'} (${returnedAmount.toLocaleString()} ${lockedCustody.currency}) إلى ${targetSafe.name}`,
          createdBy: user.name,
          tx,
          lines: [
            {
              accountId: targetSafe.id,
              currency: lockedCustody.currency,
              debit: returnedAmount,
              credit: 0,
              description: `استرجاع متبقي عهدة عند الإغلاق إلى ${targetSafe.name}`,
            },
            {
              accountId: lockedCustody.accountId,
              currency: lockedCustody.currency,
              debit: 0,
              credit: returnedAmount,
              description: `تسوية وإغلاق عهدة ${employee?.name || 'الموظف'}`,
            },
          ],
        });
      }

      // 3. Mark custody as closed
      const closedCustody = await tx.employeeCustody.update({
        where: { id: params.id },
        data: {
          currentAmount: 0,
          status: 'closed',
          closedAt: new Date(),
          approvedBy: user.name,
        },
        include: {
          employee: true,
          transactions: true,
        },
      });

      return {
        closedCustody,
        returnedAmount,
        employeeName: employee?.name || 'الموظف',
        currency: lockedCustody.currency,
      };
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'SETTLE_CUSTODY',
      entityType: 'EmployeeCustody',
      entityId: params.id,
      newValues: {
        status: 'closed',
        returnedAmount: result.returnedAmount,
        currency: result.currency,
      },
      reason: `تسوية وإغلاق العهدة النقدية للموظف ${result.employeeName} نهائياً`,
    });

    return NextResponse.json({
      success: true,
      message: `تم تسوية وإغلاق العهدة بنجاح${result.returnedAmount > 0 ? ` واسترجاع ${result.returnedAmount.toLocaleString()} ${result.currency} للخزينة` : ''}`,
      data: result.closedCustody,
    });
  } catch (error: any) {
    console.error('Custody settlement error:', error);
    return NextResponse.json({ error: error.message || 'خطأ في تسوية العهدة' }, { status: 500 });
  }
}
