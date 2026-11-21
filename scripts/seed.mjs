import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- بدء تهيئة قاعدة البيانات والبيانات الأساسية للنظام ---');

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

  // 5. Chart of Accounts (دليل الحسابات الأساسي)
  const defaultAccounts = [
    { code: '1010', name: 'الصندوق النقدي المصري الرئيسي (Main EGP Safe)', type: 'cash_safe', currency: 'EGP', balance: 1000000 },
    { code: '1020', name: 'الصندوق النقدي السوداني (Main SDG Safe)', type: 'cash_safe', currency: 'SDG', balance: 5000000 },
    { code: '1030', name: 'حساب بنكك الرئيسي (Bankak Account - BOK)', type: 'bankak', currency: 'SDG', balance: 10000000 },
    { code: '1040', name: 'الحساب البنكي التجاري المصري (EGP Bank Account)', type: 'bank', currency: 'EGP', balance: 500000 },
    { code: '1050', name: 'عهدة الموظف محمد (Custody Mohammed)', type: 'employee_custody', currency: 'EGP', balance: 500000 },
    { code: '2010', name: 'التزامات وحسابات العملاء المفتوحة (Customer Liabilities)', type: 'customer_liability', currency: 'EGP', balance: 0 },
    { code: '2020', name: 'التزامات وحسابات الموردين (Supplier Liabilities)', type: 'supplier_liability', currency: 'SDG', balance: 0 },
    { code: '3010', name: 'رأس المال المستثمر (Invested Capital)', type: 'capital', currency: 'EGP', balance: 2000000 },
    { code: '4010', name: 'أرباح فروق أسعار الصرف (Exchange Profits)', type: 'profit_loss', currency: 'EGP', balance: 0 },
    { code: '5010', name: 'المصروفات التشغيلية والعمومية (Operating Expenses)', type: 'expense', currency: 'EGP', balance: 0 },
  ];

  for (const acc of defaultAccounts) {
    await prisma.account.upsert({
      where: { accountCode: acc.code },
      update: { currentBalance: acc.balance },
      create: {
        accountCode: acc.code,
        name: acc.name,
        accountType: acc.type,
        currency: acc.currency,
        openingBalance: acc.balance,
        currentBalance: acc.balance,
        status: 'active',
      },
    });
  }

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

  // 7. Initial Exchange Rates
  await prisma.exchangeRate.createMany({
    data: [
      { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'customer', rate: 200, createdBy: adminUser.id },
      { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'supplier', rate: 190, createdBy: adminUser.id },
      { fromCurrency: 'EGP', toCurrency: 'SDG', rateType: 'market_benchmark', rate: 195, createdBy: adminUser.id },
    ],
  });

  // 8. Initial Customer: عمر أحمد
  const customerOmar = await prisma.customer.upsert({
    where: { customerCode: 'CUST-1001' },
    update: {},
    create: {
      customerCode: 'CUST-1001',
      name: 'عمر أحمد عبدالله',
      phone: '+249912345678',
      secondaryPhone: '+201112233445',
      whatsapp: '+249912345678',
      identityNumber: 'SD-88291029',
      city: 'الخرطوم / القاهرة',
      address: 'المعادي - القاهرة',
      notes: 'عميل مميز - تحويلات بنكك منتظمة',
      status: 'active',
    },
  });

  // 9. Initial Supplier: شركة النور للصرافة
  const supplierNoor = await prisma.supplier.upsert({
    where: { supplierCode: 'SUP-501' },
    update: {},
    create: {
      supplierCode: 'SUP-501',
      name: 'شركة النور للخدمات المالية والصرافة',
      phone: '+201200000050',
      whatsapp: '+201200000050',
      address: 'وسط البلد - القاهرة',
      notes: 'توريد مبالغ سودانية ومصرية بأسعار الجملة',
      status: 'active',
    },
  });

  // 10. System Settings
  const settings = [
    { key: 'company_name', value: 'شركة النجم لخدمات الصرافة والتحويلات المالية', description: 'اسم المؤسسة' },
    { key: 'primary_currency', value: 'EGP', description: 'العملة المحاسبية المرجعية' },
    { key: 'supported_currencies', value: 'EGP,SDG,USD,SAR,AED', description: 'العملات المدعومة' },
    { key: 'timezone', value: 'Africa/Cairo', description: 'المنطقة الزمنية المعتمدة' },
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

  console.log('✅ تم تهيئة قاعدة البيانات بنجاح: تم إنشاء الأدوار، المستخدمين، دليل الحسابات، أسعار الصرف والإعدادات!');
}

main()
  .catch((e) => {
    console.error('❌ خطأ أثناء تهيئة قاعدة البيانات:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
