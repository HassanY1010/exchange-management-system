'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  TrendingUp,
  Plus,
  RefreshCw,
  Clock,
  ArrowRightLeft,
  ShieldCheck,
} from 'lucide-react';

export default function ExchangeRatesPage() {
  const [rates, setRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Rate Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [fromCurrency, setFromCurrency] = useState('EGP');
  const [toCurrency, setToCurrency] = useState('SDG');
  const [rateType, setRateType] = useState('customer');
  const [rate, setRate] = useState<number | string>(200);
  const [saving, setSaving] = useState(false);

  const fetchRates = () => {
    setLoading(true);
    fetch('/api/v1/exchange-rates')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setRates(data.data || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRates();
  }, []);

  const handleCreateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/v1/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromCurrency,
          toCurrency,
          rateType,
          rate: Number(rate),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تحديث سعر الصرف');
      }
      setModalOpen(false);
      fetchRates();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">إدارة أسعار الصرف اليومية (Exchange Rates)</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              تحديد أسعار تعامل العملاء، أسعار الموردين، والأسعار المرجعية مع الاحتفاظ بالسجل التاريخي
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>تحديث / إضافة سعر صرف جديد</span>
          </button>
        </div>

        {/* Current Active Rates Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          {['customer', 'supplier', 'market_benchmark'].map((typeKey) => {
            const currentRate = rates.find((r) => r.rateType === typeKey);
            const label =
              typeKey === 'customer'
                ? 'سعر صرف العملاء'
                : typeKey === 'supplier'
                ? 'سعر صرف الموردين'
                : 'السعر المرجعي (السوق)';

            return (
              <div
                key={typeKey}
                onClick={() => {
                  setRateType(typeKey);
                  if (currentRate?.rate) setRate(currentRate.rate);
                  setModalOpen(true);
                }}
                className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-5 shadow-sm flex flex-col justify-between cursor-pointer hover:border-blue-400 active:scale-[0.99] transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500">{label}</span>
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 mb-1">
                    1 EGP = {currentRate ? currentRate.rate : 200} <span className="text-xs font-normal text-slate-400">SDG</span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 pt-3 border-t border-slate-100 flex items-center justify-between mt-2">
                  <span>بواسطة: {currentRate?.createdBy || 'النظام'}</span>
                  <span className="text-blue-600 font-bold hover:underline">تعديل &larr;</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Rates History Section */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">سجل أسعار الصرف التاريخية</h3>
            <span className="text-xs text-slate-400 font-mono font-bold">{rates.length} تسجيل</span>
          </div>

          {/* Mobile Cards (< sm) */}
          <div className="sm:hidden divide-y divide-slate-100 -mx-4">
            {rates.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">لا يوجد سجل تاريخي حتى الآن</div>
            ) : (
              rates.map((r) => (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                      {r.fromCurrency} / {r.toCurrency}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
                      {r.rateType === 'customer' ? 'عملاء' : r.rateType === 'supplier' ? 'موردين' : 'مرجعي'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono font-black text-lg text-slate-900">
                      1 {r.fromCurrency} = {r.rate} {r.toCurrency}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(r.createdAt).toLocaleDateString('ar-EG')}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    بواسطة: <span className="font-semibold text-slate-700">{r.createdBy || 'النظام'}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Table (hidden on mobile, visible on sm+) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">زوج العملات</th>
                  <th className="p-3">نوع السعر</th>
                  <th className="p-3">سعر الصرف</th>
                  <th className="p-3">المستخدم</th>
                  <th className="p-3">وقت التطبيق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {rates.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-slate-900">
                      {r.fromCurrency} / {r.toCurrency}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
                        {r.rateType === 'customer' ? 'عملاء' : r.rateType === 'supplier' ? 'موردين' : 'مرجعي'}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-black text-slate-900 text-sm">
                      1 {r.fromCurrency} = {r.rate} {r.toCurrency}
                    </td>
                    <td className="p-3 text-slate-600">{r.createdBy}</td>
                    <td className="p-3 font-mono text-[11px] text-slate-500">
                      {new Date(r.createdAt).toLocaleString('ar-EG')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* BOTTOM SHEET / MODAL */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إضافة سعر صرف جديد</h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateRate} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة الأساس</label>
                    <input
                      type="text"
                      disabled
                      value={fromCurrency}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 bg-slate-100 font-bold min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة المقابلة</label>
                    <input
                      type="text"
                      disabled
                      value={toCurrency}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 bg-slate-100 font-bold min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع السعر</label>
                  <select
                    value={rateType}
                    onChange={(e) => setRateType(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                  >
                    <option value="customer">سعر العملاء (Customer Rate)</option>
                    <option value="supplier">سعر الموردين (Supplier Rate)</option>
                    <option value="market_benchmark">سعر السوق المرجعي (Benchmark)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر الصرف (قيمة 1 EGP بالسوداني)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    required
                    placeholder="200"
                    className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-black rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px]">
                  ملاحظة أمان: تغيير سعر الصرف يطبق فقط على العمليات الجديدة، ولن يتم تعديل أي عمليات قديمة مسجلة.
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {saving ? 'جاري الحفظ...' : 'تثبيت السعر الجديد'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
