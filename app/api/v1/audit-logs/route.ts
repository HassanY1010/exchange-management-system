import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const entityType = searchParams.get('entityType');

  const whereClause: any = {};
  if (action) whereClause.action = action;
  if (entityType) whereClause.entityType = entityType;

  const logs = await prisma.auditLog.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return NextResponse.json({ success: true, data: logs });
}
