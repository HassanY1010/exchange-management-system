import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get('unread') === 'true';
  const priority = searchParams.get('priority');

  const whereClause: any = {};

  // Role-based targeted notification routing
  if (user.role !== 'admin') {
    whereClause.OR = [
      { recipientRole: 'all' },
      { recipientRole: user.role },
      { recipientRole: null },
      { userId: user.userId },
    ];
  }

  if (unreadOnly) {
    whereClause.isRead = false;
  }
  if (priority) {
    whereClause.priority = priority;
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
    prisma.notification.count({
      where: {
        ...whereClause,
        isRead: false,
      },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: notifications,
    unreadCount,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const body = await req.json().catch(() => ({}));
  const { id } = body;

  if (id) {
    await prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  } else {
    // Mark all as read for this user/role
    const updateWhere: any = { isRead: false };
    if (user.role !== 'admin') {
      updateWhere.OR = [
        { recipientRole: 'all' },
        { recipientRole: user.role },
        { recipientRole: null },
        { userId: user.userId },
      ];
    }
    await prisma.notification.updateMany({
      where: updateWhere,
      data: { isRead: true, readAt: new Date() },
    });
  }

  return NextResponse.json({ success: true, message: 'تم تحديث حالة الإشعارات بنجاح' });
}
