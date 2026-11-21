import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const settings = await prisma.setting.findMany();
  const settingsMap: Record<string, string> = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  return NextResponse.json({ success: true, data: settingsMap, list: settings });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحية تعديل الإعدادات مخصصة لمدير النظام فقط' }, { status: 403 });
  }

  try {
    const body = await req.json();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string') {
        await prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        });
      }
    }

    await logAuditEvent({
      userId: user.userId,
      action: 'UPDATE_SETTINGS',
      entityType: 'Setting',
      newValues: body,
      reason: 'تحديث إعدادات النظام',
    });

    return NextResponse.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'خطأ في حفظ الإعدادات' }, { status: 500 });
  }
}
