'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Building,
  Globe,
  Clock,
  Shield,
  Save,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Undo2,
  Lock,
  RefreshCw,
  Sparkles,
  Info,
} from 'lucide-react';
import type { SettingCategory } from '@/lib/settings/settings-service';

interface SettingDef {
  key: string;
  category: SettingCategory;
  labelAr: string;
  descriptionAr: string;
  type: 'text' | 'number' | 'boolean' | 'currencies_list' | 'select';
  defaultValue: string;
  options?: { value: string; label: string }[];
  isSensitive?: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [originalSettings, setOriginalSettings] = useState<Record<string, string>>({});
  const [definitions, setDefinitions] = useState<SettingDef[]>([]);
  const [canEdit, setCanEdit] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<SettingCategory>('organization');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fetchSettings = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/v1/settings');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تحميل إعدادات النظام');
      }
      setSettings(data.data || {});
      setOriginalSettings(data.data || {});
      setDefinitions(data.definitions || []);
      setCanEdit(Boolean(data.canEdit));
    } catch (err: any) {
      setErrorMessage(err.message || 'خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  // Compute modified fields count
  const modifiedKeys = useMemo(() => {
    const changed: string[] = [];
    for (const key of Object.keys(settings)) {
      if (settings[key] !== originalSettings[key]) {
        changed.push(key);
      }
    }
    return changed;
  }, [settings, originalSettings]);

  const hasUnsavedChanges = modifiedKeys.length > 0;

  // Warn user on leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleChange = (key: string, val: string) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
    // Clear field-specific error when modified
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleReset = () => {
    setSettings({ ...originalSettings });
    setFieldErrors({});
    setErrorMessage('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    setSaving(true);
    setSuccessMessage('');
    setErrorMessage('');
    setFieldErrors({});

    // Client-side quick validations
    const localErrors: Record<string, string> = {};
    if (settings.company_name && settings.company_name.trim().length < 3) {
      localErrors.company_name = 'اسم المؤسسة يجب ألا يقل عن 3 أحرف';
    }
    if (settings.ocr_min_confidence) {
      const conf = Number(settings.ocr_min_confidence);
      if (isNaN(conf) || conf < 50 || conf > 100) {
        localErrors.ocr_min_confidence = 'الحد الأدنى لدرجة دقة OCR يجب أن يكون بين 50% و 100%';
      }
    }
    if (settings.decimal_places) {
      const dec = Number(settings.decimal_places);
      if (isNaN(dec) || dec < 0 || dec > 4) {
        localErrors.decimal_places = 'عدد الخانات العشرية يجب أن يكون بين 0 و 4';
      }
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setErrorMessage('يرجى تصحيح الأخطاء الموضحة أدناه قبل الحفظ');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل حفظ التعديلات في النظام');
      }

      setOriginalSettings({ ...settings });
      setSuccessMessage(data.message || 'تم حفظ إعدادات النظام بصورة ذرية وتسجيلها في سجل التدقيق بنجاح');
      // Scroll to top of form
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const categories = [
    {
      id: 'organization' as SettingCategory,
      title: 'بيانات المنشأة',
      subtitle: 'الاسم، العنوان، الهاتف والرقم الضريبي',
      icon: Building,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      id: 'currencies' as SettingCategory,
      title: 'العملات والسياسة المالية',
      subtitle: 'العملة الأساسية، سلة العملات والخانات العشرية',
      icon: Globe,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      id: 'time_date' as SettingCategory,
      title: 'التوقيت والتقويم',
      subtitle: 'المنطقة الزمنية (توقيت القاهرة) والسنة المالية',
      icon: Clock,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
    },
    {
      id: 'operations' as SettingCategory,
      title: 'التشغيل والرقابة وبنكك',
      subtitle: 'قفل اليوميات، دقة OCR وأرصدة الخزائن',
      icon: Shield,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  const currentTabDefs = definitions.filter((d) => d.category === activeTab);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto pb-16">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 pb-5">
          <div>
            <div className="flex items-center space-x-2.5 space-x-reverse">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                إعدادات وتهيئة النظام
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                Production-Grade
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              إدارة إعدادات المؤسسة، السياسة المحاسبية والعملات، التوقيت المعتمد وقواعد الرقابة والتشغيل
            </p>
          </div>

          <div className="flex items-center space-x-2 space-x-reverse self-start sm:self-auto">
            <button
              onClick={fetchSettings}
              disabled={loading}
              title="تحديث الإعدادات من الخادم"
              className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shadow-sm transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Read-Only Warning for non-admins */}
        {!loading && !canEdit && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start space-x-3 space-x-reverse text-amber-900">
            <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm">
              <span className="font-bold block">وضع القراءة والاطلاع فقط (Read-Only Mode)</span>
              <span>
                أنت تستعرض إعدادات النظام بصلاحية استعراض فقط. صلاحية تعديل وحفظ إعدادات النظام الحساسة مقتصرة حصراً على مدير النظام أو المدير العام وفقاً لمعايير الصلاحيات (RBAC).
              </span>
            </div>
          </div>
        )}

        {/* Success Banner */}
        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 flex items-center space-x-3 space-x-reverse text-xs sm:text-sm font-bold animate-in fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span className="flex-1">{successMessage}</span>
            <button
              onClick={() => setSuccessMessage('')}
              className="text-emerald-700 hover:text-emerald-900 text-xs underline font-normal"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 flex items-start space-x-3 space-x-reverse text-xs sm:text-sm font-bold animate-in fade-in">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <span className="flex-1 whitespace-pre-wrap">{errorMessage}</span>
            <button
              onClick={() => setErrorMessage('')}
              className="text-rose-700 hover:text-rose-900 text-xs underline font-normal"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* Unsaved Changes Banner */}
        {hasUnsavedChanges && canEdit && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-between gap-3 text-blue-900 animate-in slide-in-from-top-2">
            <div className="flex items-center space-x-2.5 space-x-reverse">
              <AlertTriangle className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <span className="text-xs sm:text-sm font-bold">
                لديك ({modifiedKeys.length}) تعديل(ات) غير محفوظ(ة) في إعدادات النظام.
              </span>
            </div>
            <div className="flex items-center space-x-2 space-x-reverse">
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-all flex items-center space-x-1.5 space-x-reverse"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>تراجع</span>
              </button>
            </div>
          </div>
        )}

        {/* Category Tabs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeTab === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveTab(cat.id)}
                className={`p-3.5 sm:p-4 rounded-2xl border text-right transition-all flex flex-col justify-between ${
                  isActive
                    ? 'bg-white border-blue-600 ring-2 ring-blue-500/20 shadow-sm'
                    : 'bg-white/80 border-slate-200 hover:bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-2">
                  <div className={`p-2 rounded-xl ${cat.bgColor}`}>
                    <Icon className={`w-4 h-4 ${cat.color}`} />
                  </div>
                  {isActive && (
                    <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                  )}
                </div>
                <div>
                  <h3 className={`font-bold text-xs sm:text-sm ${isActive ? 'text-blue-950 font-black' : 'text-slate-800'}`}>
                    {cat.title}
                  </h3>
                  <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                    {cat.subtitle}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Form Container */}
        {loading ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-4 shadow-sm">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
            <p className="text-sm font-bold text-slate-600">جاري تحميل إعدادات النظام من قاعدة البيانات...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden divide-y divide-slate-100">
              <div className="p-4 sm:p-6 bg-slate-50/50 flex items-center justify-between border-b border-slate-100">
                <div className="flex items-center space-x-2.5 space-x-reverse">
                  {React.createElement(categories.find((c) => c.id === activeTab)?.icon || Building, {
                    className: 'w-5 h-5 text-blue-600',
                  })}
                  <div>
                    <h2 className="font-black text-sm sm:text-base text-slate-900">
                      {categories.find((c) => c.id === activeTab)?.title}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {categories.find((c) => c.id === activeTab)?.subtitle}
                    </p>
                  </div>
                </div>

                <div className="text-[11px] font-bold text-slate-400 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                  {currentTabDefs.length} إعداد(ات)
                </div>
              </div>

              {/* Dynamic Fields for Active Tab */}
              <div className="p-4 sm:p-6 space-y-5">
                {currentTabDefs.map((def) => {
                  const val = settings[def.key] ?? def.defaultValue;
                  const isModified = settings[def.key] !== originalSettings[def.key];
                  const hasError = Boolean(fieldErrors[def.key]);

                  return (
                    <div
                      key={def.key}
                      className={`p-4 rounded-2xl border transition-all ${
                        isModified
                          ? 'border-blue-300 bg-blue-50/20'
                          : hasError
                          ? 'border-rose-300 bg-rose-50/20'
                          : 'border-slate-200/70 bg-white'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center space-x-2 space-x-reverse">
                            <label className="text-xs sm:text-sm font-bold text-slate-900">
                              {def.labelAr}
                            </label>
                            {def.isSensitive && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-100 text-rose-700 border border-rose-200">
                                حساس رقابياً
                              </span>
                            )}
                            {isModified && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-blue-800">
                                معدل
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] sm:text-xs text-slate-500 mt-1 leading-relaxed">
                            {def.descriptionAr}
                          </p>
                        </div>

                        <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded self-start sm:self-auto">
                          {def.key}
                        </span>
                      </div>

                      {/* Input based on definition type */}
                      <div className="mt-3">
                        {def.type === 'select' && (
                          <select
                            disabled={!canEdit}
                            value={val}
                            onChange={(e) => handleChange(def.key, e.target.value)}
                            className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-bold rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed min-h-[44px]"
                          >
                            {def.options?.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        )}

                        {def.type === 'boolean' && (
                          <div className="flex items-center space-x-3 space-x-reverse">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => handleChange(def.key, val === 'true' ? 'false' : 'true')}
                              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                                val === 'true' ? 'bg-blue-600' : 'bg-slate-200'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  val === 'true' ? 'translate-x-[-20px]' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <span className="text-xs font-bold text-slate-700">
                              {val === 'true' ? 'مفعل (نشط)' : 'معطل (غير نشط)'}
                            </span>
                          </div>
                        )}

                        {def.type === 'currencies_list' && (
                          <div className="space-y-2">
                            <input
                              type="text"
                              disabled={!canEdit}
                              value={val}
                              onChange={(e) => handleChange(def.key, e.target.value)}
                              placeholder="EGP,SDG,USD,SAR,AED"
                              className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-mono font-bold rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed min-h-[44px]"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {val.split(',').map((c) => c.trim()).filter(Boolean).map((code) => (
                                <span
                                  key={code}
                                  className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 text-[11px] font-mono font-bold border border-emerald-200"
                                >
                                  {code}
                                </span>
                              ))}
                            </div>
                            <p className="text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-start space-x-1.5 space-x-reverse mt-1">
                              <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                              <span>
                                حماية محاسبية صارمة: لن يقبل النظام حذف أي عملة لها قيود تاريخية في دفتر الأستاذ أو حسابات مالية نشطة ذات رصيد.
                              </span>
                            </p>
                          </div>
                        )}

                        {def.type === 'number' && (
                          <input
                            type="number"
                            inputMode="numeric"
                            disabled={!canEdit}
                            value={val}
                            onChange={(e) => handleChange(def.key, e.target.value)}
                            className="w-full sm:w-64 px-3.5 py-2.5 text-xs sm:text-sm font-mono font-bold rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed min-h-[44px]"
                          />
                        )}

                        {def.type === 'text' && (
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={val}
                            onChange={(e) => handleChange(def.key, e.target.value)}
                            className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed min-h-[44px]"
                          />
                        )}

                        {hasError && (
                          <p className="text-[11px] text-rose-600 font-bold mt-1.5 flex items-center space-x-1 space-x-reverse">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{fieldErrors[def.key]}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Form Action Footer */}
              <div className="p-4 sm:p-6 bg-slate-50/70 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-500 flex items-center space-x-2 space-x-reverse self-start sm:self-auto">
                  <Shield className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>جميع التعديلات تُحفظ ذرياً وتُوثق في سجل التدقيق الرقابي بالبصمة الزمنية.</span>
                </div>

                <div className="flex items-center space-x-3 space-x-reverse w-full sm:w-auto">
                  {hasUnsavedChanges && canEdit && (
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={saving}
                      className="w-1/2 sm:w-auto px-5 py-2.5 text-xs sm:text-sm font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-all min-h-[44px]"
                    >
                      إلغاء التغييرات
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={!canEdit || saving || !hasUnsavedChanges}
                    className="w-full sm:w-auto px-8 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all flex items-center justify-center space-x-2 space-x-reverse min-h-[44px]"
                  >
                    {saving ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>جاري الحفظ الذري...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>حفظ إعدادات النظام</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
