import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import {
  getSystemSettings,
  updateSystemSettings,
  SETTING_DEFINITIONS,
  validateSettingsUpdates,
} from '@/lib/settings/settings-service';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const ALLOWED_VIEW_ROLES = ['admin', 'general_manager', 'accountant', 'auditor'];
  if (!ALLOWED_VIEW_ROLES.includes(user.role)) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح لك بالاطلاع على إعدادات وتهيئة النظام' },
      { status: 403 }
    );
  }

  const settingsMap = await getSystemSettings();
  const canEdit = ['admin', 'general_manager'].includes(user.role);

  return NextResponse.json({
    success: true,
    data: settingsMap,
    definitions: SETTING_DEFINITIONS,
    canEdit,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  if (!['admin', 'general_manager'].includes(user.role)) {
    return NextResponse.json(
      { success: false, error: 'صلاحية تعديل إعدادات النظام مقتصرة على مدير النظام أو المدير العام فقط' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: 'صيغة البيانات المرسلة غير صالحة' },
        { status: 400 }
      );
    }

    const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1';

    const result = await updateSystemSettings(
      body,
      {
        userId: user.userId,
        name: user.name,
        role: user.role,
      },
      ipAddress
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'حدث خطأ أثناء حفظ الإعدادات' },
      { status: 400 }
    );
  }
}

export async function PUT(req: NextRequest) {
  return POST(req);
}
