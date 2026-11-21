import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';

  const whereClause: any = {};
  if (status) {
    whereClause.status = status;
  }
  if (search) {
    whereClause.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
      { customerCode: { contains: search } },
      { identityNumber: { contains: search } },
    ];
  }

  const customers = await prisma.customer.findMany({
    where: whereClause,
    include: {
      sessions: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      _count: {
        select: {
          sessions: true,
          receipts: true,
          transactions: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: customers });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  try {
    const body = await req.json();
    const { name, phone, secondaryPhone, whatsapp, identityNumber, address, city, notes } = body;

    if (!name || !phone) {
      return NextResponse.json({ error: 'الاسم ورقم الهاتف مطلوبان' }, { status: 400 });
    }

    // Auto-generate customer code
    const count = await prisma.customer.count();
    const customerCode = `CUST-${1000 + count + 1}`;

    const customer = await prisma.customer.create({
      data: {
        customerCode,
        name,
        phone,
        secondaryPhone,
        whatsapp: whatsapp || phone,
        identityNumber,
        address,
        city,
        notes,
        status: 'active',
      },
    });

    await logAuditEvent({
      userId: user.userId,
      action: 'CREATE_CUSTOMER',
      entityType: 'Customer',
      entityId: customer.id,
      newValues: customer,
      reason: 'إضافة عميل جديد للنظام',
    });

    return NextResponse.json({ success: true, data: customer }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating customer:', error);
    return NextResponse.json({ error: error.message || 'خطأ في إنشاء العميل' }, { status: 500 });
  }
}
