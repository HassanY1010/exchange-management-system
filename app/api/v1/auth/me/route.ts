import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, authError } from '@/lib/auth';
import { prisma } from '@/lib/db';

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

export async function POST() {
  const res = NextResponse.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
  res.cookies.delete('auth_token');
  return res;
}
