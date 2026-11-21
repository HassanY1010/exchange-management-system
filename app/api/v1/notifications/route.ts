import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ success: true, data: notifications });
}

export async function PATCH(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { id } = await req.json();
  if (id) {
    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  } else {
    await prisma.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });
  }

  return NextResponse.json({ success: true });
}
