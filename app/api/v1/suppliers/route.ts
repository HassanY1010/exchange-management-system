import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const suppliers = await prisma.supplier.findMany({
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: {
        select: { transactions: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: suppliers });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const { name, phone, whatsapp, address, notes } = await req.json();

    if (!name || !phone) {
      return NextResponse.json({ error: 'اسم المورد ورقم الهاتف مطلوبان' }, { status: 400 });
    }

    const count = await prisma.supplier.count();
    const supplierCode = `SUP-${500 + count + 1}`;

    const supplier = await prisma.supplier.create({
      data: {
        supplierCode,
        name,
        phone,
        whatsapp: whatsapp || phone,
        address,
        notes,
        status: 'active',
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_SUPPLIER',
      entityType: 'Supplier',
      entityId: supplier.id,
      newValues: supplier,
      reason: 'إضافة مورد عملات جديد',
    });

    return NextResponse.json({ success: true, data: supplier }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء المورد' }, { status: 500 });
  }
}
