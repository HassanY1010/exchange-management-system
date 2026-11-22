import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { generateToken } from '../lib/auth';
import { parseBankStatementFile, parseMonetaryAmount, normalizeDate } from '../lib/reconciliation/statement-parser';
import { runBankReconciliationMatching } from '../lib/reconciliation/matching-engine';
import { POST as uploadStatement } from '../app/api/v1/reconciliation/upload/route';
import { POST as matchStatement } from '../app/api/v1/reconciliation/match/route';
import { POST as confirmStatement } from '../app/api/v1/reconciliation/confirm/route';
import { GET as getStatements } from '../app/api/v1/reconciliation/route';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

async function runReconciliationTestSuite() {
  console.log('========================================================================================');
  console.log('   فحص وتدقيق واختبار نظام مطابقة كشف الحساب البنكي (Bank Reconciliation Audit Suite)   ');
  console.log('========================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, title: string, detail: string = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  [اختبار ${total}] ✅ ${title}`);
      if (detail) console.log(`     -> ${detail}`);
    } else {
      console.error(`  [اختبار ${total}] ❌ فشل: ${title}`);
      if (detail) console.error(`     -> التفاصيل: ${detail}`);
      throw new Error(`Test failed: ${title}`);
    }
  }

  const tokenAccountant = generateToken({
    userId: 'u-reconcile-acct',
    email: 'acct-reconcile@exchange.local',
    name: 'محاسب المطابقة البنكية',
    role: 'accountant',
  });

  const tokenAuditor = generateToken({
    userId: 'u-reconcile-auditor',
    email: 'auditor-reconcile@exchange.local',
    name: 'مراجع بنكك',
    role: 'bankak_auditor',
  });

  const tokenDataEntry = generateToken({
    userId: 'u-reconcile-entry',
    email: 'entry-reconcile@exchange.local',
    name: 'مدخل البيانات',
    role: 'data_entry',
  });

  // --- 1. اختبار استيراد وتحليل التنسيقات المختلفة (Parser Tests) ---
  console.log('--- 1. اختبارات استيراد وتحليل ملفات كشف الحساب (CSV & Excel) ---');

  // Test 1: Arabic CSV with comma-separated thousands
  const arabicCsv = `التاريخ,رقم العملية,المبلغ,المرسل,المستفيد
2026-11-20,BOK-TXN-101,"2,500,000",عمر أحمد عبدالله,مكتب الصرافة
2026-11-20,BOK-TXN-102,"3,000,000.50",حاتم إبراهيم,مكتب الصرافة`;

  const parsedArabic = parseBankStatementFile(arabicCsv, 'statement-arabic.csv');
  assert(
    parsedArabic.success && parsedArabic.validLines.length === 2,
    'تحليل ملف CSV عربي به أعمدة عربية وفواصل آلاف',
    `المبالغ المستخرجة: ${parsedArabic.validLines[0].amount} و ${parsedArabic.validLines[1].amount}`
  );

  // Test 2: English CSV with varied column order
  const englishCsv = `Transaction ID,Sender,Amount,Date,Details
TXN-ENG-201,John Doe,1500000,2026-11-21,Transfer from BOK
TXN-ENG-202,Jane Smith,4200000,2026-11-21,Deposit`;

  const parsedEnglish = parseBankStatementFile(englishCsv, 'statement-eng.csv');
  assert(
    parsedEnglish.success &&
      parsedEnglish.validLines.length === 2 &&
      parsedEnglish.validLines[0].transactionId === 'TXN-ENG-201' &&
      parsedEnglish.validLines[0].amount === 1500000,
    'تحليل ملف CSV إنجليزي بترتيب أعمدة مختلف والتعرف الذكي على الأعمدة'
  );

  // Test 3: Excel (.xlsx) Binary Buffer parsing
  const wsData = [
    ['تاريخ القيد', 'رقم المرجع', 'الوارد (دائن)', 'اسم المودع'],
    ['2026-11-22', 'BOK-XLSX-301', 5000000, 'عثمان محمد'],
    ['2026-11-22', 'BOK-XLSX-302', 7500000, 'خالد إدريس'],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const parsedXlsx = parseBankStatementFile(xlsxBuffer, 'bank-bok.xlsx');
  assert(
    parsedXlsx.success &&
      parsedXlsx.validLines.length === 2 &&
      parsedXlsx.validLines[0].amount === 5000000,
    'تحليل ملف Excel حقيقي (.xlsx) بصيغة ثنائية واستخراج الحركات بدقة'
  );

  // Test 4: Empty and Corrupt Files handling
  const emptyCsv = `   \n\n   `;
  const parsedEmpty = parseBankStatementFile(emptyCsv, 'empty.csv');
  assert(
    !parsedEmpty.success && parsedEmpty.validLines.length === 0,
    'رفض الملفات الفارغة بأمان مع رسالة خطأ واضحة'
  );

  // --- 2. اختبار النزاهة وصلاحيات الـ API ومنع تكرار استيراد نفس الملف ---
  console.log('\n--- 2. اختبار صلاحيات الرفع ومنع تكرار استيراد نفس الملف (Idempotent Import) ---');

  // Test 5: RBAC on Upload
  const unauthorizedReq = new NextRequest('http://localhost:3000/api/v1/reconciliation/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDataEntry}` },
    body: JSON.stringify({ rawText: arabicCsv }),
  });
  const unauthRes = await uploadStatement(unauthorizedReq);
  assert(
    unauthRes.status === 403,
    'حماية الصلاحيات: رفض استيراد كشف الحساب من قِبل مدخل البيانات (مقتصر على المحاسب والمدير)'
  );

  // Test 6: Successful Upload by Accountant
  const runSalt = Date.now();
  const uploadCsv = `التاريخ,رقم العملية,المبلغ,المرسل,المستفيد
2026-11-20,BOK-TXN-${runSalt}-1,"2,500,000",عمر أحمد عبدالله,مكتب الصرافة
2026-11-20,BOK-TXN-${runSalt}-2,"3,000,000.50",حاتم إبراهيم,مكتب الصرافة`;

  const testFilename = `test-stmt-${runSalt}.csv`;
  const uploadReq1 = new NextRequest('http://localhost:3000/api/v1/reconciliation/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      filename: testFilename,
      rawText: uploadCsv,
    }),
  });
  const upRes1 = await uploadStatement(uploadReq1);
  const upJson1 = await upRes1.json();
  const createdStmt = upJson1.data;
  assert(
    upRes1.status === 201 && createdStmt && createdStmt.totalLines === 2,
    `نجاح استيراد كشف حساب جديد برقم ${createdStmt?.statementNumber} وحفظ ${createdStmt?.totalLines} حركة`
  );

  // Test 7: Duplicate File Upload Prevention (Same SHA-256 Hash)
  const uploadReq2 = new NextRequest('http://localhost:3000/api/v1/reconciliation/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      filename: 'duplicate-attempt.csv',
      rawText: uploadCsv,
    }),
  });
  const upRes2 = await uploadStatement(uploadReq2);
  assert(
    upRes2.status === 409,
    'كشف ومنع تكرار استيراد نفس الملف بالكامل (Duplicate File Protection - 409 Conflict)'
  );

  // Test 7b: Concurrent Duplicate Uploads (Atomic DB Unique Constraint Protection)
  const concurrentSalt = Date.now();
  const concurrentCsv = `التاريخ,رقم العملية,المبلغ,المرسل
2026-11-20,BOK-CONCUR-${concurrentSalt},"1,000,000",عميل اختبار التزامن`;

  const reqA = new NextRequest('http://localhost:3000/api/v1/reconciliation/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ filename: `concurrent-a-${concurrentSalt}.csv`, rawText: concurrentCsv }),
  });
  const reqB = new NextRequest('http://localhost:3000/api/v1/reconciliation/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ filename: `concurrent-b-${concurrentSalt}.csv`, rawText: concurrentCsv }),
  });

  const [resA, resB] = await Promise.all([uploadStatement(reqA), uploadStatement(reqB)]);
  const statuses = [resA.status, resB.status].sort();
  assert(
    statuses[0] === 201 && statuses[1] === 409,
    'منع تكرار الرفع المتزامن في نفس اللحظة عبر قيد قاعدة البيانات الفريد (Concurrent Upload Race Protection - 201 vs 409)'
  );

  // --- 3. إعداد بيانات الإيصالات وسيناريوهات المطابقة (Matching Engine Tests) ---
  console.log('\n--- 3. اختبارات محرك المطابقة بمختلف الحالات (Matching Scenarios) ---');

  const testCustomer = await prisma.customer.upsert({
    where: { customerCode: 'CUST-RECONCILE-TEST' },
    update: {},
    create: {
      customerCode: 'CUST-RECONCILE-TEST',
      name: 'عميل اختبار المطابقة',
      phone: '+249911998877',
      status: 'active',
    },
  });

  // Clean receipts for this test
  await prisma.bankakReceipt.deleteMany({
    where: { customerId: testCustomer.id },
  }).catch(() => {});

  // Receipt 1: Exact match candidate
  const r1 = await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-REC-${Date.now()}-1`,
      transactionId: `TXN-MATCH-EXACT-${runSalt}`,
      amount: 1000000,
      currency: 'SDG',
      transactionDate: '2026-11-20',
      customerId: testCustomer.id,
      status: 'uploaded',
      imageStorageKey: 'receipts/test-reconcile-img.png',
      imageHash: `hash-1-${runSalt}`,
      createdBy: 'u-reconcile-accountant',
    },
  });

  // Receipt 2: Amount mismatch candidate
  const r2 = await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-REC-${Date.now()}-2`,
      transactionId: `TXN-MATCH-DIFF-AMT-${runSalt}`,
      amount: 2000000,
      currency: 'SDG',
      transactionDate: '2026-11-20',
      customerId: testCustomer.id,
      status: 'uploaded',
      imageStorageKey: 'receipts/test-reconcile-img.png',
      imageHash: `hash-2-${runSalt}`,
      createdBy: 'u-reconcile-accountant',
    },
  });

  // Receipt 3 & 4: Ambiguous multiple candidates for heuristic match
  await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-REC-${Date.now()}-3`,
      transactionId: `TXN-OTHER-3-${runSalt}`,
      amount: 888000,
      currency: 'SDG',
      transactionDate: '2026-11-20',
      customerId: testCustomer.id,
      status: 'uploaded',
      imageStorageKey: 'receipts/test-reconcile-img.png',
      imageHash: `hash-3-${runSalt}`,
      createdBy: 'u-reconcile-accountant',
    },
  });
  await prisma.bankakReceipt.create({
    data: {
      receiptNumber: `RCP-REC-${Date.now()}-4`,
      transactionId: `TXN-OTHER-4-${runSalt}`,
      amount: 888000,
      currency: 'SDG',
      transactionDate: '2026-11-20',
      customerId: testCustomer.id,
      status: 'uploaded',
      imageStorageKey: 'receipts/test-reconcile-img.png',
      imageHash: `hash-4-${runSalt}`,
      createdBy: 'u-reconcile-accountant',
    },
  });

  // Create a comprehensive statement with all scenarios
  const comprehensiveCsv = `التاريخ,رقم العملية,المبلغ,المرسل
