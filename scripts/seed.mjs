import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- بدء تهيئة قاعدة البيانات والبيانات الأساسية للنظام ---');

  // Safety Guard: Only wipe if explicitly requested with ALLOW_DATABASE_RESET=true in non-production
  if (process.env.ALLOW_DATABASE_RESET === 'true' && process.env.NODE_ENV !== 'production') {
    console.log('⚠️ جاري تفريغ بيانات المعاملات القديمة بسبب تمرير ALLOW_DATABASE_RESET...');
    await prisma.ledgerLine.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.cashPayoutVoucher.deleteMany();
    await prisma.bankakReceipt.deleteMany();
    await prisma.exchangeTransaction.deleteMany();
    await prisma.custodyTransaction.deleteMany();
    await prisma.employeeCustody.deleteMany();
    await prisma.customerSession.deleteMany();
    await prisma.dailyClosing.deleteMany();
    await prisma.supplierTransaction.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.debtPayment.deleteMany();
    await prisma.debt.deleteMany();
    await prisma.capitalTransaction.deleteMany();
    console.log('1. تم تفريغ البيانات القديمة بنجاح');
  } else {
    console.log('1. تم تفعيل وضع حماية بيانات الإنتاج (Production Data Protection) - لن يتم حذف أي معاملات حقيقية.');
  }

  // 1. Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'مدير النظام - كامل الصلاحيات الإدارية والمالية والرقابية',
    },
  });

  const accountantRole = await prisma.role.upsert({
    where: { name: 'accountant' },
    update: {},
    create: {
      name: 'accountant',
      description: 'المحاسب المالي - إدارة الحسابات، القيود، التسويات وإعداد التقارير',
    },
  });

  const custodyRole = await prisma.role.upsert({
    where: { name: 'custody_officer' },
    update: {},
    create: {
      name: 'custody_officer',
      description: 'مسؤول تسليم الأموال والعهد - تسليم الكاش للعملاء ومطابقة العهدة',
    },
  });

  const dataEntryRole = await prisma.role.upsert({
    where: { name: 'data_entry' },
    update: {},
    create: {
      name: 'data_entry',
      description: 'مدخل بيانات - رفع إيصالات بنكك والتحقق الأولي',
    },
  });

  // 2. Permissions
  const permissionsList = [
    { key: 'customers.read', name: 'عرض العملاء', description: 'الاطلاع على ملفات العملاء' },
    { key: 'customers.create', name: 'إضافة عميل', description: 'إنشاء ملف عميل جديد' },
    { key: 'customers.update', name: 'تعديل عميل', description: 'تحديث بيانات العميل' },
    { key: 'receipts.read', name: 'عرض الإيصالات', description: 'مشاهدة إيصالات بنكك' },
    { key: 'receipts.upload', name: 'رفع الإيصالات', description: 'رفع صور وملفات الإيصالات' },
    { key: 'receipts.approve', name: 'اعتماد الإيصال', description: 'اعتماد الإيصال وتسجيل الأثر المالي' },
    { key: 'receipts.reject', name: 'رفض الإيصال', description: 'رفض إيصال مشبوه أو مكرر' },
    { key: 'accounts.read', name: 'عرض الحسابات', description: 'الاطلاع على الصناديق والأرصدة' },
    { key: 'accounts.create', name: 'إنشاء حساب', description: 'إضافة صندوق أو حساب مالي جديد' },
    { key: 'accounts.transfer', name: 'تحويل مالي', description: 'التحويل بين الصناديق والحسابات' },
    { key: 'custody.manage', name: 'إدارة العهد', description: 'تسليم وتسوية عهد الموظفين' },
    { key: 'custody.deliver', name: 'تسليم كاش للعميل', description: 'صرف الجنيه المصري للعملاء' },
    { key: 'suppliers.manage', name: 'إدارة الموردين', description: 'عمليات الشراء والبيع والتسويات مع الموردين' },
    { key: 'daily_closing.close', name: 'إغلاق اليوم', description: 'إغلاق الحسابات ومطابقة الصناديق نهاية اليوم' },
    { key: 'daily_closing.reopen', name: 'إعادة فتح اليوم', description: 'إعادة فتح يوم مغلق وفق ضوابط خاصة' },
    { key: 'reports.read', name: 'عرض التقارير', description: 'مشاهدة وطباعة وتصدير التقارير المالية' },
    { key: 'capital.manage', name: 'إدارة رأس المال', description: 'تسجيل مساهمات وسحوبات رأس المال' },
    { key: 'expenses.manage', name: 'إدارة المصروفات', description: 'تسجيل واعتماد المصروفات التشغيلية' },
    { key: 'debts.manage', name: 'إدارة الديون', description: 'متابعة وجدولة ديون العملاء والموردين' },
  ];

  for (const perm of permissionsList) {
    const p = await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm,
    });
    // Assign all to Admin
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: p.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: p.id,
      },
    });
  }
  console.log('2. تم إنشاء الأدوار والصلاحيات بنجاح');

  // 3. Default Users
  const passwordHash = await bcrypt.hash('admin123', 10);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@exchange.com' },
    update: {},
    create: {
      name: 'المدير العام (System Admin)',
      email: 'admin@exchange.com',
      phone: '+201000000001',
      passwordHash,
      roleId: adminRole.id,
      status: 'active',
    },
  });

  const accountantUser = await prisma.user.upsert({
    where: { email: 'accountant@exchange.com' },
    update: {},
    create: {
      name: 'أحمد المحاسب (Financial Accountant)',
      email: 'accountant@exchange.com',
      phone: '+201000000002',
      passwordHash,
      roleId: accountantRole.id,
      status: 'active',
    },
  });

  const custodyUser = await prisma.user.upsert({
    where: { email: 'mohammed@exchange.com' },
    update: {},
    create: {
      name: 'محمد موظف التسليم (Cashier Mohammed)',
      email: 'mohammed@exchange.com',
      phone: '+201000000003',
      passwordHash,
      roleId: custodyRole.id,
      status: 'active',
    },
  });

  // 4. Employee record for Mohammed
  const employeeMohammed = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-001' },
    update: {},
    create: {
      employeeCode: 'EMP-001',
      name: 'محمد موظف التسليم',
      phone: '+201000000003',
      identityNumber: '29001011234567',
      jobTitle: 'مسؤول تسليم النقدية والخزينة',
      status: 'active',
      userId: custodyUser.id,
    },
  });

  // 5. Chart of Accounts (دليل الحسابات الأساسي - أرصدة صفرية نظيفة للنظام الجديد)
  const defaultAccounts = [
    { code: '1010', name: 'الصندوق النقدي المصري الرئيسي (Main EGP Safe)', type: 'cash_safe', currency: 'EGP' },
    { code: '1020', name: 'الصندوق النقدي السوداني (Main SDG Safe)', type: 'cash_safe', currency: 'SDG' },
    { code: '1030', name: 'حساب بنكك الرئيسي (Bankak Account - BOK)', type: 'bankak', currency: 'SDG' },
    { code: '1040', name: 'الحساب البنكي التجاري المصري (EGP Bank Account)', type: 'bank', currency: 'EGP' },
    { code: '1050', name: 'عهدة الموظف محمد (Custody Mohammed)', type: 'employee_custody', currency: 'EGP' },
    { code: '1060', name: 'حساب وسيط تسوية وتبادل العملات - مصري (Currency Clearing EGP)', type: 'clearing', currency: 'EGP' },
    { code: '1065', name: 'حساب وسيط تسوية وتبادل العملات - سوداني (Currency Clearing SDG)', type: 'clearing', currency: 'SDG' },
    { code: '2010', name: 'التزامات وحسابات العملاء المفتوحة - مصري (Customer Liabilities EGP)', type: 'customer_liability', currency: 'EGP' },
    { code: '2015', name: 'التزامات وحسابات العملاء المفتوحة - سوداني (Customer Liabilities SDG)', type: 'customer_liability', currency: 'SDG' },
    { code: '2020', name: 'التزامات وحسابات الموردين (Supplier Liabilities)', type: 'supplier_liability', currency: 'SDG' },
    { code: '3010', name: 'رأس المال المستثمر (Invested Capital)', type: 'capital', currency: 'EGP' },
    { code: '4010', name: 'أرباح فروق أسعار الصرف (Exchange Profits)', type: 'profit_loss', currency: 'EGP' },
    { code: '5010', name: 'المصروفات التشغيلية والعمومية (Operating Expenses)', type: 'expense', currency: 'EGP' },
  ];

  for (const acc of defaultAccounts) {
    await prisma.account.upsert({
      where: { accountCode: acc.code },
      update: { accountType: acc.type },
      create: {
        accountCode: acc.code,
        name: acc.name,
        accountType: acc.type,
        currency: acc.currency,
        openingBalance: 0,
        currentBalance: 0,
        status: 'active',
      },
    });
  }
  console.log('5. تم تثبيت دليل الحسابات بأرصدة افتتاحية صفرية معتمدة');

  // 6. Expense Categories
  const categories = [
    { name: 'إيجار المقر', description: 'مصاريف إيجار المكتب ومقرات الفروع' },
    { name: 'رواتب وبدلات الموظفين', description: 'رواتب الموظفين والعمولات والحوافز' },
    { name: 'كهرباء ومرافق وإنترنت', description: 'فواتير استهلاك الكهرباء وخطوط الإنترنت والاتصالات' },
    { name: 'رسوم بنكية وعمولات تحويل', description: 'رسوم خصم البنوك والتحويلات المالية' },
    { name: 'نقل ومواصلات وتأمين', description: 'مصاريف نقل وتأمين الأموال' },
    { name: 'مصروفات تشغيلية أخرى', description: 'أدوات مكتبية ومستلزمات تشغيل عامة' },
  ];

  for (const cat of categories) {
    await prisma.expenseCategory.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }
  console.log('6. تم تثبيت تصنيفات المصروفات الأساسية');

  // 7. System Settings
  const settings = [
    { key: 'company_name', value: 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)', description: 'اسم المؤسسة' },
    { key: 'company_logo', value: '/brand/logo.png', description: 'شعار المؤسسة' },
    { key: 'company_phone', value: '+20 100 000 0000', description: 'هاتف التواصل الرئيسي' },
    { key: 'company_address', value: 'القاهرة، جمهورية مصر العربية', description: 'العنوان والمقر الرئيسي' },
    { key: 'company_tax_number', value: '100-200-300', description: 'الرقم الضريبي والسجل التجاري' },
    { key: 'primary_currency', value: 'EGP', description: 'العملة المحاسبية المرجعية' },
    { key: 'supported_currencies', value: 'EGP,SDG,USD,SAR,AED', description: 'العملات المدعومة' },
    { key: 'decimal_places', value: '2', description: 'عدد الخانات العشرية المعروضة' },
    { key: 'timezone', value: 'Africa/Cairo', description: 'المنطقة الزمنية المعتمدة (توقيت القاهرة شتاءً UTC+2 وصيفاً UTC+3)' },
    { key: 'fiscal_year_start_month', value: '1', description: 'شهر بداية السنة المالية' },
    { key: 'daily_closing_auto_lock', value: 'true', description: 'منع تعديل العمليات بعد الإغلاق اليومي' },
    { key: 'ocr_min_confidence', value: '70', description: 'الحد الأدنى لدرجة الثقة لاعتماد OCR التلقائي' },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log('7. تم تثبيت إعدادات النظام والهوية التجارية الرسمية');

  console.log('✅ تم تهيئة النظام ببيانات النظام الأساسية (System Seed Data) فقط، بدون أي بيانات تجريبية أو وهمية!');
}

main()
  .catch((e) => {
    console.error('❌ خطأ أثناء تهيئة قاعدة البيانات:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
