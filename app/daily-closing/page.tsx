'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Calculator,
  History,
  FileCheck2,
} from 'lucide-react';

export default function DailyClosingPage() {
  const [preview, setPreview] = useState<any>(null);
  const [closings, setClosings] = useState<any[]>([]);
  const [countedBalances, setCountedBalances] = useState<Record<string, number | string>>({});
  const [closingNotes, setClosingNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  // Reopen modal
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [selectedClosingId, setSelectedClosingId] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);

  const fetchPreview = () => {
    setLoading(true);
    fetch('/api/v1/daily-closing/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalances }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setPreview(data.data);
        }
      })
      .finally(() => setLoading(false));

    fetch('/api/v1/daily-closing')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setClosings(data.data || []);
      });
  };

  useEffect(() => {
    fetchPreview();
  }, []);

  const handleCountedChange = (accountId: string, val: string) => {
    const updated = { ...countedBalances, [accountId]: val };
    setCountedBalances(updated);

    // Live update preview
    fetch('/api/v1/daily-closing/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countedBalances: updated }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setPreview(data.data);
      });
  };

  const handleExecuteClosing = async () => {
    if (!confirm('هل أنت متأكد من تثبيت وإغلاق اليوم المالي الحالي؟')) return;
    setSubmitting(true);
    setMessage('');
    try {
      const res = await fetch('/api/v1/daily-closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countedBalances,
          notes: closingNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إغلاق اليوم');
      }

      setMessage('تم إغلاق اليوم المالي بنجاح وتثبيت الأرصدة وإصدار التقرير النهائي!');
      fetchPreview();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenReason || reopenReason.trim().length < 5) {
      alert('يجب إدخال سبب مفصل لإعادة فتح اليوم');
      return;
    }

    setReopening(true);
    try {
      const res = await fetch(`/api/v1/daily-closing/${selectedClosingId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إعادة فتح اليوم');
      }

      setReopenModalOpen(false);
      setReopenReason('');
      fetchPreview();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setReopening(false);
    }
  };

  const recon = preview?.reconciliation;
  const accounts = recon?.accounts || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">الإغلاق اليومي ومطابقة الخزائن (Daily Closing)</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              مطابقة النقدية الفعلية مع السجل المحاسبي، رصد الفروقات (عجز/فائض)، وتثبيت أرصدة نهاية اليوم
            </p>
          </div>
          <button
            onClick={fetchPreview}
            className="flex items-center justify-center space-x-1.5 space-x-reverse bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-50 min-h-[44px] shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث المعاينة</span>
          </button>
        </div>

        {message && (
          <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-900 flex items-center space-x-2 space-x-reverse text-xs sm:text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {/* Variances Summary Cards */}
        {recon && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-bold block mb-1">المتوقع محاسبياً (EGP)</span>
              <span className="text-lg sm:text-xl font-black font-mono text-slate-900">
                {recon.totalExpectedEgp.toLocaleString()} EGP
              </span>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-bold block mb-1">الفعلي المحسوب (EGP)</span>
              <span className="text-lg sm:text-xl font-black font-mono text-slate-900">
                {recon.totalActualEgp.toLocaleString()} EGP
              </span>
            </div>

            <div className={`p-4 sm:p-5 rounded-2xl border shadow-sm ${
              recon.totalDiffEgp === 0
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <span className="text-xs font-bold block mb-1">فرق الجنيه المصري (Variance EGP)</span>
              <span className="text-lg sm:text-xl font-black font-mono">
                {recon.totalDiffEgp > 0 ? `+${recon.totalDiffEgp.toLocaleString()}` : recon.totalDiffEgp.toLocaleString()} EGP
              </span>
              <span className="text-[10px] block mt-1 font-bold">
                {recon.totalDiffEgp === 0 ? '✓ مطابق تماماً' : recon.totalDiffEgp > 0 ? 'فائض نقدي' : 'عجز نقدي'}
              </span>
            </div>

            <div className={`p-4 sm:p-5 rounded-2xl border shadow-sm ${
              recon.totalDiffSdg === 0
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <span className="text-xs font-bold block mb-1">فرق الجنيه السوداني (Variance SDG)</span>
              <span className="text-lg sm:text-xl font-black font-mono">
                {recon.totalDiffSdg > 0 ? `+${recon.totalDiffSdg.toLocaleString()}` : recon.totalDiffSdg.toLocaleString()} SDG
              </span>
              <span className="text-[10px] block mt-1 font-bold">
                {recon.totalDiffSdg === 0 ? '✓ مطابق تماماً' : 'يوجد اختلاف في حساب بنكك/الكاش'}
              </span>
            </div>
          </div>
        )}

        {/* Detailed Accounts Reconciliation Section */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-4 sm:p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
            <div>
              <h3 className="font-black text-slate-900 text-base sm:text-lg">جدول جرد ومطابقة أرصدة الصناديق والخزائن</h3>
              <p className="text-xs text-slate-500 mt-0.5">أدخل المبالغ الفعلية المعدودة في الخزائن لمطابقتها مع السجل المالي</p>
            </div>
          </div>

          {/* Mobile Reconciliation Cards (< lg) */}
          <div className="lg:hidden space-y-3">
            {accounts.map((acc: any) => (
              <div key={acc.accountId} className="p-4 bg-slate-50/70 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-900">{acc.accountName}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {acc.currency}
                    </span>
                    {acc.isBalanced ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        مطابق
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        acc.status === 'deficit' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {acc.status === 'deficit' ? 'عجز' : 'فائض'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">المتوقع دفترياً</span>
                    <span className="font-mono font-black text-slate-900">{acc.expectedBalance.toLocaleString()} {acc.currency}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">الفرق الفعلي</span>
                    <span className={`font-mono font-black ${acc.difference === 0 ? 'text-slate-500' : acc.difference > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {acc.difference > 0 ? `+${acc.difference.toLocaleString()}` : acc.difference.toLocaleString()} {acc.currency}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">الرصيد الفعلي المعدود في الخزينة:</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    defaultValue={acc.actualCountedBalance}
                    onBlur={(e) => handleCountedChange(acc.accountId, e.target.value)}
                    className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-bold rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                    placeholder={acc.expectedBalance.toString()}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table (hidden on mobile, visible on lg) */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">اسم الصندوق / الحساب</th>
                  <th className="p-3">العملة</th>
                  <th className="p-3">الرصيد الافتتاحي</th>
                  <th className="p-3">الرصيد المتوقع (Ledger)</th>
                  <th className="p-3 w-48">الرصيد الفعلي المعدود</th>
                  <th className="p-3">الفرق</th>
                  <th className="p-3">حالة المطابقة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {accounts.map((acc: any) => (
                  <tr key={acc.accountId} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-900">{acc.accountName}</td>
                    <td className="p-3 font-mono font-bold text-blue-600">{acc.currency}</td>
                    <td className="p-3 font-mono">{acc.openingBalance.toLocaleString()}</td>
                    <td className="p-3 font-mono font-bold text-slate-900">{acc.expectedBalance.toLocaleString()}</td>
                    <td className="p-3">
                      <input
                        type="number"
                        inputMode="decimal"
                        defaultValue={acc.actualCountedBalance}
                        onBlur={(e) => handleCountedChange(acc.accountId, e.target.value)}
                        className="w-full px-3 py-1.5 font-mono text-xs font-bold rounded-lg border border-slate-300 focus:ring-2 focus:ring-amber-500"
                        placeholder={acc.expectedBalance.toString()}
                      />
                    </td>
                    <td className="p-3 font-mono font-bold">
                      <span className={acc.difference === 0 ? 'text-slate-500' : acc.difference > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                        {acc.difference > 0 ? `+${acc.difference.toLocaleString()}` : acc.difference.toLocaleString()}
                      </span>
                    </td>
                    <td className="p-3">
                      {acc.isBalanced ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          مطابق
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          acc.status === 'deficit' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {acc.status === 'deficit' ? 'عجز نقدي' : 'فائض نقدي'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes & Lock Day Button */}
          <div className="pt-6 border-t border-slate-100 mt-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ملاحظات الإغلاق اليومي وأسباب الفروقات (إن وجدت)
              </label>
              <textarea
                rows={2}
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder="أدخل أي ملاحظات تخص تسوية اليوم أو إثبات أسباب العجز أو الفائض..."
                className="w-full p-3 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                عند الإغلاق: يتم تجميد حركات اليوم المالي، وتثبيت أرصدة الخزائن تلقائياً.
              </div>
              <button
                onClick={handleExecuteClosing}
                disabled={submitting}
                className="w-full sm:w-auto px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs sm:text-sm font-black shadow-lg shadow-amber-600/20 transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50 min-h-[48px]"
              >
                <Lock className="w-4 h-4" />
                <span>{submitting ? 'جاري تثبيت الإغلاق...' : 'تثبيت وإغلاق اليوم المالي الآن'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Previous Closings Log */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 overflow-hidden">
          <h3 className="font-bold text-sm sm:text-base text-slate-900 mb-3">سجل الإغلاقات اليومية التاريخية</h3>
          <div className="divide-y divide-slate-100 text-xs">
            {closings.length === 0 ? (
              <p className="text-slate-400 py-4 text-center">لا توجد إغلاقات سابقة مسجلة</p>
            ) : (
              closings.map((c) => (
                <div key={c.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-bold text-slate-900 text-sm ml-2">{c.businessDate}</span>
                    <span className="text-slate-500">بواسطة: {c.closedBy || 'المدير'}</span>
                    {c.notes && <span className="text-slate-400 block text-[11px] mt-0.5">{c.notes}</span>}
                  </div>
                  <div className="flex items-center space-x-2 space-x-reverse self-end sm:self-auto">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      c.status === 'closed' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {c.status === 'closed' ? 'مغلق ومثبت' : 'معاد فتحه'}
                    </span>
                    {c.status === 'closed' && (
                      <button
                        onClick={() => {
                          setSelectedClosingId(c.id);
                          setReopenModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold rounded-lg text-xs min-h-[36px]"
                      >
                        إعادة فتح اليوم
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* REOPEN BOTTOM SHEET / MODAL */}
        {reopenModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إعادة فتح اليوم المالي</h3>
                <button
                  onClick={() => setReopenModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleReopen} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سبب إعادة فتح اليوم (إلزامي للرقابة المالية) *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="مثال: تصحيح تسليم إيصال متأخر بموافقة الإدارة..."
                    className="w-full p-3 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[80px]"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    سيتم تدوين اسم المستخدم والتاريخ والسبب في سجل التدقيق الرقابي غير القابل للحذف.
                  </p>
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setReopenModalOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={reopening}
                    className="w-full sm:w-auto px-6 py-2.5 bg-rose-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-rose-700 shadow-md shadow-rose-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {reopening ? 'جاري الفتح...' : 'تأكيد إعادة الفتح'}
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
