import { prisma } from '../lib/db';
import { POST as loginPost } from '../app/api/v1/auth/login/route';
import { GET as meGet, POST as logoutPost } from '../app/api/v1/auth/me/route';
import { GET as auditLogsGet } from '../app/api/v1/audit-logs/route';
import { GET as settingsGet } from '../app/api/v1/settings/route';
import { NextRequest } from 'next/server';
import { getSafeRedirectUrl, isTokenRevoked } from '../lib/auth';
import { checkRateLimit, resetRateLimit } from '../lib/rate-limit';
import bcrypt from 'bcryptjs';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAILED: ${message}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('   PRODUCTION-GRADE AUTH & LOGIN AUDIT VERIFICATION (POSTGRESQL) ');
  console.log('================================================================\n');

  // Clean rate limits for test IPs and emails
  const testIp = '192.168.10.99';
  const testEmail = 'admin@exchange.com';
  await resetRateLimit(`ip:${testIp}`);
  await resetRateLimit(`email:${testEmail}`);

  // -------------------------------------------------------------
  // GROUP 1: Valid Login, Response Headers, Cookie, and Audit Log
  // -------------------------------------------------------------
  console.log('--- Group 1: Valid Login & Secure Cookie Generation ---');
  const validLoginReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': testIp,
    },
    body: JSON.stringify({ email: testEmail, password: 'admin123' }),
  });

  const validLoginRes = await loginPost(validLoginReq);
  const validLoginData = await validLoginRes.json();

  assert(validLoginRes.status === 200, 'Valid login returns HTTP 200');
  assert(validLoginData.success === true, 'Response contains success: true');
  assert(typeof validLoginData.token === 'string' && validLoginData.token.length > 20, 'Returns valid JWT token');
  assert(validLoginData.user?.role === 'admin', 'Returned user role matches DB role (admin)');

  const authCookie = validLoginRes.cookies.get('auth_token');
  assert(!!authCookie, 'auth_token cookie was set');
  assert(authCookie?.httpOnly === true, 'Cookie is HttpOnly');
  assert(authCookie?.path === '/', 'Cookie path is root (/)');
  assert(authCookie?.sameSite?.toLowerCase() === 'lax', 'Cookie sameSite is lax');

  // Verify Audit Log in DB
  const loginAudit = await prisma.auditLog.findFirst({
    where: { action: 'LOGIN', userId: validLoginData.user.id },
    orderBy: { createdAt: 'desc' },
  });
  assert(!!loginAudit, 'LOGIN event recorded in AuditLog table');
  assert(loginAudit?.entityType === 'User', 'Audit log entityType is User');
  assert(!JSON.stringify(loginAudit).includes('admin123'), 'Audit log contains NO plaintext password');

  // -------------------------------------------------------------
  // GROUP 2: Invalid Credentials & User Enumeration Protection
  // -------------------------------------------------------------
  console.log('\n--- Group 2: Invalid Credentials & Enumeration Protection ---');
  // Wrong password
  const wrongPassReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
    body: JSON.stringify({ email: testEmail, password: 'wrong_password_999' }),
  });
  const wrongPassRes = await loginPost(wrongPassReq);
  const wrongPassData = await wrongPassRes.json();

  assert(wrongPassRes.status === 401, 'Wrong password returns HTTP 401');
  assert(wrongPassData.error === 'البريد الإلكتروني أو كلمة المرور غير صحيحة', 'Generic error message for wrong password');

  // Non-existent email
  const ghostReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp },
    body: JSON.stringify({ email: 'ghost_user_does_not_exist@exchange.com', password: 'random_password' }),
  });
  const ghostRes = await loginPost(ghostReq);
  const ghostData = await ghostRes.json();

  assert(ghostRes.status === 401, 'Non-existent user returns HTTP 401');
  assert(
    ghostData.error === wrongPassData.error,
    'Identical error message returned for both wrong password and missing user (No User Enumeration)'
  );

  // -------------------------------------------------------------
  // GROUP 3: Inactive / Suspended Account Blocking
  // -------------------------------------------------------------
  console.log('\n--- Group 3: Inactive / Suspended Account Enforcement ---');
  // Create a temporary suspended user
  const suspendedEmail = 'suspended_test@exchange.com';
  const hashedPassword = await bcrypt.hash('secret123', 10);
  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });

  const suspendedUser = await prisma.user.upsert({
    where: { email: suspendedEmail },
    update: { status: 'suspended', passwordHash: hashedPassword },
    create: {
      name: 'مستخدم معطل تجريبي',
      email: suspendedEmail,
      status: 'suspended',
      passwordHash: hashedPassword,
      roleId: adminRole!.id,
    },
  });

  const suspendedLoginReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ email: suspendedEmail, password: 'secret123' }),
  });
  const suspendedLoginRes = await loginPost(suspendedLoginReq);
  const suspendedLoginData = await suspendedLoginRes.json();

  assert(suspendedLoginRes.status === 403, 'Suspended user login returns HTTP 403 Forbidden');
  assert(
    suspendedLoginData.error.includes('معطل أو موقوف'),
    'Correct Arabic error message returned for suspended account'
  );

  // Clean up test user
  await prisma.user.delete({ where: { id: suspendedUser.id } }).catch(() => {});

  // -------------------------------------------------------------
  // GROUP 4: Rate Limiting & Brute Force Lockout
  // -------------------------------------------------------------
  console.log('\n--- Group 4: Brute Force & Rate Limiting Enforcement ---');
  const bruteIp = '10.200.50.77';
  const bruteEmail = 'brute_target@exchange.com';
  await resetRateLimit(`ip:${bruteIp}`);
  await resetRateLimit(`email:${bruteEmail}`);

  // Trigger 5 failed attempts
  for (let i = 1; i <= 5; i++) {
    const req = new NextRequest('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': bruteIp },
      body: JSON.stringify({ email: bruteEmail, password: `wrong_${i}` }),
    });
    await loginPost(req);
  }

  // 6th attempt should be blocked by rate limiter
  const blockedReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': bruteIp },
    body: JSON.stringify({ email: bruteEmail, password: 'any_password' }),
  });
  const blockedRes = await loginPost(blockedReq);
  const blockedData = await blockedRes.json();

  assert(blockedRes.status === 429, '6th failed attempt returns HTTP 429 Too Many Requests');
  assert(blockedData.error.includes('تم تجاوز الحد المسموح'), 'Rate limit message returned in Arabic');
  assert(!!blockedRes.headers.get('Retry-After'), 'Retry-After header present in response');

  // Clean up rate limits
  await resetRateLimit(`ip:${bruteIp}`);
  await resetRateLimit(`email:${bruteEmail}`);

  // -------------------------------------------------------------
  // GROUP 5: Session Invalidation & Token Revocation on Logout
  // -------------------------------------------------------------
  console.log('\n--- Group 5: Session Invalidation & Token Revocation ---');
  const sessionUserToken = validLoginData.token;

  // 1. Verify token works before logout
  const meReqBefore = new NextRequest('http://localhost:3000/api/v1/auth/me', {
    headers: {
      cookie: `auth_token=${sessionUserToken}`,
      authorization: `Bearer ${sessionUserToken}`,
    },
  });
  const meResBefore = await meGet(meReqBefore);
  assert(meResBefore.status === 200, 'Authenticated request before logout returns HTTP 200');

  // 2. Perform Logout
  const logoutReq = new NextRequest('http://localhost:3000/api/v1/auth/me', {
    method: 'POST',
    headers: {
      cookie: `auth_token=${sessionUserToken}`,
      authorization: `Bearer ${sessionUserToken}`,
      'x-forwarded-for': testIp,
    },
  });
  const logoutRes = await logoutPost(logoutReq);
  assert(logoutRes.status === 200, 'Logout request returns HTTP 200');

  const clearedCookie = logoutRes.cookies.get('auth_token');
  assert(clearedCookie?.maxAge === 0, 'Cookie maxAge set to 0 to invalidate browser session');

  const isRevoked = await isTokenRevoked(sessionUserToken);
  assert(isRevoked === true, 'Token added to revocation blacklist');

  // 3. Verify token is rejected after logout (prevents token reuse)
  const meReqAfter = new NextRequest('http://localhost:3000/api/v1/auth/me', {
    headers: {
      cookie: `auth_token=${sessionUserToken}`,
      authorization: `Bearer ${sessionUserToken}`,
    },
  });
  const meResAfter = await meGet(meReqAfter);
  assert(meResAfter.status === 401, 'Request with revoked token returns HTTP 401 Unauthorized');

  // Verify USER_LOGOUT in audit logs
  const logoutAudit = await prisma.auditLog.findFirst({
    where: { action: 'USER_LOGOUT' },
    orderBy: { createdAt: 'desc' },
  });
  assert(!!logoutAudit, 'USER_LOGOUT event recorded in AuditLog table');

  // -------------------------------------------------------------
  // GROUP 6: Unauthenticated API Access Protection
  // -------------------------------------------------------------
  console.log('\n--- Group 6: Protected API Unauthenticated Access Rejection ---');
  const unauthAuditReq = new NextRequest('http://localhost:3000/api/v1/audit-logs');
  const unauthAuditRes = await auditLogsGet(unauthAuditReq);
  assert(unauthAuditRes.status === 401, 'Unauthenticated GET /api/v1/audit-logs returns HTTP 401');

  const unauthSettingsReq = new NextRequest('http://localhost:3000/api/v1/settings');
  const unauthSettingsRes = await settingsGet(unauthSettingsReq);
  assert(unauthSettingsRes.status === 401, 'Unauthenticated GET /api/v1/settings returns HTTP 401');

  // -------------------------------------------------------------
  // GROUP 7: RBAC Access Control Enforcement
  // -------------------------------------------------------------
  console.log('\n--- Group 7: RBAC Access Control Enforcement ---');
  const cashierLoginReq = new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'mohammed@exchange.com', password: 'admin123' }),
  });
  const cashierLoginRes = await loginPost(cashierLoginReq);
  const cashierLoginData = await cashierLoginRes.json();
  const cashierToken = cashierLoginData.token;

  assert(cashierLoginData.user?.role === 'custody_officer', 'Cashier user logged in with custody_officer role');

  const cashierAuditReq = new NextRequest('http://localhost:3000/api/v1/audit-logs', {
    headers: { cookie: `auth_token=${cashierToken}` },
  });
  const cashierAuditRes = await auditLogsGet(cashierAuditReq);
  assert(cashierAuditRes.status === 403, 'custody_officer role blocked from /api/v1/audit-logs with HTTP 403');

  const cashierSettingsReq = new NextRequest('http://localhost:3000/api/v1/settings', {
    headers: { cookie: `auth_token=${cashierToken}` },
  });
  const cashierSettingsRes = await settingsGet(cashierSettingsReq);
  assert(cashierSettingsRes.status === 403, 'custody_officer role blocked from /api/v1/settings with HTTP 403');

  // -------------------------------------------------------------
  // GROUP 8: Open Redirect Attack Prevention
  // -------------------------------------------------------------
  console.log('\n--- Group 8: Open Redirect Attack Prevention ---');
  assert(getSafeRedirectUrl('https://evil-attacker.com') === '/dashboard', 'Blocks external URL https://evil-attacker.com');
  assert(getSafeRedirectUrl('//evil-attacker.com') === '/dashboard', 'Blocks protocol-relative //evil-attacker.com');
  assert(getSafeRedirectUrl('/\\evil-attacker.com') === '/dashboard', 'Blocks backslash bypass /\\evil-attacker.com');
  assert(getSafeRedirectUrl('javascript:alert(document.cookie)') === '/dashboard', 'Blocks javascript: URI scheme');
  assert(getSafeRedirectUrl('data:text/html,<script>alert(1)</script>') === '/dashboard', 'Blocks data: URI scheme');
  assert(getSafeRedirectUrl('/customer-sessions') === '/customer-sessions', 'Allows valid internal relative path /customer-sessions');
  assert(
    getSafeRedirectUrl('/reports?tab=cash-flow&currency=USD') === '/reports?tab=cash-flow&currency=USD',
    'Allows valid internal relative path with query parameters'
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`   TOTAL TESTS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((e) => {
    console.error('Test runner fatal error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
