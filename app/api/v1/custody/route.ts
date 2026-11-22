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
  const employeeId = searchParams.get('employeeId');
  const status = searchParams.get('status');
  const currency = searchParams.get('currency');
  const search = searchParams.get('search')?.trim();

  const whereClause: any = {};
  if (employeeId) whereClause.employeeId = employeeId;
  if (status) whereClause.status = status;
  if (currency) whereClause.currency = currency;
  if (search) {
    whereClause.OR = [
      { employee: { name: { contains: search, mode: 'insensitive' } } },
      { employee: { employeeCode: { contains: search, mode: 'insensitive' } } },
      { businessDate: { contains: search } },
    ];
  }

  const custodies = await prisma.employeeCustody.findMany({
    where: whereClause,
    include: {
      employee: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate high-level summary KPIs
  let totalOpenAmountEGP = 0;
  let totalDeliveredAmountEGP = 0;
  let openCount = 0;
  let closedCount = 0;

  for (const c of custodies) {
    if (c.status === 'open') {
      openCount++;
      if (c.currency === 'EGP') {
        totalOpenAmountEGP += Number(c.currentAmount);
      }
    } else {
      closedCount++;
    }

    if (c.currency === 'EGP') {
      totalDeliveredAmountEGP += Number(c.openingAmount) - Number(c.currentAmount);
    }
  }

  return NextResponse.json({
    success: true,
    data: custodies,
    summary: {
      totalCustodies: custodies.length,
      openCount,
      closedCount,
      totalOpenAmountEGP,
      totalDeliveredAmountEGP,
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تسليم العهد النقدية مقتصرة على المدير المالي أو المحاسب' },
      { status: 403 }
    );
  }

  try {
    const { employeeId, amount, currency = 'EGP', sourceAccountId, businessDate, notes } = await req.json();

    const dAmount = new Decimal(amount || 0);
    if (dAmount.isNaN() || dAmount.lessThanOrEqualTo(0)) {
      return NextResponse.json(
        { error: 'مبلغ العهدة مطلوب ويجب أن يكون رقماً موجباً أكبر من صفر' },
        { status: 400 }
      );
    }

    if (!employeeId) {
      return NextResponse.json({ error: 'الموظف المستلم للعهدة مطلوب' }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    if (employee.status !== 'active') {
      return NextResponse.json(
        { error: 'لا يمكن تسليم عهدة نقدية لموظف موقوف أو غير نشط' },
        { status: 400 }
      );
    }

    // Determine target cash safe (source account)
    let sourceSafe: any;
    if (sourceAccountId) {
      sourceSafe = await prisma.account.findUnique({ where: { id: sourceAccountId } });
      if (!sourceSafe) {
        return NextResponse.json({ error: 'الصندوق المصدر المحدد غير موجود' }, { status: 404 });
      }
    } else {
      // Default to 1010 for EGP, 1020 for SDG
      const defaultCode = currency === 'SDG' ? '1020' : '1010';
      sourceSafe = await prisma.account.findFirst({
        where: { accountCode: defaultCode },
      });
      if (!sourceSafe) {
        sourceSafe = await prisma.account.findFirst({
          where: { accountType: 'cash_safe', currency },
        });
      }
    }

    if (!sourceSafe) {
      return NextResponse.json(
        { error: `لم يتم العثور على خزينة نقدية مهيأة لعملة (${currency})` },
        { status: 400 }
      );
    }

    if (sourceSafe.currency !== currency) {
      return NextResponse.json(
        { error: `عملة الخزينة المصدر (${sourceSafe.currency}) تختلف عن عملة العهدة المطلوبة (${currency})` },
        { status: 400 }
      );
    }

    const bDate = getSystemBusinessDate(businessDate);
    await assertBusinessDateOpen(bDate);

    // Fully Atomic Execution within a single Prisma Transaction
    const result = await prisma.$transaction(async (tx) => {
      // 0. Verify that the business date is open and not frozen
      await assertBusinessDateOpen(bDate, tx);

      // 1. Row-level lock on source safe account to prevent overdraft and race conditions
      const lockedSafeRows = await tx.$queryRawUnsafe<any[]>(
        'SELECT id, "accountCode", "name", "accountType", "currency", "currentBalance" FROM "Account" WHERE id = $1 FOR UPDATE',
        sourceSafe.id
      );

      if (!lockedSafeRows || lockedSafeRows.length === 0) {
        throw new Error('الخزينة المصدر غير موجودة');
      }

      const lockedSafe = lockedSafeRows[0];
      const safeBal = new Decimal(lockedSafe.currentBalance.toString());

      if (safeBal.lessThan(dAmount)) {
        throw new Error(
          `رصيد ${lockedSafe.name} (${safeBal.toFixed(2)} ${lockedSafe.currency}) غير كافٍ لتسليم عهدة بمبلغ ${dAmount.toFixed(2)} ${currency}`
        );
      }

      // 2. Find or create custody account for this employee and currency
      let custodyAccount = await tx.account.findFirst({
        where: {
          accountType: 'employee_custody',
          currency,
          name: { contains: employee.name },
        },
      });

      if (!custodyAccount) {
        // Fallback to general custody account 1050 or create one
        custodyAccount = await tx.account.findFirst({
          where: { accountCode: '1050' },
        });

        if (!custodyAccount) {
          const count = await tx.account.count({ where: { accountType: 'employee_custody' } });
          custodyAccount = await tx.account.create({
            data: {
              accountCode: `105${(count + 1).toString().padStart(2, '0')}`,
              name: `عهدة الموظف: ${employee.name} (${currency})`,
              accountType: 'employee_custody',
              currency,
              openingBalance: 0,
              currentBalance: 0,
              status: 'active',
            },
          });
        }
      }

      // 3. Create Employee Custody record
      const custody = await tx.employeeCustody.create({
        data: {
          employeeId: employee.id,
          accountId: custodyAccount.id,
          currency,
          openingAmount: dAmount.toNumber(),
          currentAmount: dAmount.toNumber(),
          businessDate: bDate,
          status: 'open',
          issuedBy: user.name,
        },
      });

      // 4. Post Double-Entry Ledger Entry (Debit Custody Asset, Credit Safe Asset) inside same tx
      await postLedgerTransaction({
        entryType: 'custody_issuance',
        referenceType: 'EmployeeCustody',
        referenceId: custody.id,
        entryDate: bDate,
        description: `تسليم عهدة نقدية للموظف ${employee.name} بمبلغ ${dAmount.toFixed(2)} ${currency} من ${lockedSafe.name}${notes ? ` (${notes})` : ''}`,
        createdBy: user.name,
        tx,
        lines: [
          {
            accountId: custodyAccount.id,
            currency,
            debit: dAmount.toNumber(),
            credit: 0,
            description: `تسليم عهدة نقدية للموظف ${employee.name}`,
          },
          {
            accountId: lockedSafe.id,
            currency,
            debit: 0,
            credit: dAmount.toNumber(),
            description: `صرف من ${lockedSafe.name} لعهدة ${employee.name}`,
          },
        ],
      });

      // 5. Record initial custody transaction (safe refill)
      const custodyTxn = await tx.custodyTransaction.create({
        data: {
          custodyId: custody.id,
          transactionType: 'safe_refill',
          amount: dAmount.toNumber(),
          currency,
          accountId: lockedSafe.id,
          referenceNumber: `CUST-INIT-${Date.now()}`,
          description: `استلام عهدة نقدية أولية من ${lockedSafe.name}${notes ? ` - ${notes}` : ''}`,
          createdBy: user.name,
        },
      });

      // Record Audit Log inside the same atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'ISSUE_CUSTODY',
        entityType: 'EmployeeCustody',
        entityId: custody.id,
        newValues: {
          employee: employee.name,
          amount: dAmount.toNumber(),
          currency,
          sourceSafe: lockedSafe.name,
        },
        reason: `تسليم عهدة نقدية رسمية للموظف ${employee.name}`,
        tx,
      });

      return { custody, custodyTxn, safeName: lockedSafe.name };
    });

    return NextResponse.json({ success: true, data: result.custody }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تسليم العهدة' }, { status: 500 });
  }
}

