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
  exp?: number;
  iat?: number;
}

// In-memory token revocation cache (process-local fallback)
const revokedTokensMemory = new Map<string, number>();

/**
 * Revoke a token (used during logout or security invalidation).
 * Persists to shared Redis with TTL matching the token's remaining lifetime.
 */
export async function revokeToken(token: string, customTtlSeconds?: number): Promise<void> {
  if (!token) return;
  let ttl = customTtlSeconds;
  let jti: string | undefined;

  try {
    const decoded = jwt.decode(token) as any;
    if (decoded) {
      if (decoded.jti) jti = decoded.jti;
      if (!ttl && decoded.exp) {
        const nowSec = Math.floor(Date.now() / 1000);
        ttl = Math.max(60, decoded.exp - nowSec);
      }
    }
  } catch {}

  if (!ttl) ttl = 7 * 24 * 3600;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAtMs = Date.now() + ttl * 1000;

  // 1. Process-local cache
  revokedTokensMemory.set(tokenHash, expiresAtMs);
  if (jti) revokedTokensMemory.set(`jti:${jti}`, expiresAtMs);

  // 2. Shared Redis (shared across all cluster instances and persistent across restarts)
  if (redis) {
    try {
      await redis.set(`revoked_token:${tokenHash}`, '1', 'EX', ttl);
      if (jti) {
        await redis.set(`revoked_jti:${jti}`, '1', 'EX', ttl);
      }
    } catch (err) {
      console.warn('Redis unavailable for revokeToken, falling back to local memory:', err);
    }
  }
}

/**
 * Check if a token has been revoked across Redis or local memory.
 */
export async function isTokenRevoked(token: string, jti?: string): Promise<boolean> {
  if (!token) return true;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = Date.now();

  // 1. Check process-local memory
  const exp = revokedTokensMemory.get(tokenHash) || (jti ? revokedTokensMemory.get(`jti:${jti}`) : undefined);
  if (exp) {
    if (exp > now) return true;
    revokedTokensMemory.delete(tokenHash);
    if (jti) revokedTokensMemory.delete(`jti:${jti}`);
  }

  // 2. Check shared Redis (cluster instances synchronization & restart persistence)
  if (redis) {
    try {
      const keysToCheck = [`revoked_token:${tokenHash}`];
      if (jti) keysToCheck.push(`revoked_jti:${jti}`);

      const results = await redis.mget(...keysToCheck);
      if (results.some((val) => val !== null)) {
        return true;
      }
    } catch (err) {
      console.warn('Redis check failed in isTokenRevoked, falling back to local memory:', err);
    }
  }

  return false;
}

/**
 * Cleans up process-local memory blacklist
 */
export function clearMemoryBlacklist(): void {
  revokedTokensMemory.clear();
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

  // 1. Verify token cryptographic signature and expiration first
  const payload = verifyToken(token);
  if (!payload) return null;

  // 2. Check if token or jti has been revoked in shared Redis or local blacklist
  if (await isTokenRevoked(token, payload.jti)) {
    return null;
  }

  return payload;
}

export function authError(message: string = 'غير مصرح لك بالوصول (يرجى تسجيل الدخول)', status = 401) {
  return NextResponse.json({ error: message, success: false }, { status });
}

export function authForbidden(message: string = 'ليس لديك صلاحية لتنفيذ هذا الإجراء', status = 403) {
  return NextResponse.json({ error: message, success: false }, { status });
}

export { getSafeRedirectUrl } from './redirect';
