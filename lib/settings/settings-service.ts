import { prisma } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit';

export type SettingCategory = 'organization' | 'currencies' | 'time_date' | 'operations';

export interface SettingDefinition {
  key: string;
  category: SettingCategory;
  labelAr: string;
  descriptionAr: string;
  type: 'text' | 'number' | 'boolean' | 'currencies_list' | 'select';
  defaultValue: string;
  options?: { value: string; label: string }[];
  isSensitive?: boolean;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // 1. Organization Information
  {
    key: 'company_name',
    category: 'organization',
    labelAr: 'اسم المنشأة / مكتب الصرافة',
    descriptionAr: 'الاسم الرسمي المعتمد للمؤسسة في كافة التقارير وسندات الصرف وكشوفات الحسابات',
    type: 'text',
    defaultValue: 'شركة النجم لخدمات الصرافة والتحويلات المالية',
  },
  {
    key: 'company_phone',
    category: 'organization',
    labelAr: 'رقم هاتف المنشأة / خدمة العملاء',
    descriptionAr: 'رقم الهاتف المعتمد المطبوع على إيصالات الصرف وكشوفات حسابات العملاء',
    type: 'text',
    defaultValue: '+20 100 000 0000',
  },
  {
    key: 'company_address',
    category: 'organization',
    labelAr: 'العنوان والمقر الرئيسي',
    descriptionAr: 'العنوان الجغرافي للمقر الرئيسي للمنشأة والمطبوع في ترويسة التقارير الرسمية',
    type: 'text',
    defaultValue: 'القاهرة، جمهورية مصر العربية',
  },
  {
    key: 'company_tax_number',
    category: 'organization',
    labelAr: 'الرقم الضريبي / السجل التجاري',
    descriptionAr: 'رقم التسجيل الضريبي أو السجل التجاري للمؤسسة المطبوع في الفواتير والسندات',
    type: 'text',
    defaultValue: '100-200-300',
  },

  // 2. Currencies & Financial Policy
  {
    key: 'primary_currency',
    category: 'currencies',
    labelAr: 'العملة المحاسبية الأساسية (Base Currency)',
    descriptionAr: 'العملة المرجعية الأساسية لإعداد الميزانية العمومية، تقارير الأرباح والخسائر وحسابات رأس المال',
    type: 'select',
    defaultValue: 'EGP',
    options: [
      { value: 'EGP', label: 'الجنيه المصري (EGP)' },
      { value: 'USD', label: 'الدولار الأمريكي (USD)' },
      { value: 'SDG', label: 'الجنيه السوداني (SDG)' },
      { value: 'SAR', label: 'الريال السعودي (SAR)' },
      { value: 'AED', label: 'الدرهم الإماراتي (AED)' },
    ],
    isSensitive: true,
  },
  {
    key: 'supported_currencies',
    category: 'currencies',
    labelAr: 'سلة العملات المدعومة (Supported Currencies)',
    descriptionAr: 'قائمة رموز العملات المصرح بتداولها في الخزائن والصناديق وأسعار الصرف، مفصولة بفواصل (e.g. EGP,SDG,USD,SAR,AED)',
    type: 'currencies_list',
    defaultValue: 'EGP,SDG,USD,SAR,AED',
    isSensitive: true,
  },
  {
    key: 'decimal_places',
    category: 'currencies',
    labelAr: 'عدد الخانات العشرية (Decimal Places)',
    descriptionAr: 'عدد الخانات العشرية المستخدمة لعرض مبالغ وأرصدة العملات في الجداول والتقارير (0 إلى 4)',
    type: 'number',
    defaultValue: '2',
  },

