import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError, revokeToken } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const userPayload = await getUserFromRequest(req);
  if (!userPayload) {
    return authError();
  }

  const user = await prisma.user.findUnique({
    where: { id: userPayload.userId },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  if (!user) {
    return authError('المستخدم غير موجود');
  }

  // Prevent active sessions for suspended or inactive accounts
  if (user.status !== 'active') {
    const res = NextResponse.json(
      { error: 'هذا الحساب معطل أو موقوف من قبل الإدارة', success: false },
      { status: 403 }
    );
    res.cookies.set('auth_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
    });
    return res;
  }

  return NextResponse.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      permissions: user.role.permissions.map((p) => p.permission.key),
    },
  });
}

export async function POST(req: NextRequest) {
  const userPayload = await getUserFromRequest(req);
  const authHeader = req.headers.get('authorization');
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies.get('auth_token')?.value) {
    token = req.cookies.get('auth_token')!.value;
  }

  // Revoke token immediately so it cannot be reused
  if (token) {
    await revokeToken(token);
  }

  if (userPayload) {
    await logAuditEvent({
      userId: userPayload.userId,
      action: 'USER_LOGOUT',
      entityType: 'User',
      entityId: userPayload.userId,
      newValues: { email: userPayload.email, role: userPayload.role },
      reason: 'تسجيل خروج المستخدم من النظام',
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1',
    });
  }

  const res = NextResponse.json({ success: true, message: 'تم تسجيل الخروج وإبطال الجلسة بنجاح' });
  res.cookies.set('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    sameSite: 'lax',
  });
  return res;
}
