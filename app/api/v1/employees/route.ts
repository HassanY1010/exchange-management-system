import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const employees = await prisma.employee.findMany({
    include: {
      user: {
        select: { id: true, email: true, name: true, role: true },
      },
      custodies: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { transactions: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: employees });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { name, phone, identityNumber, jobTitle } = await req.json();

    if (!name || !phone) {
      return NextResponse.json({ error: 'الاسم ورقم الهاتف مطلوبان' }, { status: 400 });
    }

    const count = await prisma.employee.count();
    const employeeCode = `EMP-${(count + 1).toString().padStart(3, '0')}`;

    const employee = await prisma.employee.create({
      data: {
        employeeCode,
        name,
        phone,
        identityNumber,
        jobTitle: jobTitle || 'مسؤول تسليم نقدية',
        status: 'active',
      },
    });

    // Automatically create a dedicated custody account for this employee in chart of accounts
    await prisma.account.create({
      data: {
        accountCode: `105${count + 1}`,
        name: `عهدة الموظف: ${name}`,
        accountType: 'employee_custody',
        currency: 'EGP',
        openingBalance: 0,
        currentBalance: 0,
        status: 'active',
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_EMPLOYEE',
      entityType: 'Employee',
      entityId: employee.id,
      newValues: employee,
      reason: 'إضافة موظف جديد للنظام',
    });

    return NextResponse.json({ success: true, data: employee }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء الموظف' }, { status: 500 });
  }
}
