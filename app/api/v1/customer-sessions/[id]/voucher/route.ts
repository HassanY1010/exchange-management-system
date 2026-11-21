import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const voucher = await prisma.cashPayoutVoucher.findFirst({
    where: { customerSessionId: params.id },
    include: {
      customer: true,
      customerSession: {
        include: {
          receipts: { where: { status: 'approved' } },
        },
      },
    },
  });

  if (!voucher) {
    return NextResponse.json({ error: 'لم يتم العثور على سند صرف نقدية لهذه الجلسة' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: voucher,
  });
}
