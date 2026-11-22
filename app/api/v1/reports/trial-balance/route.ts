import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getReportsDateRange, getTrialBalanceReport } from '@/lib/reports/financial-reports-service';

export async function GET(req: NextRequest) {
  // 1. RBAC Authentication & Authorization
  const user = await getUserFromRequest(req);
  if (!user) {
    return authError('يرجى تسجيل الدخول أولاً', 401);
  }

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح لك بالوصول إلى ميزان المراجعة. الصلاحية مقتصرة على الإدارة والمحاسبين.' },
      { status: 403 }
    );
  }

  // 2. Query Parameters & Timezone
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || 'month';
  const customFrom = searchParams.get('fromDate');
  const customTo = searchParams.get('toDate');
  const currency = searchParams.get('currency') || undefined;

  const tzSetting = await prisma.setting.findUnique({ where: { key: 'timezone' } }).catch(() => null);
  const timeZone = tzSetting?.value || 'Africa/Cairo';

  // 3. Resolve Date Range
  const dateRange = getReportsDateRange(period, customFrom, customTo, timeZone);

  // 4. Generate Trial Balance Report
  const report = await getTrialBalanceReport({
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
    currency,
    timeZone,
  });

  return NextResponse.json({
    success: true,
    data: {
      period: dateRange.period,
      timeZone,
      ...report,
    },
  });
}
