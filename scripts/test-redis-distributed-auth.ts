import { redis } from '../lib/redis';
import { prisma } from '../lib/db';
import {
  generateToken,
  verifyToken,
  revokeToken,
  isTokenRevoked,
  clearMemoryBlacklist,
  getUserFromRequest,
} from '../lib/auth';
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  clearMemoryRateLimits,
} from '../lib/rate-limit';
import { POST as loginPost } from '../app/api/v1/auth/login/route';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`✅ PASSED: ${msg}`);
    passed++;
  } else {
    console.error(`❌ FAILED: ${msg}`);
    failed++;
  }
}

async function main() {
  console.log('================================================================');
  console.log('   DISTRIBUTED REDIS & POSTGRESQL PRODUCTION AUTH AUDIT        ');
  console.log('================================================================\n');

  assert(redis !== null, 'Redis connection is active and configured in production');

  // ========================================================================
  // 1. RATE LIMITING: REDIS DISTRIBUTED CLUSTER & RESTART PERSISTENCE
  // ========================================================================
  console.log('\n--- 1. Testing Distributed Rate Limiting Across Instances & Restarts ---');

  const testIp = '10.99.88.77';
  const testEmail = 'dist_test_user@exchange.com';
  const ipKey = `ip:${testIp}`;
  const emailKey = `email:${testEmail}`;

  // Reset before starting
  await resetRateLimit(ipKey);
  await resetRateLimit(emailKey);

  // Step A: Record failed attempts via Redis
  console.log('Recording 3 failed attempts from Instance A...');
  await recordFailedAttempt(ipKey, 900);
  await recordFailedAttempt(ipKey, 900);
  await recordFailedAttempt(ipKey, 900);

  // Verify stored in Redis directly
  const redisVal = await redis!.get(`ratelimit:login:${ipKey}`);
  const redisTtl = await redis!.ttl(`ratelimit:login:${ipKey}`);
  assert(redisVal === '3', `Redis stored exact count of 3 failed attempts (got ${redisVal})`);
  assert(redisTtl > 0 && redisTtl <= 900, `Redis key has proper TTL: ${redisTtl}s`);

  // Step B: Simulate Server Restart / Instance Switch (Wipe in-memory cache)
  console.log('Simulating server restart / Instance switch (clearing memory)...');
  clearMemoryRateLimits();

  // Step C: Verify Instance B reads the persisted count from Redis without reset
  const checkFromInstanceB = await checkRateLimit(ipKey, 5, 900);
  assert(
    checkFromInstanceB.totalAttempts === 3,
    `Instance B retained count 3 from Redis after restart (No zeroing out!)`
  );
  assert(checkFromInstanceB.remainingAttempts === 2, `Instance B shows remainingAttempts: 2`);
  assert(checkFromInstanceB.allowed === true, `Under threshold (3 < 5), request still allowed`);

  // Step D: Add 2 more attempts to reach lockout
  await recordFailedAttempt(ipKey, 900);
  await recordFailedAttempt(ipKey, 900);

  // Wipe memory again to test cold lockout verification from Redis
  clearMemoryRateLimits();
  const lockedCheck = await checkRateLimit(ipKey, 5, 900);
  assert(lockedCheck.allowed === false, `Rate limit triggered in Redis (5 >= 5)`);
  assert(lockedCheck.remainingAttempts === 0, `remainingAttempts is 0`);
  assert(
    (lockedCheck.retryAfterSeconds || 0) > 0,
    `retryAfterSeconds returned from Redis TTL: ${lockedCheck.retryAfterSeconds}s`
  );

  // Clean up
  await resetRateLimit(ipKey);
  await resetRateLimit(emailKey);
  const cleanedVal = await redis!.get(`ratelimit:login:${ipKey}`);
  assert(cleanedVal === null, 'Rate limit key cleanly removed on reset');

  // ========================================================================
  // 2. JWT REVOCATION: PERSISTENT BLACKLIST ACROSS INSTANCES & RESTARTS
  // ========================================================================
  console.log('\n--- 2. Testing Distributed JWT Revocation & Restart Persistence ---');

  // Step A: Generate JWT and inspect JTI and TTL
  const tokenPayload = {
    userId: 'user-uuid-1234',
    email: 'admin@exchange.com',
    name: 'المدير العام',
    role: 'admin',
  };
  const token = generateToken(tokenPayload);
  const decoded = jwt.decode(token) as any;

  assert(typeof decoded.jti === 'string' && decoded.jti.length > 10, `JWT contains unique cryptographically random JTI: ${decoded.jti}`);
  assert(typeof decoded.exp === 'number' && typeof decoded.iat === 'number', `JWT contains exp and iat timestamps`);
  const lifespanDays = (decoded.exp - decoded.iat) / (24 * 3600);
  assert(lifespanDays === 7, `JWT validity is exactly 7 days (${lifespanDays} days)`);

  // Verify token is initially valid before revocation
  const dummyReq = new NextRequest('http://localhost:3000/api/v1/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  const userBeforeRevoke = await getUserFromRequest(dummyReq);
  assert(userBeforeRevoke !== null && userBeforeRevoke.email === tokenPayload.email, 'Token is valid and authenticated initially');

  // Step B: Revoke Token (Simulate Logout on Instance A)
  console.log('Revoking token on Instance A...');
  await revokeToken(token);

  // Step C: Verify revocation key exists in Redis
  const tokenHashKey = `revoked_jti:${decoded.jti}`;
  const redisRevokedVal = await redis!.get(tokenHashKey);
  const redisRevokedTtl = await redis!.ttl(tokenHashKey);
  assert(redisRevokedVal === '1', `Token JTI found in shared Redis blacklist (got: ${redisRevokedVal})`);
  assert(redisRevokedTtl > 0 && redisRevokedTtl <= 7 * 24 * 3600, `Revocation TTL in Redis matches JWT lifetime (${redisRevokedTtl}s remaining)`);

  // Step D: Simulate Server Restart / Hand-off to Instance B (Wipe local memory)
  console.log('Simulating server restart / Instance switch (wiping local memory blacklist)...');
  clearMemoryBlacklist();

  // Step E: Verify Instance B rejects the revoked token using Redis
  const isRevokedOnInstanceB = await isTokenRevoked(token, decoded.jti);
  assert(isRevokedOnInstanceB === true, 'Instance B detects token as REVOKED from Redis blacklist after memory wipe');

  const userAfterRestart = await getUserFromRequest(dummyReq);
  assert(userAfterRestart === null, 'getUserFromRequest returns null for revoked token on fresh server instance');

  // Clean up Redis test keys
  await redis!.del(tokenHashKey);

  // ========================================================================
  // 3. COOKIE ATTRIBUTES INSPECTION IN PRODUCTION ENVIRONMENT
  // ========================================================================
  console.log('\n--- 3. Testing Cookie Secure and Security Attributes ---');

  // Temporarily set NODE_ENV to production to test production cookie generation
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const prodLoginReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@exchange.com', password: 'admin123' }),
  });

  const prodLoginRes = await loginPost(prodLoginReq);
  const prodCookie = prodLoginRes.cookies.get('auth_token');

  assert(prodCookie !== undefined, 'auth_token cookie present in login response');
  assert(prodCookie?.httpOnly === true, 'Cookie has HttpOnly=true (prevents XSS access)');
  assert(prodCookie?.secure === true, 'Cookie has Secure=true in Production (prevents plaintext transmission)');
  assert(prodCookie?.sameSite?.toLowerCase() === 'lax', 'Cookie has SameSite=lax (prevents CSRF)');
  assert(prodCookie?.path === '/', 'Cookie path is root (/)');

  // Restore original environment
  process.env.NODE_ENV = originalEnv;

  // ========================================================================
  // 4. SUMMARY
  // ========================================================================
  console.log('\n================================================================');
  console.log(`   TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('Test execution error:', e);
    process.exit(1);
  })
  .finally(() => {
    if (redis) redis.disconnect();
    prisma.$disconnect();
  });