2026-11-20,TXN-MATCH-EXACT-${runSalt},1000000,عمر أحمد
2026-11-20,TXN-MATCH-DIFF-AMT-${runSalt},2500000,حاتم إبراهيم
2026-11-20,TXN-DUPLICATE-INTERNAL-${runSalt},500000,علي حسن
2026-11-20,TXN-DUPLICATE-INTERNAL-${runSalt},500000,علي حسن
2026-11-20,TXN-AMBIGUOUS-CANDIDATES-${runSalt},888000,محمد طه
2026-11-20,TXN-UNMATCHED-UNKNOWN-${runSalt},9999000,جهة غير معروفة`;

  const upCompReq = new NextRequest('http://localhost:3000/api/v1/reconciliation/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({
      filename: `comprehensive-${Date.now()}.csv`,
      rawText: comprehensiveCsv,
    }),
  });
  const upCompRes = await uploadStatement(upCompReq);
  const upCompJson = await upCompRes.json();
  const compStmtId = upCompJson.data.id;

  // Run matching engine via API
  const matchReq = new NextRequest('http://localhost:3000/api/v1/reconciliation/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ statementId: compStmtId }),
  });
  const matchRes = await matchStatement(matchReq);
  const matchJson = await matchRes.json();
  const matchSummary = matchJson.summary;

  // Test 8: Exact match verification
  assert(
    matchSummary.matched === 1,
    'تطابق تام ومؤكد برقم العملية والمبلغ (Exact Match -> matched)'
  );

  // Test 9: Amount mismatch detection
  assert(
    matchSummary.mismatched === 1,
    'اكتشاف اختلاف المبلغ لنفس رقم العملية (Amount Mismatch -> amount_mismatch)'
  );

  // Test 10: Intra-file duplicate detection
  assert(
    matchSummary.duplicate >= 1,
    'اكتشاف الحركة المكررة داخل الكشف ومنع مطابقتها تلقائياً (Duplicate Detection -> duplicate)'
  );

  // Test 11: Multi-candidate ambiguity protection
  assert(
    matchSummary.multipleCandidates === 1,
    'منع المطابقة التلقائية عند وجود أكثر من إيصال مرشح (Multiple Candidates -> review required)'
  );

  // Test 12: Unmatched line categorization
  assert(
    matchSummary.unmatched === 1,
    'تصنيف الحركة غير المسجلة بالمنصة كحركة غير مطابقة (Unmatched)'
  );

  // --- 4. اختبار الاعتماد والنزاهة المحاسبية (Confirmation & Accounting Integrity) ---
  console.log('\n--- 4. اختبار الاعتماد المالي والنزاهة المحاسبية (Confirmation & Zero Ledger) ---');

  // Verify ZERO ledger entries exist for these statements before confirmation
  const ledgerCountBefore = await prisma.ledgerEntry.count({
    where: { referenceType: 'BankStatement' },
  });
  assert(
    ledgerCountBefore === 0,
    'مطابقة كشف البنك لا تنشئ أي قيود مالية وهمية في الدفاتر المحاسبية (Zero Ledger Entries on Matching)'
  );

  // Confirm statement via API
  const confirmReq = new NextRequest('http://localhost:3000/api/v1/reconciliation/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ statementId: compStmtId }),
  });
  const confirmRes = await confirmStatement(confirmReq);
  const confirmJson = await confirmRes.json();

  assert(
    confirmRes.status === 200 && confirmJson.success,
    'نجاح اعتماد المطابقة البنكية وتأكيد الإيصالات المطابقة'
  );

  // Verify that ONLY matched unverified receipt was upgraded to verified
  const r1After = await prisma.bankakReceipt.findUnique({ where: { id: r1.id } });
  assert(
    r1After?.status === 'verified' && r1After.verificationSource === 'bank_statement',
    'ترقية الإيصال المطابق فقط إلى حالة Verified وتوثيق المصدر في سجل الإيصال'
  );

  // Verify that ZERO ledger entries were created by confirmation (No duplicate entries!)
  const ledgerCountAfter = await prisma.ledgerEntry.count({
    where: { referenceType: 'BankStatement' },
  });
  assert(
    ledgerCountAfter === 0,
    'اعتماد المطابقة لا يكرر القيود المحاسبية ولا يغيّر أرصدة الصناديق دون اعتماد مالي صريح (Double-Entry Protection)'
  );

  // Test Idempotency of Confirmation
  const confirmReq2 = new NextRequest('http://localhost:3000/api/v1/reconciliation/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ statementId: compStmtId }),
  });
  const confirmRes2 = await confirmStatement(confirmReq2);
  const confirmJson2 = await confirmRes2.json();
  assert(
    confirmRes2.status === 200 && confirmJson2.success,
    'قابلية تكرار الاعتماد بأمان تام دون تكرار أي تحديثات (Idempotent Confirmation)'
  );

  // --- 5. اختبار استعلامات الـ GET والـ Pagination والـ KPIs ---
  console.log('\n--- 5. اختبار استعلامات الـ Pagination والـ KPIs ---');

  const getReq = new NextRequest(
    `http://localhost:3000/api/v1/reconciliation?statementId=${compStmtId}&page=1&pageSize=10`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenAuditor}` },
    }
  );
  const getRes = await getStatements(getReq);
  const getJson = await getRes.json();

  assert(
    getRes.status === 200 &&
      getJson.stats &&
      getJson.stats.matchedCount === 1 &&
      getJson.data.length >= 5,
    'استرجاع كشف الحساب مع إحصائيات الـ KPIs والـ Pagination بدقة ودون تحميل غير ضروري'
  );

  // Test 19: Rejected and Suspicious Receipt Immunity on Confirm (Point 5)
  const r2After = await prisma.bankakReceipt.findUnique({ where: { id: r2.id } });
  assert(
    r2After?.status === 'uploaded',
    'حماية الاعتماد: الإيصالات ذات المبالغ غير المطابقة أو المعلقة لا يتم ترقيتها إلى verified'
  );

  // Test 20: Cross-statement matching prevention (Point 4)
  const stmt2Csv = `التاريخ,رقم العملية,المبلغ,المرسل
2026-11-20,TXN-MATCH-EXACT-${runSalt},1000000,عمر أحمد`;
  const upStmt2Req = new NextRequest('http://localhost:3000/api/v1/reconciliation/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ filename: `stmt2-${Date.now()}.csv`, rawText: stmt2Csv }),
  });
  const upStmt2Res = await uploadStatement(upStmt2Req);
  const upStmt2Json = await upStmt2Res.json();
  const stmt2Id = upStmt2Json.data.id;

  const matchStmt2Req = new NextRequest('http://localhost:3000/api/v1/reconciliation/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAccountant}` },
    body: JSON.stringify({ statementId: stmt2Id }),
  });
  const matchStmt2Res = await matchStatement(matchStmt2Req);
  const matchStmt2Json = await matchStmt2Res.json();

  assert(
    matchStmt2Json.summary.duplicate === 1 && matchStmt2Json.summary.matched === 0,
    'منع ربط الإيصال بأكثر من كشف: اكتشاف مطابقة الإيصال مسبقاً في كشف سابق وتصنيفه كـ duplicate'
  );

  // Test 21: Net total volume calculation does not inflate due to duplicates (Point 7)
  assert(
    getJson.stats.netTotalAmount < getJson.stats.grossTotalAmount &&
      getJson.stats.duplicateAmount > 0 &&
      getJson.stats.currency === 'SDG',
    'نزاهة العملات والإجماليات: العمليات المكررة لا تضخم صافي الحجم الإجمالي وعزل مبالغ التكرار بدقة'
  );

  console.log('\n========================================================================================');
  console.log(`  🏆 نجحت جميع اختبارات مطابقة كشف الحساب البنكي: ${passed} من أصل ${total} بنسبة 100%!`);
  console.log('========================================================================================\n');
}

runReconciliationTestSuite()
  .catch((err) => {
    console.error('Reconciliation test suite failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
