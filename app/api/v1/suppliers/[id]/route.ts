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

  const supplier = await prisma.supplier.findUnique({
    where: { id: params.id },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!supplier) {
    return NextResponse.json({ error: 'المورد غير موجود' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: supplier });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { error: 'صلاحية تعديل بيانات المورد مقتصرة على المدير والمحاسب' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { name, phone, whatsapp, address, notes, status } = body;

    const existingSupplier = await prisma.supplier.findUnique({
      where: { id: params.id },
    });

    if (!existingSupplier) {
      return NextResponse.json({ error: 'المورد غير موجود' }, { status: 404 });
    }

    // Phone uniqueness check if changed
    if (phone && phone.trim() !== existingSupplier.phone) {
      const duplicatePhone = await prisma.supplier.findFirst({
        where: { phone: phone.trim(), id: { not: params.id } },
      });
      if (duplicatePhone) {
        return NextResponse.json({ error: 'رقم الهاتف مسجل لمورد آخر بالفعل' }, { status: 400 });
      }
    }

    const updated = await prisma.supplier.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        phone: phone !== undefined ? phone.trim() : undefined,
        whatsapp: whatsapp !== undefined ? whatsapp.trim() : undefined,
        address: address !== undefined ? address.trim() : undefined,
        notes: notes !== undefined ? notes.trim() : undefined,
        status: status !== undefined ? status : undefined,
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_SUPPLIER',
      entityType: 'Supplier',
      entityId: params.id,
      oldValues: existingSupplier,
      newValues: updated,
      reason: `تعديل بيانات المورد ${updated.name}`,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في تحديث بيانات المورد' }, { status: 500 });
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
      { error: 'صلاحية حذف المورد مقتصرة على المدير العام فقط' },
      { status: 403 }
    );
  }

  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: params.id },
      include: {
        transactions: true,
      },
    });

    if (!supplier) {
      return NextResponse.json({ error: 'المورد غير موجود' }, { status: 404 });
    }

    // Financial Protection: NEVER delete a supplier with transaction history!
    if (supplier.transactions.length > 0) {
      return NextResponse.json(
        {
          error: `لا يجوز حذف مورد مسجل له عمليات تداول تاريخية (${supplier.transactions.length} عملية) لحماية قيود الدفتر المحاسبي. يرجى إيقاف حسابه (تعيين الحالة إلى معطل) بدلاً من الحذف.`,
        },
        { status: 400 }
      );
    }

    await prisma.supplier.delete({
      where: { id: params.id },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'DELETE_SUPPLIER',
      entityType: 'Supplier',
      entityId: params.id,
      oldValues: supplier,
      reason: `حذف المورد ${supplier.name} لعدم وجود أي عمليات تداول مرتبطة به`,
    });

    return NextResponse.json({
      success: true,
      message: 'تم حذف المورد بنجاح',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في حذف المورد' }, { status: 500 });
  }
}
