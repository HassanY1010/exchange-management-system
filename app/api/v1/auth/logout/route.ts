import { NextRequest, NextResponse } from 'next/server';
import { POST as logoutPost } from '../me/route';

export async function POST(req: NextRequest) {
  return logoutPost(req);
}