  // 3. Timezone & Operating Hours
  {
    key: 'timezone',
    category: 'time_date',
    labelAr: 'المنطقة الزمنية للنظام (Timezone)',
    descriptionAr: 'المنطقة الزمنية لتحديد حدود اليوم المالي وتوقيت القيود وسجلات التدقيق (معتمدة Africa/Cairo لدعم التوقيت الشتوي والصيفي تلقائياً)',
    type: 'select',
    defaultValue: 'Africa/Cairo',
    options: [
      { value: 'Africa/Cairo', label: 'توقيت القاهرة - مصر (Africa/Cairo UTC+2 / UTC+3 DST)' },
      { value: 'Asia/Riyadh', label: 'توقيت الرياض - السعودية (Asia/Riyadh UTC+3)' },
      { value: 'Asia/Dubai', label: 'توقيت دبي - الإمارات (Asia/Dubai UTC+4)' },
      { value: 'Africa/Khartoum', label: 'توقيت الخرطوم - السودان (Africa/Khartoum UTC+2)' },
      { value: 'UTC', label: 'التوقيت العالمي الموحد (UTC)' },
    ],
    isSensitive: true,
  },
  {
    key: 'fiscal_year_start_month',
    category: 'time_date',
    labelAr: 'شهر بداية السنة المالية (Fiscal Year Start)',
    descriptionAr: 'الشهر الميلادي الذي تبدأ منه السنة المالية لاحتساب الأرباح المرحلة وأرباح الفترة (1 إلى 12)',
    type: 'number',
    defaultValue: '1',
  },

  // 4. Operations & OCR Engine
  {
    key: 'daily_closing_auto_lock',
    category: 'operations',
    labelAr: 'قفل اليوم المالي التلقائي بعد الإغلاق',
    descriptionAr: 'تجميد وحظر إضافة أو تعديل أي عمليات مالية أو قيود محاسبية على الأيام المغلقة مالياً',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: 'ocr_min_confidence',
    category: 'operations',
    labelAr: 'الحد الأدنى لدرجة دقة إشعار بنكك (OCR Confidence %)',
    descriptionAr: 'نسبة الدقة المطلوبة لاعتماد الإيصال تلقائياً؛ الإشعارات الأقل من هذه النسبة تُحول للمراجعة اليدوية للمحاسب (50% إلى 100%)',
    type: 'number',
    defaultValue: '70',
  },
  {
    key: 'allow_negative_inventory',
    category: 'operations',
    labelAr: 'السماح بالأرصدة السالبة في الخزائن',
    descriptionAr: 'السماح بصرف مبالغ من الخزينة حتى لو تجاوز المبلغ الرصيد الفعلي المتوفر (يُوصى بإيقافه للحفاظ على الانضباط الرقابي)',
    type: 'boolean',
    defaultValue: 'false',
    isSensitive: true,
  },
];

export const DEFAULT_SETTINGS_MAP: Record<string, string> = SETTING_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.key] = def.defaultValue;
    return acc;
  },
  {} as Record<string, string>
);

// In-memory cache for fast lookups (30 seconds TTL)
let cachedSettings: Record<string, string> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30000;

export function invalidateSettingsCache(): void {
  cachedSettings = null;
  cacheTimestamp = 0;
}

/**
 * Loads all system settings from PostgreSQL, populating defaults for any missing keys.
 */
export async function getSystemSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
    return { ...cachedSettings };
  }

  const dbRows = await prisma.setting.findMany();
  const settingsMap: Record<string, string> = { ...DEFAULT_SETTINGS_MAP };

  for (const row of dbRows) {
    settingsMap[row.key] = row.value;
  }

  cachedSettings = settingsMap;
  cacheTimestamp = now;

  return { ...settingsMap };
}

/**
 * Retrieves a single setting by key, with type conversion and fallback default.
 */
export async function getSystemSetting<T = string>(
  key: string,
  defaultValue?: T
): Promise<T> {
  const settings = await getSystemSettings();
  const rawValue = settings[key];

  if (rawValue === undefined) {
    return (defaultValue !== undefined ? defaultValue : (DEFAULT_SETTINGS_MAP[key] as any)) as T;
  }

  if (typeof defaultValue === 'number') {
    const num = Number(rawValue);
    return (isNaN(num) ? defaultValue : num) as unknown as T;
  }

  if (typeof defaultValue === 'boolean') {
    return (rawValue === 'true' || rawValue === '1') as unknown as T;
  }

  return rawValue as unknown as T;
}

/**
 * Validates updates against system rules, accounting safeguards, and historical constraints.
 */
