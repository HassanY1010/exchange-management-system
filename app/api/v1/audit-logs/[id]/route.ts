import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { ensureDatabaseSchema, resetSchemaEnsuredFlag } from '@/lib/db-init';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const ALLOWED_ROLES = ['admin', 'auditor', 'general_manager'];
  if (!ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح لك بالوصول لسجل التدقيق الرقابي' },
      { status: 403 }
    );
  }

  const { id } = params;

  await ensureDatabaseSchema();

  let log;
  try {
    log = await prisma.auditLog.findUnique({
      where: { id },
    });
  } catch (err: any) {
    if (err?.code === 'P2022') {
      resetSchemaEnsuredFlag();
      await ensureDatabaseSchema();
      log = await prisma.auditLog.findUnique({
        where: { id },
      });
    } else {
      throw err;
    }
  }

  if (!log) {
    return NextResponse.json(
      { success: false, error: 'سجل التدقيق غير موجود' },
      { status: 404 }
    );
  }

  let enrichedUser = null;
  if (log.userId) {
    const u = await prisma.user.findUnique({
      where: { id: log.userId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (u) {
      const roleName =
        typeof u.role === 'object' && u.role !== null
          ? (u.role as any).name || (u.role as any).id || 'unknown'
          : (u.role || 'unknown');
      enrichedUser = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: roleName,
      };
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      ...log,
      user: enrichedUser || { id: log.userId || 'system', name: log.userId || 'النظام', role: 'unknown' },
      cairoCreatedAt: new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date(log.createdAt)),
    },
  });
}

export async function PUT() {
  return NextResponse.json(
    { success: false, error: 'سجل التدقيق الرقابي محمي وثابت برمجياً ولا يمكن تعديل أي سجل منه نهائياً' },
    { status: 405 }
  );
}

export async function PATCH() {
  return NextResponse.json(
    { success: false, error: 'سجل التدقيق الرقابي محمي وثابت برمجياً ولا يمكن تعديل أي سجل منه نهائياً' },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'سجل التدقيق الرقابي محمي وثابت برمجياً ولا يمكن حذف أي سجل منه نهائياً' },
    { status: 405 }
  );
}
