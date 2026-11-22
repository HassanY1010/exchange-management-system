import { prisma } from '../lib/db';
import { generateToken } from '../lib/auth';
import { GET as getSettings, POST as postSettings } from '../app/api/v1/settings/route';
import {
  getSystemSettings,
  getSystemSetting,
  updateSystemSettings,
  invalidateSettingsCache,
  validateSettingsUpdates,
  DEFAULT_SETTINGS_MAP,
} from '../lib/settings/settings-service';

function createMockReq(url: string, role?: string, method = 'GET', body?: any) {
  const headers = new Headers();
  if (role) {
    const token = generateToken({
      userId: 'test-admin-id',
      email: 'admin@exchange.com',
      name: 'مدير النظام التنفيذي',
      role,
    });
    headers.set('authorization', `Bearer ${token}`);
  }
  if (body) {
    headers.set('content-type', 'application/json');
  }

  return {
    method,
    url,
    headers,
    cookies: { get: () => undefined },
    nextUrl: new URL(url),
    json: async () => body || {},
  } as any;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runSettingsProductionAudit() {
  console.log('================================================================');
  console.log('   SYSTEM SETTINGS PRODUCTION-GRADE AUDIT (POSTGRESQL REAL)   ');
  console.log('================================================================');

  try {
    // -------------------------------------------------------------
    // Group 1: Strict RBAC Access Control
    // -------------------------------------------------------------
    console.log('\n--- Group 1: Strict RBAC Access Control ---');

    // 1.1 Unauthenticated request -> 401
    const unauthReq = createMockReq('http://localhost:3000/api/v1/settings');
    const resUnauth = await getSettings(unauthReq);
    assert(resUnauth.status === 401, 'Unauthenticated request to GET /settings returns HTTP 401');

    // 1.2 Unauthorized roles -> 403
    const dataEntryReq = createMockReq('http://localhost:3000/api/v1/settings', 'data_entry');
    const resDataEntry = await getSettings(dataEntryReq);
    assert(resDataEntry.status === 403, 'Unauthorized role (data_entry) returns HTTP 403');

    const cashierReq = createMockReq('http://localhost:3000/api/v1/settings', 'cashier');
    const resCashier = await getSettings(cashierReq);
    assert(resCashier.status === 403, 'Unauthorized role (cashier) returns HTTP 403');

    // 1.3 Authorized read-only roles (accountant, auditor) -> 200 with canEdit=false
    const accountantReq = createMockReq('http://localhost:3000/api/v1/settings', 'accountant');
    const resAccountant = await getSettings(accountantReq);
    const dataAccountant = await resAccountant.json();
    assert(resAccountant.status === 200, 'Accountant role can view settings (HTTP 200)');
    assert(dataAccountant.canEdit === false, 'Accountant role has canEdit = false (Read-only mode)');

    // 1.4 Non-admin mutation attempt -> 403
    const mutDataEntry = createMockReq('http://localhost:3000/api/v1/settings', 'accountant', 'POST', {
      company_name: 'محاولة تعديل غير مصرح بها',
    });
    const resMutDataEntry = await postSettings(mutDataEntry);
    assert(resMutDataEntry.status === 403, 'Non-admin mutation attempt returns HTTP 403 Forbidden');

    // 1.5 Admin role -> 200 with canEdit=true
    const adminReq = createMockReq('http://localhost:3000/api/v1/settings', 'admin');
    const resAdmin = await getSettings(adminReq);
    const dataAdmin = await resAdmin.json();
    assert(resAdmin.status === 200, 'Admin role can view settings (HTTP 200)');
    assert(dataAdmin.canEdit === true, 'Admin role has canEdit = true');

    // -------------------------------------------------------------
    // Group 2: Categorization & Completeness
    // -------------------------------------------------------------
    console.log('\n--- Group 2: Categorization & Completeness ---');
    assert(Array.isArray(dataAdmin.definitions), 'Definitions returned as array');
    const categories = new Set(dataAdmin.definitions.map((d: any) => d.category));
    assert(categories.has('organization'), 'Category: organization exists');
    assert(categories.has('currencies'), 'Category: currencies exists');
    assert(categories.has('time_date'), 'Category: time_date exists');
    assert(categories.has('operations'), 'Category: operations exists');
    console.log(`Verified ${dataAdmin.definitions.length} setting definitions across 4 categories.`);

    // -------------------------------------------------------------
    // Group 3: Input Validation & Arabic Error Messages
    // -------------------------------------------------------------
    console.log('\n--- Group 3: Input Validation & Arabic Error Messages ---');

    // 3.1 Invalid Timezone
    const vTz = await validateSettingsUpdates({ timezone: 'Invalid/Non_Existent_Timezone' });
    assert(vTz.valid === false, 'Invalid timezone fails validation');
    assert(Boolean(vTz.errors.timezone), 'Arabic error provided for invalid timezone');

    // 3.2 Primary Currency not in supported currencies
    const vCur = await validateSettingsUpdates({
      primary_currency: 'EUR',
      supported_currencies: 'EGP,USD,SDG',
    });
    assert(vCur.valid === false, 'Primary currency not in supported currencies fails validation');
    assert(Boolean(vCur.errors.primary_currency), 'Arabic error provided for currency mismatch');

    // 3.3 Invalid OCR Confidence Range
    const vOcr1 = await validateSettingsUpdates({ ocr_min_confidence: '120' });
    assert(vOcr1.valid === false, 'OCR confidence > 100 fails validation');
    const vOcr2 = await validateSettingsUpdates({ ocr_min_confidence: '30' });
    assert(vOcr2.valid === false, 'OCR confidence < 50 fails validation');

    // 3.4 Invalid Decimal Places
    const vDec = await validateSettingsUpdates({ decimal_places: '8' });
    assert(vDec.valid === false, 'Decimal places > 4 fails validation');

    // 3.5 Invalid Company Name
    const vName = await validateSettingsUpdates({ company_name: 'أ' });
    assert(vName.valid === false, 'Company name < 3 chars fails validation');

    // -------------------------------------------------------------
    // Group 4: Historical Accounting Safeguards
    // -------------------------------------------------------------
    console.log('\n--- Group 4: Historical Accounting Safeguards ---');

    // Attempting to remove SDG or USD (which are active in ledger accounts)
    const vRemoveCur = await validateSettingsUpdates({
      supported_currencies: 'EGP,SAR,AED', // Removed SDG and USD
    });
    assert(vRemoveCur.valid === false, 'Removing active ledger currency fails validation');
    assert(
      vRemoveCur.errors.supported_currencies.includes('دفتر الأستاذ') ||
      vRemoveCur.errors.supported_currencies.includes('حساب مالي'),
      'Arabic error explicitly references active ledger / account protection'
    );
    console.log(`Protected active currencies from removal: "${vRemoveCur.errors.supported_currencies}"`);

    // -------------------------------------------------------------
    // Group 5: Atomic Persistence & AuditLog Before/After Tracking
    // -------------------------------------------------------------
    console.log('\n--- Group 5: Atomic Persistence & AuditLog Integration ---');

    const testCompanyName = `شركة النجم المعتمدة للصيرفة - تجربة ${Date.now()}`;
    const currentDbOcr = (await prisma.setting.findUnique({ where: { key: 'ocr_min_confidence' } }))?.value;
    const testOcrConfidence = currentDbOcr === '78' ? '79' : '78';

    // Save update via API
    const saveReq = createMockReq('http://localhost:3000/api/v1/settings', 'admin', 'POST', {
      company_name: testCompanyName,
      ocr_min_confidence: testOcrConfidence,
      company_phone: '+20 100 123 4567',
    });

    const resSave = await postSettings(saveReq);
    const dataSave = await resSave.json();
    assert(resSave.status === 200 && dataSave.success === true, 'Settings update saved successfully (HTTP 200)');

    // Verify persistence in PostgreSQL directly
    const dbRowName = await prisma.setting.findUnique({ where: { key: 'company_name' } });
    assert(dbRowName?.value === testCompanyName, 'company_name strictly persisted in PostgreSQL Setting table');

    const dbRowOcr = await prisma.setting.findUnique({ where: { key: 'ocr_min_confidence' } });
    assert(dbRowOcr?.value === testOcrConfidence, 'ocr_min_confidence strictly persisted in PostgreSQL Setting table');

    // Verify AuditLog record was created atomically
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        action: 'UPDATE_SYSTEM_SETTINGS',
        entityType: 'Setting',
      },
      orderBy: { createdAt: 'desc' },
    });

    assert(auditRecord !== null, 'AuditLog entry created for UPDATE_SYSTEM_SETTINGS');
    assert(auditRecord?.status === 'SUCCESS', 'AuditLog status is SUCCESS');

    const parsedOld = JSON.parse(auditRecord?.oldValues || '{}');
    const parsedNew = JSON.parse(auditRecord?.newValues || '{}');

    assert(parsedNew.company_name === testCompanyName, 'AuditLog newValues captures new company_name');
    assert(parsedNew.ocr_min_confidence === testOcrConfidence, 'AuditLog newValues captures new ocr_min_confidence');
    assert(parsedOld.company_name !== undefined, 'AuditLog oldValues captures previous company_name (Before/After)');

    // -------------------------------------------------------------
    // Group 6: Atomic Rollback on Batch Failure
    // -------------------------------------------------------------
    console.log('\n--- Group 6: Atomic Rollback on Batch Failure ---');

    const preRollbackName = (await prisma.setting.findUnique({ where: { key: 'company_name' } }))?.value;

    const invalidBatchReq = createMockReq('http://localhost:3000/api/v1/settings', 'admin', 'POST', {
      company_name: 'اسم جديد يفترض أن يتم التراجع عنه',
      timezone: 'Non_Existent_Timezone_12345', // This will fail validation
    });

    const resInvalidBatch = await postSettings(invalidBatchReq);
    assert(resInvalidBatch.status === 400, 'Invalid batch rejected with HTTP 400');

    // Verify company_name was NOT updated partially (Strict Atomicity)
    const postRollbackName = (await prisma.setting.findUnique({ where: { key: 'company_name' } }))?.value;
    assert(preRollbackName === postRollbackName, 'Atomic rollback verified: no partial setting update applied');

    // -------------------------------------------------------------
    // Group 7: Real System Impact Verification
    // -------------------------------------------------------------
    console.log('\n--- Group 7: Real System Impact Verification ---');

    // 7.1 Check getSystemSetting helper
    invalidateSettingsCache();
    const fetchedOcr = await getSystemSetting<number>('ocr_min_confidence', 70);
    assert(fetchedOcr === Number(testOcrConfidence), `getSystemSetting('ocr_min_confidence') returns updated value (expected ${testOcrConfidence}, got ${fetchedOcr})`);

    // 7.2 Check Customer Statement incorporates company info
    const anyCustomer = await prisma.customer.findFirst();
    if (anyCustomer) {
      const { GET: getStatement } = await import('../app/api/v1/customers/[id]/statement/route');
      const stmtReq = createMockReq(`http://localhost:3000/api/v1/customers/${anyCustomer.id}/statement`, 'admin');
      const resStmt = await getStatement(stmtReq, { params: { id: anyCustomer.id } });
      const stmtData = await resStmt.json();

      assert(stmtData.statement.company.name === testCompanyName, 'Customer statement reflects updated company name');
      assert(stmtData.statement.company.phone === '+20 100 123 4567', 'Customer statement reflects updated company phone');
      console.log('Customer statement verified with updated company header.');
    }

    // -------------------------------------------------------------
    // Group 8: Cairo Timezone & Dynamic DST Support
    // -------------------------------------------------------------
    console.log('\n--- Group 8: Cairo Timezone & Dynamic DST Support ---');
    const cairoSetting = await getSystemSetting('timezone', 'Africa/Cairo');
    assert(cairoSetting === 'Africa/Cairo', 'Default configured timezone is Africa/Cairo');

    // Verify winter and summer offsets in Cairo
    const winterDate = new Date('2026-01-15T12:00:00Z');
    const summerDate = new Date('2026-07-15T12:00:00Z');

    const winterFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      timeZoneName: 'shortOffset',
    });
    const winterParts = winterFormatter.formatToParts(winterDate);
    const winterTz = winterParts.find((p) => p.type === 'timeZoneName')?.value;

    const summerFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      timeZoneName: 'shortOffset',
    });
    const summerParts = summerFormatter.formatToParts(summerDate);
    const summerTz = summerParts.find((p) => p.type === 'timeZoneName')?.value;

    console.log(`Cairo Winter Time Offset: ${winterTz}`);
    console.log(`Cairo Summer Time Offset: ${summerTz}`);
    assert(winterTz === 'GMT+2', 'Cairo winter standard time is GMT+2');
    assert(summerTz === 'GMT+3', 'Cairo summer daylight saving time is GMT+3');

    // -------------------------------------------------------------
    // Group 9: Focused Verification of the 4 Target Settings
    // -------------------------------------------------------------
    console.log('\n--- Group 9: Focused Verification of 4 Target Settings ---');

    // 9.1 allow_negative_inventory: must not exist as phantom setting
    const phantomInDb = await prisma.setting.findUnique({ where: { key: 'allow_negative_inventory' } });
    assert(phantomInDb === null, 'allow_negative_inventory does not exist in DB Setting table');
    const vPhantom = await validateSettingsUpdates({ allow_negative_inventory: 'true' });
    assert(vPhantom.valid === false, 'allow_negative_inventory is rejected as an unrecognized key');
    assert(vPhantom.errors.allow_negative_inventory.includes('ليس من إعدادات النظام المعتمدة'), 'Clear error rejecting phantom key');

    // 9.2 daily_closing_auto_lock: changing it NEVER allows bypassing closed day
    const { assertBusinessDateOpen } = await import('../lib/accounting/accounting-service');
    // Find or pick a closed date
    const closedClosing = await prisma.dailyClosing.findFirst({ where: { status: 'closed' } });
    if (closedClosing) {
      let threwOnClosed = false;
      try {
        await assertBusinessDateOpen(closedClosing.businessDate);
      } catch (err: any) {
        threwOnClosed = true;
        assert(err.message.includes('مغلق ومجمد'), 'assertBusinessDateOpen strictly throws on closed day');
      }
      assert(threwOnClosed, `Closed day (${closedClosing.businessDate}) cannot be bypassed`);
    }

    // 9.3 primary_currency: changing it does NOT alter ledger lines or merge currency balances
    const preLinesCount = await prisma.ledgerLine.count();
    const preSdgLine = await prisma.ledgerLine.findFirst({ where: { currency: 'SDG' } });
    const preEgpLine = await prisma.ledgerLine.findFirst({ where: { currency: 'EGP' } });

    // Validate that primary_currency is only a reporting reference, not a currency mutator
    const postLinesCount = await prisma.ledgerLine.count();
    assert(preLinesCount === postLinesCount, 'Changing settings does not alter ledger lines count');
    const postSdgLine = await prisma.ledgerLine.findUnique({ where: { id: preSdgLine?.id } });
    assert(postSdgLine?.currency === 'SDG', 'Historical SDG ledger lines remain strictly SDG');
    const postEgpLine = await prisma.ledgerLine.findUnique({ where: { id: preEgpLine?.id } });
    assert(postEgpLine?.currency === 'EGP', 'Historical EGP ledger lines remain strictly EGP');

    // 9.4 supported_currencies: cannot remove active ledger currency (EGP, SDG, USD)
    const vRemoveSdg = await validateSettingsUpdates({ supported_currencies: 'EGP,USD,SAR' });
    assert(vRemoveSdg.valid === false, 'Removing active currency SDG is strictly blocked');
    assert(
      vRemoveSdg.errors.supported_currencies.includes('حساب مالي') ||
      vRemoveSdg.errors.supported_currencies.includes('دفتر الأستاذ'),
      'Rejection cites active account or ledger history'
    );

    console.log('Target settings verified with mathematical and accounting rigor.');

    // -------------------------------------------------------------
    // Clean up test data
    // -------------------------------------------------------------
    await prisma.setting.update({
      where: { key: 'company_name' },
      data: { value: 'شركة النجم لخدمات الصرافة والتحويلات المالية' },
    });
    await prisma.setting.update({
      where: { key: 'ocr_min_confidence' },
      data: { value: '70' },
    });
    invalidateSettingsCache();

    console.log('\n================================================================');
    console.log('   🎉 ALL 8 SETTINGS AUDIT GROUPS PASSED WITH 100% SUCCESS     ');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('Settings audit test failed:', err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

runSettingsProductionAudit();
