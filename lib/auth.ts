import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from './db';
import { NextRequest, NextResponse } from 'next/server';
import { redis } from './redis';

const JWT_SECRET = process.env.JWT_SECRET || 'exchange-system-secret-key-2026-production';

export interface TokenPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  jti?: string;
}

// In-memory token revocation cache
const revokedTokensMemory = new Map<string, number>();

/**
 * Revoke a token (used during logout or security invalidation)
 */
export async function revokeToken(token: string, ttlSeconds: number = 7 * 24 * 3600): Promise<void> {
  if (!token) return;
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  revokedTokensMemory.set(token, expiresAtMs);

  if (redis) {
    try {
      await redis.set(`revoked_jwt:${token}`, '1', 'EX', ttlSeconds);
    } catch {}
  }
}

/**
 * Check if a token has been revoked
 */
export async function isTokenRevoked(token: string): Promise<boolean> {
  if (!token) return true;

  // 1. Check in-memory
  const exp = revokedTokensMemory.get(token);
  if (exp) {
    if (exp > Date.now()) return true;
    revokedTokensMemory.delete(token);
  }

  // 2. Check Redis
  if (redis) {
    try {
      const exists = await redis.get(`revoked_jwt:${token}`);
      if (exists) return true;
    } catch {}
  }

  return false;
}

export function generateToken(payload: TokenPayload): string {
  const jti = payload.jti || crypto.randomUUID();
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: '7d' });
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

  // Check if token was explicitly revoked
  if (await isTokenRevoked(token)) {
    return null;
  }

  return verifyToken(token);
}

export function authError(message: string = 'غير مصرح لك بالوصول (يرجى تسجيل الدخول)', status = 401) {
  return NextResponse.json({ error: message, success: false }, { status });
}

export function authForbidden(message: string = 'ليس لديك صلاحية لتنفيذ هذا الإجراء', status = 403) {
  return NextResponse.json({ error: message, success: false }, { status });
}

export { getSafeRedirectUrl } from './redirect';
