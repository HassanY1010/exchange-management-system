import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { NextRequest, NextResponse } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'exchange-system-secret-key-2026-production';

export interface TokenPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (e) {
    return null;
  }
}

export async function getUserFromRequest(req: NextRequest): Promise<TokenPayload | null> {
  const authHeader = req.headers.get('authorization');
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies.get('auth_token')?.value) {
    token = req.cookies.get('auth_token')!.value;
  } else {
    // Check query parameter for authenticated media requests (e.g. <img> tags or full screen window.open)
    const queryToken = req.nextUrl?.searchParams?.get('token');
    if (queryToken) token = queryToken;
  }

  if (!token) return null;
  return verifyToken(token);
}

export function authError(message: string = 'غير مصرح لك بالوصول (يرجى تسجيل الدخول)', status = 401) {
  return NextResponse.json({ error: message, success: false }, { status });
}
