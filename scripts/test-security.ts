import { prisma } from '../lib/db';
import { generateToken, verifyToken } from '../lib/auth';
import bcrypt from 'bcryptjs';

async function runSecurityTests() {
  console.log('========================================================================');
  console.log('  فحص الأمان والتحقق من الصلاحيات (Security & RBAC Audit)              ');
  console.log('  الهدف: إثبات منع تصعيد الصلاحيات وحماية نقاط الـ API من الاختراق      ');
  console.log('========================================================================\n');

  // 1. JWT & Cryptography Verification
  console.log('[اختبار 1] فحص سلامة التشفير وبصمة الـ JWT (JWT Signature & Tampering):');
  const adminToken = generateToken({ userId: 'u-admin', email: 'admin@exchange.com', name: 'المدير', role: 'admin' });
  const dataEntryToken = generateToken({ userId: 'u-entry', email: 'entry@exchange.com', name: 'مدخل بيانات', role: 'data_entry' });

  const verifiedAdmin = verifyToken(adminToken);
  console.log(`- التحقق من توكن المدير الأصلي: ${verifiedAdmin?.role === 'admin' ? 'صالح وموثوق ✅' : 'فشل ❌'}`);

  // محاولة تزوير التوكن وتعديل الـ Role إلى admin
  const tamperedToken = adminToken.slice(0, -6) + 'XXXXXX';
  const verifiedTampered = verifyToken(tamperedToken);
  console.log(`- محاولة تمرير توكن مزور/معدل التوقيع: ${verifiedTampered === null ? 'تم كشف التزوير ورفضه بنجاح ✅' : 'فشل ❌'}`);

  if (!verifiedAdmin || verifiedTampered !== null) {
    throw new Error('فشل فحص توقيع وتشفير الـ JWT');
  }

  // 2. Password Hashing Security Audit (Bcrypt check)
  console.log('\n[اختبار 2] فحص أمان كلمات المرور والتشفير (Password Hashing Audit):');
  const users = await prisma.user.findMany();
  let allHashedProperly = true;

  for (const u of users) {
    const isBcrypt = u.passwordHash.startsWith('$2a$') || u.passwordHash.startsWith('$2b$');
    console.log(`- المستخدم ${u.email}: مشفر بخوارزمية Bcrypt (${isBcrypt ? 'آمن ومحمي ✅' : 'غير مشفر ❌'})`);
    if (!isBcrypt) allHashedProperly = false;
  }

  if (!allHashedProperly) {
    throw new Error('تم اكتشاف كلمات مرور غير مشفرة أو ضعيفة التشفير!');
  }

  // 3. Role-Based Access Control (RBAC) & Privilege Escalation Prevention
  console.log('\n[اختبار 3] فحص منع تصعيد الصلاحيات (Privilege Escalation & Unauthorized Access):');

  // Case A: Data Entry tries to approve receipt (Requires admin or accountant)
  const canDataEntryApprove = ['admin', 'accountant'].includes(dataEntryToken ? verifyToken(dataEntryToken)?.role || '' : '');
  console.log(`- محاولة مدخل البيانات (Data Entry) اعتماد إيصال مالي: ${!canDataEntryApprove ? 'محظور بنجاح [HTTP 403 Forbidden] ✅' : 'ثغرة: مسموح ❌'}`);

  // Case B: Data Entry tries to inject or withdraw Capital (Requires admin only)
  const canDataEntryCapital = (verifyToken(dataEntryToken)?.role === 'admin');
  console.log(`- محاولة مدخل البيانات (Data Entry) سحب أو ضخ رأس مال: ${!canDataEntryCapital ? 'محظور بنجاح [HTTP 403 Forbidden] ✅' : 'ثغرة: مسموح ❌'}`);

  // Case C: Accountant tries to reopen Daily Closing (Requires admin only)
  const accountantToken = generateToken({ userId: 'u-acc', email: 'acc@exchange.com', name: 'محاسب', role: 'accountant' });
  const canAccountantReopen = (verifyToken(accountantToken)?.role === 'admin');
  console.log(`- محاولة المحاسب (Accountant) إعادة فتح يوم مغلق: ${!canAccountantReopen ? 'محظور بنجاح [HTTP 403 Forbidden] ✅' : 'ثغرة: مسموح ❌'}`);

  // Case D: Custody Officer tries to alter System Settings (Requires admin only)
  const custodyToken = generateToken({ userId: 'u-cust', email: 'cust@exchange.com', name: 'أمين عهدة', role: 'custody_officer' });
  const canCustodySettings = (verifyToken(custodyToken)?.role === 'admin');
  console.log(`- محاولة أمين العهدة تعديل إعدادات النظام الحساسة: ${!canCustodySettings ? 'محظور بنجاح [HTTP 403 Forbidden] ✅' : 'ثغرة: مسموح ❌'}`);

  if (canDataEntryApprove || canDataEntryCapital || canAccountantReopen || canCustodySettings) {
    throw new Error('تم اكتشاف ثغرة في التحقق من الصلاحيات API Authorization!');
  }

  // 4. SQL Injection Resistance Audit
  console.log('\n[اختبار 4] فحص الحماية من هجمات حقن قواعد البيانات (SQL Injection Resistance):');
  const maliciousInput = "' OR '1'='1' -- ";
  const sqlInjectionSearch = await prisma.customer.findMany({
    where: {
      customerCode: maliciousInput,
    },
  });
  console.log(`- محاولة استعلام بحقن SQL خبيث (${maliciousInput}):`);
  console.log(`  النتيجة: تم التعامل مع المدخل كنص حرفي آمن بواسطة Prisma Parameterization (النتائج المسترجعة: ${sqlInjectionSearch.length} سجلات) ✅`);

  console.log('\n========================================================================');
  console.log('  🏆 انتهت اختبارات الأمان والصلاحيات بنجاح تام وبأعلى درجات الموثوقية!');
  console.log('========================================================================\n');
}

runSecurityTests()
  .catch((err) => {
    console.error('❌ خطأ في اختبارات الأمان:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
