import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { postLedgerTransaction } from '@/lib/accounting/accounting-service';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get('employeeId');
  const status = searchParams.get('status');

  const whereClause: any = {};
  if (employeeId) whereClause.employeeId = employeeId;
  if (status) whereClause.status = status;

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

  return NextResponse.json({ success: true, data: custodies });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { employeeId, amount, businessDate } = await req.json();

    if (!employeeId || !amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'الموظف ومبلغ العهدة مطلوبان ويجب أن يكون أكبر من صفر' }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // Find main EGP safe and custody account
    const mainSafe = await prisma.account.findFirst({
      where: { accountCode: '1010' },
    });
    const custodyAccount = await prisma.account.findFirst({
      where: {
        accountType: 'employee_custody',
        name: { contains: employee.name },
      },
    }) || await prisma.account.findFirst({
      where: { accountCode: '1050' },
    });

    if (!mainSafe || !custodyAccount) {
      throw new Error('الصندوق الرئيسي أو حساب العهدة غير مهيأ');
    }

    const safeBal = Number(mainSafe.currentBalance);
    if (safeBal < Number(amount)) {
      return NextResponse.json({
        error: `رصيد الصندوق الرئيسي (${safeBal.toLocaleString()} EGP) لا يكفي لتسليم عهدة بمبلغ ${Number(amount).toLocaleString()} EGP`,
      }, { status: 400 });
    }

    const bDate = businessDate || new Date().toISOString().split('T')[0];

    // Create Employee Custody
    const custody = await prisma.employeeCustody.create({
      data: {
        employeeId: employee.id,
        accountId: custodyAccount.id,
        currency: 'EGP',
        openingAmount: Number(amount),
        currentAmount: Number(amount),
        businessDate: bDate,
        status: 'open',
        issuedBy: user.name,
      },
    });

    // Record Ledger Entry (Debit Custody, Credit Safe)
    await postLedgerTransaction({
      entryType: 'custody_issuance',
      referenceType: 'EmployeeCustody',
      referenceId: custody.id,
      description: `تسليم عهدة نقدية للموظف ${employee.name} بمبلغ ${Number(amount).toLocaleString()} EGP`,
      createdBy: user.name,
      lines: [
        {
          accountId: custodyAccount.id,
          currency: 'EGP',
          debit: Number(amount),
          credit: 0,
          description: `تسليم عهدة للموظف ${employee.name}`,
        },
        {
          accountId: mainSafe.id,
          currency: 'EGP',
          debit: 0,
          credit: Number(amount),
          description: `صرف من الصندوق الرئيسي لعهدة ${employee.name}`,
        },
      ],
    });

    // Record initial custody transaction
    await prisma.custodyTransaction.create({
      data: {
        custodyId: custody.id,
        transactionType: 'safe_refill',
        amount: Number(amount),
        currency: 'EGP',
        accountId: mainSafe.id,
        referenceNumber: `CUST-INIT-${Date.now()}`,
        description: `استلام عهدة أولية من الصندوق الرئيسي`,
        createdBy: user.name,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'ISSUE_CUSTODY',
      entityType: 'EmployeeCustody',
      entityId: custody.id,
      newValues: { employee: employee.name, amount: Number(amount) },
      reason: `تسليم عهدة نقدية للموظف ${employee.name}`,
    });

    return NextResponse.json({ success: true, data: custody }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تسليم العهدة' }, { status: 500 });
  }
}
