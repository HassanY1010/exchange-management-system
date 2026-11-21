import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
  });

  if (!customer) {
    return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');

  const sessionsWhere: any = { customerId: customer.id };
  if (fromDate || toDate) {
    sessionsWhere.businessDate = {};
    if (fromDate) sessionsWhere.businessDate.gte = fromDate;
    if (toDate) sessionsWhere.businessDate.lte = toDate;
  }

  const sessions = await prisma.customerSession.findMany({
    where: sessionsWhere,
    include: {
      receipts: {
        where: { status: 'approved' },
      },
      transactions: true,
    },
    orderBy: { businessDate: 'desc' },
  });

  const companySetting = await prisma.setting.findUnique({
    where: { key: 'company_name' },
  });

  return NextResponse.json({
    success: true,
    statement: {
      companyName: companySetting?.value || 'منصة إدارة الصرافة والتحويلات المالية',
      customer: {
        code: customer.customerCode,
        name: customer.name,
        phone: customer.phone,
        whatsapp: customer.whatsapp,
        city: customer.city,
      },
      generatedAt: new Date().toISOString(),
      generatedBy: user.name,
      sessions,
    },
  });
}
