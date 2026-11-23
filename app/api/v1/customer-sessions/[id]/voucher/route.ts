import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { getSystemSettings } from '@/lib/settings/settings-service';

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

  const settings = await getSystemSettings();

  return NextResponse.json({
    success: true,
    data: {
      ...voucher,
      company: {
        name: settings.company_name || 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)',
        logo: settings.company_logo || '/brand/logo.png',
        phone: settings.company_phone || '+20 100 000 0000',
        address: settings.company_address || 'القاهرة، جمهورية مصر العربية',
        taxNumber: settings.company_tax_number || '100-200-300',
      },
    },
  });
}
