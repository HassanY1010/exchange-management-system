import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { getLedgerDrilldown } from '@/lib/reports/financial-reports-service';

export async function GET(req: NextRequest) {
  // 1. RBAC Authentication & Authorization
  const user = await getUserFromRequest(req);
  if (!user) {
    return authError('يرجى تسجيل الدخول أولاً', 401);
  }

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح لك بالوصول إلى قيود دفتر الأستاذ. الصلاحية مقتصرة على الإدارة والمحاسبين.' },
      { status: 403 }
    );
  }

  // 2. Query Parameters
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId') || undefined;
  const accountClass = searchParams.get('accountClass') || undefined;
  const currency = searchParams.get('currency') || undefined;
  const fromDate = searchParams.get('fromDate') || undefined;
  const toDate = searchParams.get('toDate') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  // 3. Drill-down Query
  const data = await getLedgerDrilldown({
    accountId,
    accountClass,
    currency,
    fromDate,
    toDate,
    page,
    limit,
  });

  return NextResponse.json({
    success: true,
    data,
  });
}
