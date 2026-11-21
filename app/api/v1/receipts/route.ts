import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const customerId = searchParams.get('customerId');
  const sessionId = searchParams.get('sessionId');
  const search = searchParams.get('search');

  const whereClause: any = {};
  if (status) whereClause.status = status;
  if (customerId) whereClause.customerId = customerId;
  if (sessionId) whereClause.customerSessionId = sessionId;
  if (search) {
    whereClause.OR = [
      { transactionId: { contains: search } },
      { senderName: { contains: search } },
      { receiverName: { contains: search } },
    ];
  }

  const receipts = await prisma.bankakReceipt.findMany({
    where: whereClause,
    include: {
      customer: true,
      customerSession: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ success: true, data: receipts });
}
