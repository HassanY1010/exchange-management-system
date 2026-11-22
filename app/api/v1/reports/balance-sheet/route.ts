import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getSystemBusinessDate } from '@/lib/financial-core';
import { getBalanceSheetReport } from '@/lib/reports/financial-reports-service';

export async function GET(req: NextRequest) {
  // 1. RBAC Authentication & Authorization
  const user = await getUserFromRequest(req);
  if (!user) {
    return authError('يرجى تسجيل الدخول أولاً', 401);
  }

  if (!['admin', 'accountant'].includes(user.role)) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح لك بالوصول إلى الميزانية العمومية. الصلاحية مقتصرة على الإدارة والمحاسبين.' },
      { status: 403 }
    );
  }

  // 2. Query Parameters & Timezone
  const { searchParams } = new URL(req.url);
  const tzSetting = await prisma.setting.findUnique({ where: { key: 'timezone' } }).catch(() => null);
  const timeZone = tzSetting?.value || 'Africa/Cairo';

  const asOfDate = searchParams.get('asOfDate') || searchParams.get('toDate') || getSystemBusinessDate(new Date(), timeZone);
  const currency = searchParams.get('currency') || undefined;

  // 3. Generate Balance Sheet Report
  const report = await getBalanceSheetReport({
    asOfDate,
    currency,
    timeZone,
  });

  return NextResponse.json({
    success: true,
    data: {
      timeZone,
      ...report,
    },
  });
}
