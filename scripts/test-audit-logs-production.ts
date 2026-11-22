import { prisma } from '../lib/db';
import { generateToken } from '../lib/auth';
import { logAuditEvent, sanitizeAuditData } from '../lib/audit';
import { GET as getAuditLogs, POST as postAuditLogs, PUT as putAuditLogs, DELETE as deleteAuditLogs } from '../app/api/v1/audit-logs/route';
import { GET as getSingleLog, PUT as putSingleLog, DELETE as deleteSingleLog } from '../app/api/v1/audit-logs/[id]/route';
import { POST as logoutPost } from '../app/api/v1/auth/me/route';
import { POST as createExpenseCategoryPost } from '../app/api/v1/expenses/categories/route';

function createMockReq(url: string, role?: string, method = 'GET') {
  const headers = new Headers();
  if (role) {
    const token = generateToken({
      userId: 'audit-test-admin',
      email: 'admin@exchange.com',
      name: 'Audit Administrator',
      role,
    });
    headers.set('authorization', `Bearer ${token}`);
  }

  return {
    method,
    url,
    headers,
    cookies: { get: () => undefined },
    nextUrl: new URL(url),
    json: async () => ({}),
  } as any;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runAuditLogsProductionTests() {
  console.log('================================================================');
  console.log('   AUDIT LOGS PRODUCTION-GRADE VERIFICATION (POSTGRESQL REAL)   ');
  console.log('================================================================');

  try {
    // -------------------------------------------------------------
    // 1. RBAC Access Control Enforcement
    // -------------------------------------------------------------
    console.log('\n--- Group 1: Strict RBAC Access Control ---');

    // 1.1 Unauthenticated -> 401
    const unauthReq = createMockReq('http://localhost:3000/api/v1/audit-logs');
    const resUnauth = await getAuditLogs(unauthReq);
    assert(resUnauth.status === 401, 'Unauthenticated request returns HTTP 401');

    // 1.2 Unauthorized roles -> 403
    const dataEntryReq = createMockReq('http://localhost:3000/api/v1/audit-logs', 'data_entry');
    const resDataEntry = await getAuditLogs(dataEntryReq);
    assert(resDataEntry.status === 403, 'Unauthorized role (data_entry) returns HTTP 403');

    const custodyOfficerReq = createMockReq('http://localhost:3000/api/v1/audit-logs', 'custody_officer');
    const resCustody = await getAuditLogs(custodyOfficerReq);
    assert(resCustody.status === 403, 'Unauthorized role (custody_officer) returns HTTP 403');

    const cashierReq = createMockReq('http://localhost:3000/api/v1/audit-logs', 'cashier');
    const resCashier = await getAuditLogs(cashierReq);
    assert(resCashier.status === 403, 'Unauthorized role (cashier) returns HTTP 403');

    // 1.3 Authorized roles -> 200
    const adminReq = createMockReq('http://localhost:3000/api/v1/audit-logs?limit=5', 'admin');
    const resAdmin = await getAuditLogs(adminReq);
    const dataAdmin = await resAdmin.json();
    assert(resAdmin.status === 200 && dataAdmin.success === true, 'Admin access returns HTTP 200 with data');

    const auditorReq = createMockReq('http://localhost:3000/api/v1/audit-logs?limit=5', 'auditor');
    const resAuditor = await getAuditLogs(auditorReq);
    assert(resAuditor.status === 200, 'Auditor access returns HTTP 200 with data');

    // -------------------------------------------------------------
    // 2. Immutability & Anti-Tampering (405 Method Not Allowed)
    // -------------------------------------------------------------
    console.log('\n--- Group 2: Immutability & Tampering Protection ---');

    const postRes = await postAuditLogs(createMockReq('http://localhost:3000/api/v1/audit-logs', 'admin', 'POST'));
    assert(postRes.status === 405, 'POST to audit-logs returns HTTP 405 (No manual creation)');

    const putRes = await putAuditLogs(createMockReq('http://localhost:3000/api/v1/audit-logs', 'admin', 'PUT'));
    assert(putRes.status === 405, 'PUT to audit-logs returns HTTP 405 (No modification)');

    const deleteRes = await deleteAuditLogs(createMockReq('http://localhost:3000/api/v1/audit-logs', 'admin', 'DELETE'));
    assert(deleteRes.status === 405, 'DELETE to audit-logs returns HTTP 405 (No deletion)');

    const singlePutRes = await putSingleLog();
    assert(singlePutRes.status === 405, 'PUT to audit-logs/[id] returns HTTP 405');

    const singleDeleteRes = await deleteSingleLog();
    assert(singleDeleteRes.status === 405, 'DELETE to audit-logs/[id] returns HTTP 405');

    // -------------------------------------------------------------
    // 3. Sanitization of Confidential Data (Passwords, Tokens)
    // -------------------------------------------------------------
    console.log('\n--- Group 3: Data Sanitization & Credential Protection ---');

    const dirtyData = {
      username: 'mohammed_admin',
      password: 'SuperSecretPassword123!',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz',
      token: 'jwt.token.secret',
      apiKey: 'live_secret_key_888999',
      financialDetails: {
        amount: 50000,
        currency: 'EGP',
        userSecret: 'confidential_pin',
      },
    };

    const cleanData = sanitizeAuditData(dirtyData);
    assert(cleanData.username === 'mohammed_admin', 'Preserved non-sensitive field (username)');
    assert(cleanData.password === '[REDACTED]', 'Redacted password');
    assert(cleanData.passwordHash === '[REDACTED]', 'Redacted passwordHash');
    assert(cleanData.token === '[REDACTED]', 'Redacted token');
    assert(cleanData.apiKey === '[REDACTED]', 'Redacted apiKey');
    assert(cleanData.financialDetails.amount === 50000, 'Preserved nested amount');
    assert(cleanData.financialDetails.userSecret === '[REDACTED]', 'Redacted nested userSecret');

    // -------------------------------------------------------------
    // 4. Atomic Transaction Audit Logging & Rollback
    // -------------------------------------------------------------
    console.log('\n--- Group 4: Atomic Transaction Logging Verification ---');

    const testEntityId = `test-audit-${Date.now()}`;

    // 4.1 Successful atomic commit
    await prisma.$transaction(async (tx) => {
      await logAuditEvent({
        userId: 'audit-test-admin',
        action: 'TEST_TRANSACTION_SUCCESS',
        entityType: 'TestEntity',
        entityId: testEntityId,
        newValues: { test: true, secretToken: 'should_be_redacted' },
        reason: 'Atomic audit log test',
        tx,
      });
    });

    const savedLog = await prisma.auditLog.findFirst({
      where: { entityId: testEntityId },
    });
    assert(savedLog !== null, 'Audit log committed atomically within transaction');
    assert(savedLog?.status === 'SUCCESS', 'Audit log status is SUCCESS');
    const parsedNew = JSON.parse(savedLog?.newValues || '{}');
    assert(parsedNew.secretToken === '[REDACTED]', 'Confidential token was redacted in PostgreSQL');

    // 4.2 Rollback on transaction failure
    const rollbackEntityId = `rollback-test-${Date.now()}`;
    let txFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        await logAuditEvent({
          userId: 'audit-test-admin',
          action: 'TEST_TRANSACTION_ROLLBACK',
          entityType: 'TestEntity',
          entityId: rollbackEntityId,
          tx,
        });
        throw new Error('Simulated transaction failure to test rollback');
      });
    } catch {
      txFailed = true;
    }
    assert(txFailed === true, 'Simulated transaction aborted');

    const rolledBackLog = await prisma.auditLog.findFirst({
      where: { entityId: rollbackEntityId },
    });
    assert(rolledBackLog === null, 'Audit log rolled back atomically with transaction failure');

    // Clean up test entry
    await prisma.auditLog.deleteMany({ where: { entityId: testEntityId } });

    // -------------------------------------------------------------
    // 5. Server-Side Pagination
    // -------------------------------------------------------------
    console.log('\n--- Group 5: Server-Side Pagination ---');

    const p1Req = createMockReq('http://localhost:3000/api/v1/audit-logs?page=1&limit=5', 'admin');
    const p1Res = await getAuditLogs(p1Req);
    const p1Data = await p1Res.json();

    assert(p1Data.pagination.page === 1, 'Pagination page is 1');
    assert(p1Data.pagination.limit === 5, 'Pagination limit is 5');
    assert(p1Data.pagination.totalCount >= 1000, `Total records count (${p1Data.pagination.totalCount}) >= 1000`);
    assert(p1Data.pagination.totalPages > 1, 'Multiple pages exist');
    assert(p1Data.pagination.hasNext === true, 'Has next page');
    assert(p1Data.data.length === 5, 'Page 1 returns exactly 5 items');

    const p2Req = createMockReq('http://localhost:3000/api/v1/audit-logs?page=2&limit=5', 'admin');
    const p2Res = await getAuditLogs(p2Req);
    const p2Data = await p2Res.json();

    assert(p2Data.pagination.page === 2, 'Pagination page is 2');
    assert(p2Data.pagination.hasPrev === true, 'Page 2 has previous page');
    assert(p1Data.data[0].id !== p2Data.data[0].id, 'Page 1 and Page 2 have disjoint records');

    // -------------------------------------------------------------
    // 6. Multi-Dimensional Search & Filtering
    // -------------------------------------------------------------
    console.log('\n--- Group 6: Search & Filtering Audit ---');

    // 6.1 Filter by action
    const actionReq = createMockReq('http://localhost:3000/api/v1/audit-logs?action=DAILY_CLOSING&limit=10', 'admin');
    const actionRes = await getAuditLogs(actionReq);
    const actionData = await actionRes.json();
    assert(actionData.data.length > 0, 'Found DAILY_CLOSING records');
    actionData.data.forEach((l: any) => {
      assert(l.action === 'DAILY_CLOSING', `Record action is DAILY_CLOSING (got ${l.action})`);
    });

    // 6.2 Filter by entityType
    const entityReq = createMockReq('http://localhost:3000/api/v1/audit-logs?entityType=DailyClosing&limit=10', 'admin');
    const entityRes = await getAuditLogs(entityReq);
    const entityData = await entityRes.json();
    assert(entityData.data.length > 0, 'Found DailyClosing entity records');
    entityData.data.forEach((l: any) => {
      assert(l.entityType === 'DailyClosing', `Record entityType is DailyClosing (got ${l.entityType})`);
    });

    // 6.3 Filter by status
    const statusReq = createMockReq('http://localhost:3000/api/v1/audit-logs?status=SUCCESS&limit=5', 'admin');
    const statusRes = await getAuditLogs(statusReq);
    const statusData = await statusRes.json();
    assert(statusData.data.length > 0, 'Found SUCCESS records');
    statusData.data.forEach((l: any) => {
      assert(l.status === 'SUCCESS', `Record status is SUCCESS (got ${l.status})`);
    });

    // 6.4 Filter by date range (Africa/Cairo)
    const todayStr = '2026-11-22';
    const dateReq = createMockReq(`http://localhost:3000/api/v1/audit-logs?fromDate=${todayStr}&toDate=${todayStr}&limit=5`, 'admin');
    const dateRes = await getAuditLogs(dateReq);
    const dateData = await dateRes.json();
    assert(dateData.success === true, 'Date filtering executed successfully');

    // -------------------------------------------------------------
    // 7. Export Functionality (CSV & JSON)
    // -------------------------------------------------------------
    console.log('\n--- Group 7: Export Functionality (CSV / JSON) ---');

    // 7.1 Export CSV
    const csvReq = createMockReq('http://localhost:3000/api/v1/audit-logs?export=csv&action=DAILY_CLOSING', 'admin');
    const csvRes = await getAuditLogs(csvReq);
    assert(csvRes.status === 200, 'CSV export returns HTTP 200');
    assert(csvRes.headers.get('content-type')?.includes('text/csv'), 'Content-Type is text/csv');
    assert(csvRes.headers.get('content-disposition')?.includes('attachment'), 'Content-Disposition is attachment');

    const csvBuffer = await csvRes.arrayBuffer();
    const bytes = new Uint8Array(csvBuffer);
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    assert(hasBom, 'CSV bytes start with UTF-8 BOM (0xEF, 0xBB, 0xBF) for Excel Arabic compatibility');

    const csvText = new TextDecoder('utf-8').decode(bytes);
    assert(csvText.includes('معرف السجل'), 'CSV includes Arabic header (معرف السجل)');
    assert(csvText.includes('DAILY_CLOSING'), 'CSV includes filtered action data');

    // 7.2 Export JSON
    const jsonReq = createMockReq('http://localhost:3000/api/v1/audit-logs?export=json&action=DAILY_CLOSING', 'admin');
    const jsonRes = await getAuditLogs(jsonReq);
    const jsonData = await jsonRes.json();
    assert(jsonData.success === true, 'JSON export returns success: true');
    assert(Array.isArray(jsonData.data), 'JSON export returns array of records');

    // -------------------------------------------------------------
    // 8. Single Record Inspection
    // -------------------------------------------------------------
    console.log('\n--- Group 8: Single Record Inspection ---');

    const firstLog = actionData.data[0];
    const singleReq = createMockReq(`http://localhost:3000/api/v1/audit-logs/${firstLog.id}`, 'admin');
    const singleRes = await getSingleLog(singleReq, { params: { id: firstLog.id } });
    const singleData = await singleRes.json();

    assert(singleRes.status === 200 && singleData.success === true, 'Single record inspection returns HTTP 200');
    assert(singleData.data.id === firstLog.id, 'Inspected record ID matches');
    assert(singleData.data.cairoCreatedAt !== undefined, 'Cairo timezone timestamp included');

    // -------------------------------------------------------------
    // 9. Historical Data Integrity
    // -------------------------------------------------------------
    console.log('\n--- Group 9: Historical Data Integrity ---');

    const totalInDb = await prisma.auditLog.count();
    console.log(`Current total audit logs in DB: ${totalInDb}`);
    assert(totalInDb >= 1249, `Historical records preserved without any data loss (${totalInDb} >= 1249)`);

    // -------------------------------------------------------------
    // 10. Newly Audited Routes Verification (Logout & Expense Category)
    // -------------------------------------------------------------
    console.log('\n--- Group 10: Specific Operation Audit Tracing ---');

    const adminUser = await prisma.user.findFirst({ where: { role: { name: 'admin' } } });
    if (!adminUser) throw new Error('No admin user found');

    const adminAuthToken = generateToken({
      userId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: 'admin',
    });

    // 10.1 Test Logout Audit
    const logoutReq = {
      method: 'POST',
      url: 'http://localhost:3000/api/v1/auth/me',
      headers: new Headers({
        authorization: `Bearer ${adminAuthToken}`,
      }),
      cookies: {
        get: (name: string) => (name === 'auth_token' ? { value: adminAuthToken } : undefined),
        delete: () => {},
      },
    } as any;

    const logoutRes = await logoutPost(logoutReq);
    assert(logoutRes.status === 200, 'Logout returns HTTP 200');

    const logoutLog = await prisma.auditLog.findFirst({
      where: {
        userId: adminUser.id,
        action: 'USER_LOGOUT',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(logoutLog !== null, 'USER_LOGOUT audit log recorded');
    assert(logoutLog?.entityType === 'User', 'Logout entityType is User');

    // 10.2 Test Expense Category Creation Audit
    const catName = `اختبار فئة ${Date.now()}`;
    const catReq = {
      method: 'POST',
      url: 'http://localhost:3000/api/v1/expenses/categories',
      headers: new Headers({
        authorization: `Bearer ${adminAuthToken}`,
      }),
      cookies: {
        get: () => undefined,
      },
      json: async () => ({
        name: catName,
        description: 'فئة مصاريف تجريبية للتدقيق',
      }),
    } as any;

    const catRes = await createExpenseCategoryPost(catReq);
    const catData = await catRes.json();
    assert(catRes.status === 201 && catData.success === true, 'Expense category created with HTTP 201');

    const catLog = await prisma.auditLog.findFirst({
      where: {
        action: 'CREATE_EXPENSE_CATEGORY',
        entityId: catData.data.id,
      },
    });
    assert(catLog !== null, 'CREATE_EXPENSE_CATEGORY audit log recorded');
    assert(catLog?.userId === adminUser.id, 'Audit log correctly attributed to user');

    // Cleanup test records
    await prisma.expenseCategory.delete({ where: { id: catData.data.id } });
    if (catLog) await prisma.auditLog.delete({ where: { id: catLog.id } });
    if (logoutLog) await prisma.auditLog.delete({ where: { id: logoutLog.id } });

    console.log('\n================================================================');
    console.log('   🎉 ALL 10 AUDIT LOGS PRODUCTION TEST GROUPS PASSED (100%)   ');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('Audit tests failed:', err.message);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

runAuditLogsProductionTests();
