'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Settings,
  Save,
  Download,
  Building,
  Globe,
  Clock,
  Shield,
  CheckCircle2,
} from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/v1/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSettings(data.data || {});
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: string, val: string) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل حفظ الإعدادات');
      }
      setMessage('تم حفظ إعدادات النظام بنجاح');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">إعدادات النظام والتهيئة (System Settings)</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            تخصيص بيانات المؤسسة، العملات المعتمدة، المنطقة الزمنية وإعدادات محرك OCR
          </p>
        </div>

        {message && (
          <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-900 flex items-center space-x-2 space-x-reverse text-xs sm:text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 sm:space-y-6">
          {/* Company Info Box */}
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-sm sm:text-base text-slate-900 border-b border-slate-100 pb-3 flex items-center space-x-2 space-x-reverse">
              <Building className="w-4 h-4 text-blue-600" />
              <span>بيانات المؤسسة والترويسة الرسمية</span>
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم المنشأة / المكتب</label>
              <input
                type="text"
                value={settings.company_name || ''}
                onChange={(e) => handleChange('company_name', e.target.value)}
                className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              />
            </div>
          </div>

          {/* Currencies & Accounting */}
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-sm sm:text-base text-slate-900 border-b border-slate-100 pb-3 flex items-center space-x-2 space-x-reverse">
              <Globe className="w-4 h-4 text-emerald-600" />
              <span>العملات والسياسة المحاسبية</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">العملة المحاسبية الأساسية</label>
                <input
                  type="text"
                  value={settings.primary_currency || 'EGP'}
                  onChange={(e) => handleChange('primary_currency', e.target.value)}
                  className="w-full px-3 py-2.5 text-xs sm:text-sm font-bold font-mono rounded-xl border border-slate-200 min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">العملات المدعومة</label>
                <input
                  type="text"
                  value={settings.supported_currencies || 'EGP,SDG,USD,SAR,AED'}
                  onChange={(e) => handleChange('supported_currencies', e.target.value)}
                  className="w-full px-3 py-2.5 text-xs sm:text-sm font-bold font-mono rounded-xl border border-slate-200 min-h-[44px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المنطقة الزمنية (Timezone)</label>
              <input
                type="text"
                value={settings.timezone || 'Africa/Cairo'}
                onChange={(e) => handleChange('timezone', e.target.value)}
                className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
              />
            </div>
          </div>

          {/* OCR Engine Settings */}
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-sm sm:text-base text-slate-900 border-b border-slate-100 pb-3 flex items-center space-x-2 space-x-reverse">
              <Shield className="w-4 h-4 text-purple-600" />
              <span>إعدادات محرك بنكك والتحقق الذكي (OCR)</span>
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">الحد الأدنى لنسبة الثقة (Confidence Threshold %)</label>
              <input
                type="number"
                inputMode="numeric"
                value={settings.ocr_min_confidence || '70'}
                onChange={(e) => handleChange('ocr_min_confidence', e.target.value)}
                className="w-full px-3 py-2.5 text-xs sm:text-sm font-mono font-bold rounded-xl border border-slate-200 min-h-[44px]"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                أي إشعار تقل دقته عن هذه النسبة يتطلب مراجعة وتأكيداً يدوياً من موظف البيانات أو المحاسب.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full sm:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50 min-h-[48px]"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}</span>
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
