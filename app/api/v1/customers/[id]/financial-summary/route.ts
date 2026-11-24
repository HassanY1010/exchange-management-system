import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { getCustomerFinancialStatus } from '@/lib/customers/customer-balance-service';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const financialStatus = await getCustomerFinancialStatus(params.id);
  if (!financialStatus) {
    return NextResponse.json({ error: 'العميل غير موجود في النظام', success: false }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: financialStatus,
  });
}
