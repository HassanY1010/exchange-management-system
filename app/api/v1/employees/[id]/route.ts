import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
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
  });

  if (!employee) {
    return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: employee });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تعديل بيانات الموظف مقتصرة على المدير والمحاسب' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { name, phone, identityNumber, jobTitle, status, userId } = body;

    const existingEmployee = await prisma.employee.findUnique({
      where: { id: params.id },
      include: {
        custodies: {
          where: { status: 'open' },
        },
      },
    });

    if (!existingEmployee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // Safety check: if deactivating employee, warn or check open custodies
    if (status === 'inactive' && existingEmployee.custodies.length > 0) {
      return NextResponse.json(
        {
          error: `لا يمكن إيقاف الموظف ولديه ${existingEmployee.custodies.length} عهدة نقدية مفتوحة. يجب تسوية وإغلاق جميع العهد أولاً.`,
        },
        { status: 400 }
      );
    }

    // Phone uniqueness check if changed
    if (phone && phone.trim() !== existingEmployee.phone) {
      const duplicatePhone = await prisma.employee.findFirst({
        where: { phone: phone.trim(), id: { not: params.id } },
      });
      if (duplicatePhone) {
        return NextResponse.json({ error: 'رقم الهاتف مسجل لموظف آخر بالفعل' }, { status: 400 });
      }
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        phone: phone !== undefined ? phone.trim() : undefined,
        identityNumber: identityNumber !== undefined ? identityNumber.trim() : undefined,
        jobTitle: jobTitle !== undefined ? jobTitle.trim() : undefined,
        status: status !== undefined ? status : undefined,
        userId: userId !== undefined ? userId : undefined,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_EMPLOYEE',
      entityType: 'Employee',
      entityId: params.id,
      oldValues: existingEmployee,
      newValues: updatedEmployee,
      reason: `تعديل بيانات الموظف ${updatedEmployee.name}`,
    });

    return NextResponse.json({ success: true, data: updatedEmployee });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تحديث بيانات الموظف' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'صلاحية حذف الموظف مقتصرة على المدير العام فقط' },
      { status: 403 }
    );
  }

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: params.id },
      include: {
        custodies: true,
      },
    });

    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // Financial protection: NEVER delete employee who has custodies or historical financial operations!
    if (employee.custodies.length > 0) {
      return NextResponse.json(
        {
          error: `لا يجوز حذف موظف لديه سجلات عهد نقدية تاريخية (${employee.custodies.length} عهدة) حفاظاً على سلامة الدفاتر المحاسبية. يرجى إيقاف حسابه (تعيين الحالة إلى موقوف) بدلاً من ذلك.`,
        },
        { status: 400 }
      );
    }

    // Check exchange transactions
    const txn = await prisma.exchangeTransaction.findFirst({
      where: { employeeId: params.id },
    });
    if (txn) {
      return NextResponse.json(
        {
          error: 'لا يجوز حذف موظف مرتبط بمعاملات صرافة مالية سابقة. يمكنك إيقاف حالته بدلاً من الحذف.',
        },
        { status: 400 }
      );
    }

    await prisma.employee.delete({
      where: { id: params.id },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'DELETE_EMPLOYEE',
      entityType: 'Employee',
      entityId: params.id,
      oldValues: employee,
      reason: `حذف الموظف ${employee.name} لعدم وجود أي ارتباطات مالية`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم حذف الموظف بنجاح',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في حذف الموظف' }, { status: 500 });
  }
}