export async function validateSettingsUpdates(
  updates: Record<string, any>
): Promise<{ valid: boolean; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const currentSettings = await getSystemSettings();

  for (const [key, rawVal] of Object.entries(updates)) {
    const def = SETTING_DEFINITIONS.find((d) => d.key === key);
    if (!def) {
      errors[key] = `المفتاح (${key}) ليس من إعدادات النظام المعتمدة`;
      continue;
    }

    const val = String(rawVal ?? '').trim();

    // 1. Company Name validation
    if (key === 'company_name') {
      if (!val || val.length < 3 || val.length > 150) {
        errors[key] = 'اسم المؤسسة يجب أن يكون بين 3 و 150 حرفاً';
      }
    }

    // 2. Company Phone validation
    if (key === 'company_phone') {
      if (val && !/^[+0-9\s\-()]{6,30}$/.test(val)) {
        errors[key] = 'رقم هاتف المنشأة غير صحيح (يجب أن يحتوي على أرقام وصيغة هاتف مقبولة)';
      }
    }

    // 3. Timezone validation
    if (key === 'timezone') {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: val });
      } catch {
        errors[key] = `المنطقة الزمنية (${val}) غير صالحة أو غير مدعومة في المعيار الدولي IANA`;
      }
    }

    // 4. Primary Currency validation
    if (key === 'primary_currency') {
      const cleanCur = val.toUpperCase();
      if (!/^[A-Z]{3}$/.test(cleanCur)) {
        errors[key] = 'رمز العملة الأساسية يجب أن يتكون من 3 أحرف لاتينية كبيرة (مثل EGP, USD)';
      }

      // Must be in supported currencies
      const targetSupported = (updates.supported_currencies || currentSettings.supported_currencies || '')
        .split(',')
        .map((c: string) => c.trim().toUpperCase());

      if (!targetSupported.includes(cleanCur)) {
        errors[key] = `العملة الأساسية (${cleanCur}) يجب أن تكون مدرجة ضمن سلة العملات المدعومة`;
      }
    }

    // 5. Supported Currencies validation with Historical Accounting Safeguards
    if (key === 'supported_currencies') {
      const newCurrencies = val
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);

      if (newCurrencies.length === 0) {
        errors[key] = 'يجب تحديد عملة واحدة مدعومة على الأقل في النظام';
      }

      for (const cur of newCurrencies) {
        if (!/^[A-Z]{3,4}$/.test(cur)) {
          errors[key] = `رمز العملة (${cur}) غير صالح (يجب أن يتكون من 3 أو 4 أحرف لاتينية)`;
        }
      }

      // Accounting Protection: Cannot remove active currencies having historical ledgers or accounts
      const oldCurrencies = (currentSettings.supported_currencies || '')
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);

      const removedCurrencies = oldCurrencies.filter((c) => !newCurrencies.includes(c));

      if (removedCurrencies.length > 0) {
        // Check if any removed currency exists in accounts or ledger lines
        const conflictingAccount = await prisma.account.findFirst({
          where: { currency: { in: removedCurrencies } },
          select: { currency: true, name: true, accountCode: true },
        });

        if (conflictingAccount) {
          errors[key] = `لا يمكن حذف العملة (${conflictingAccount.currency}) لوجود حساب مالي نشط مرتبط بها (${conflictingAccount.accountCode} - ${conflictingAccount.name})`;
        }

        const conflictingLedger = await prisma.ledgerLine.findFirst({
          where: { currency: { in: removedCurrencies } },
          select: { currency: true },
        });

        if (conflictingLedger) {
          errors[key] = `لا يمكن حذف العملة (${conflictingLedger.currency}) لوجود قيود تاريخية مسجلة بها في دفتر الأستاذ العام`;
        }
      }
    }

    // 6. Decimal Places validation
    if (key === 'decimal_places') {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 0 || num > 4) {
        errors[key] = 'عدد الخانات العشرية يجب أن يكون رقماً صحيحاً بين 0 و 4';
      }
    }

    // 7. Fiscal Year Start Month validation
    if (key === 'fiscal_year_start_month') {
      const month = parseInt(val, 10);
      if (isNaN(month) || month < 1 || month > 12) {
        errors[key] = 'شهر بداية السنة المالية يجب أن يكون بين 1 و 12';
      }
    }

    // 8. OCR Min Confidence validation
    if (key === 'ocr_min_confidence') {
      const conf = parseInt(val, 10);
      if (isNaN(conf) || conf < 50 || conf > 100) {
        errors[key] = 'الحد الأدنى لدرجة دقة OCR يجب أن يكون نسبة مئوية بين 50% و 100%';
      }
    }

    // 9. Boolean flags validation
    if (key === 'daily_closing_auto_lock' || key === 'allow_negative_inventory') {
      if (val !== 'true' && val !== 'false') {
        errors[key] = `القيمة يجب أن تكون true أو false`;
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Atomically saves settings changes within a single database transaction,
 * recording Before/After diffs in AuditLog and invalidating memory cache.
 */
export async function updateSystemSettings(
  updates: Record<string, any>,
  user: { userId: string; name?: string; role: string },
  ipAddress = '127.0.0.1'
): Promise<{ success: boolean; data: Record<string, string>; message: string }> {
  // 1. RBAC Check: Only admin and general_manager can mutate system settings
  if (user.role !== 'admin' && user.role !== 'general_manager') {
    throw new Error('صلاحية تعديل إعدادات النظام مقتصرة على مدير النظام أو المدير العام فقط');
  }

  // 2. Validate all updates
  const validation = await validateSettingsUpdates(updates);
  if (!validation.valid) {
    const errorDetails = Object.values(validation.errors).join(' | ');
    throw new Error(`فشل التحقق من صحة الإعدادات: ${errorDetails}`);
  }

  // 3. Atomic Execution in Prisma Transaction
  return await prisma.$transaction(async (tx) => {
    // Acquire exclusive advisory lock for settings mutations to prevent concurrent overwrites
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('system_settings_lock'))`);

    const currentRows = await tx.setting.findMany();
    const oldValuesMap: Record<string, string> = {};
    for (const row of currentRows) {
      oldValuesMap[row.key] = row.value;
    }

    const changedOldValues: Record<string, string> = {};
    const changedNewValues: Record<string, string> = {};

    for (const [key, rawVal] of Object.entries(updates)) {
      const def = SETTING_DEFINITIONS.find((d) => d.key === key);
      if (!def) continue;

      let valStr = String(rawVal ?? '').trim();
      if (def.type === 'currencies_list') {
        valStr = valStr
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
          .join(',');
      } else if (def.type === 'select' && key === 'primary_currency') {
        valStr = valStr.toUpperCase();
      }

      const prevVal = oldValuesMap[key] !== undefined ? oldValuesMap[key] : def.defaultValue;

      if (prevVal !== valStr) {
        changedOldValues[key] = prevVal;
        changedNewValues[key] = valStr;

        await tx.setting.upsert({
          where: { key },
          update: {
            value: valStr,
            description: def.descriptionAr,
          },
          create: {
            key,
            value: valStr,
            description: def.descriptionAr,
          },
        });
      }
    }

    // Only record audit log if there are actual changes
    if (Object.keys(changedNewValues).length > 0) {
      await logAuditEvent({
        userId: user.userId,
        action: 'UPDATE_SYSTEM_SETTINGS',
        entityType: 'Setting',
        entityId: 'global',
        oldValues: changedOldValues,
        newValues: changedNewValues,
        reason: `تحديث ${Object.keys(changedNewValues).length} إعداد(ات) في النظام بواسطة ${user.name || user.role}`,
        ipAddress,
        status: 'SUCCESS',
        tx,
      });
    }

    // Refresh updated settings map
    const finalRows = await tx.setting.findMany();
    const finalMap: Record<string, string> = { ...DEFAULT_SETTINGS_MAP };
    for (const row of finalRows) {
      finalMap[row.key] = row.value;
    }

    // Invalidate local memory cache
    invalidateSettingsCache();

    return {
      success: true,
      data: finalMap,
      message: `تم حفظ ${Object.keys(changedNewValues).length} تعديل بنجاح وبصورة ذرية`,
    };
  });
}
