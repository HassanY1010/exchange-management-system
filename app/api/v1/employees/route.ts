import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search')?.trim();

  const whereClause: any = {};
  if (status) whereClause.status = status;
  if (search) {
    whereClause.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { employeeCode: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }

  const employees = await prisma.employee.findMany({
    where: whereClause,
    include: {
      user: {
        select: { id: true, email: true, name: true, role: true },
      },
      custodies: {
        orderBy: { createdAt: 'desc' },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Calculate detailed financial aggregates per employee
  const employeesWithStats = employees.map((emp) => {
    let totalCustodyIssued = 0;
    let activeCustodyBalance = 0;
    let totalDeliveredToCustomers = 0;
    let totalReturnedToSafe = 0;
    let openCustodiesCount = 0;

    for (const c of emp.custodies) {
      totalCustodyIssued += Number(c.openingAmount);
      if (c.status === 'open') {
        openCustodiesCount++;
        activeCustodyBalance += Number(c.currentAmount);
      }
      for (const t of c.transactions) {
        if (t.transactionType === 'delivery_to_customer') {
          totalDeliveredToCustomers += Number(t.amount);
        } else if (t.transactionType === 'return_to_safe') {
          totalReturnedToSafe += Number(t.amount);
        }
      }
    }

    return {
      ...emp,
      stats: {
        totalCustodyIssued,
        activeCustodyBalance,
        totalDeliveredToCustomers,
        totalReturnedToSafe,
        openCustodiesCount,
        allCustodiesCount: emp.custodies.length,
      },
    };
  });

  return NextResponse.json({ success: true, data: employeesWithStats });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية إضافة موظف مقتصرة على المدير والمحاسب' }, { status: 403 });
  }

  try {
    const { name, phone, identityNumber, jobTitle, userId } = await req.json();

    if (!name || !phone) {
      return NextResponse.json({ error: 'الاسم ورقم الهاتف مطلوبان' }, { status: 400 });
    }

    // Check duplicate phone
    const existingPhone = await prisma.employee.findFirst({
      where: { phone: phone.trim() },
    });
    if (existingPhone) {
      return NextResponse.json({ error: 'رقم الهاتف مسجل لموظف آخر بالفعل' }, { status: 400 });
    }

    const count = await prisma.employee.count();
    const employeeCode = `EMP-${(count + 1).toString().padStart(3, '0')}`;

    // Execute atomic creation of employee and dedicated custody account
    const result = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          employeeCode,
          name: name.trim(),
          phone: phone.trim(),
          identityNumber: identityNumber?.trim() || null,
          jobTitle: jobTitle?.trim() || 'مسؤول تسليم نقدية',
          status: 'active',
          userId: userId || null,
        },
      });

      // Automatically create a dedicated custody account for this employee in chart of accounts
      const custodyAccount = await tx.account.create({
        data: {
          accountCode: `105${(count + 1).toString().padStart(2, '0')}`,
          name: `عهدة الموظف: ${name.trim()}`,
          accountType: 'employee_custody',
          currency: 'EGP',
          openingBalance: 0,
          currentBalance: 0,
          status: 'active',
        },
      });

      // Record Audit Log inside the same atomic transaction
      await logAuditEvent({
        userId: user.userId,
        action: 'CREATE_EMPLOYEE',
        entityType: 'Employee',
        entityId: employee.id,
        newValues: {
          employee,
          custodyAccount: custodyAccount.accountCode,
        },
        reason: 'إضافة موظف جديد وإنشاء حساب عهدة مخصص',
        tx,
      });

      return { employee, custodyAccount };
    });

    return NextResponse.json({ success: true, data: result.employee }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء الموظف' }, { status: 500 });
  }
}
