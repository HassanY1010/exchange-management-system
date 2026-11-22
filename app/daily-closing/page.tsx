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
  Calendar,
  Wallet,
  Building,
  UserCheck,
  TrendingUp,
  Eye,
  X,
  AlertCircle,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';

export default function DailyClosingPage() {
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [preview, setPreview] = useState<any>(null);
  const [closings, setClosings] = useState<any[]>([]);
  const [countedBalances, setCountedBalances] = useState<Record<string, number | string>>({});
  const [closingNotes, setClosingNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Reopen Modal
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [selectedClosingId, setSelectedClosingId] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);

  // Snapshot Viewer Modal
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [viewingClosing, setViewingClosing] = useState<any>(null);

  const fetchPreview = (targetDate = businessDate) => {
    setLoading(true);
    setErrorMessage('');
    fetch('/api/v1/daily-closing/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessDate: targetDate, countedBalances }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setPreview(data.data);
        } else {
          setErrorMessage(data.error || 'فشل تحميل معاينة الإغلاق');
        }
      })
      .catch((err) => setErrorMessage(err.message))
      .finally(() => setLoading(false));

    fetch('/api/v1/daily-closing')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setClosings(data.data || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchPreview(businessDate);
  }, [businessDate]);

  const handleCountedChange = (accountId: string, val: string) => {
    const updated = { ...countedBalances, [accountId]: val };
    setCountedBalances(updated);

    // Live update preview
    fetch('/api/v1/daily-closing/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessDate, countedBalances: updated }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setPreview(data.data);
      });
  };

  const handleExecuteClosing = async () => {
    if (preview?.blockingReasons && preview.blockingReasons.length > 0) {
      alert(`لا يمكن إغلاق اليوم لوجود شروط مانعة:\n${preview.blockingReasons.map((b: any) => `• ${b.message}`).join('\n')}`);
      return;
    }

    if (!confirm(`هل أنت متأكد من تثبيت وإغلاق اليوم المالي (${businessDate}) وتجميد كافة أرصدة الخزائن؟`)) return;

    setSubmitting(true);
    setMessage('');
    setErrorMessage('');
    try {
      const res = await fetch('/api/v1/daily-closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessDate,
          countedBalances,
          notes: closingNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إغلاق اليوم المالي');
      }

      setMessage(`تم إغلاق وتجميد اليوم المالي (${businessDate}) بنجاح وتثبيت تقرير المطابقة.`);
      setClosingNotes('');
      fetchPreview(businessDate);
    } catch (err: any) {
      setErrorMessage(err.message);
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenReason || reopenReason.trim().length < 5) {
      alert('يجب تقديم سبب تفصيلي لإعادة فتح اليوم المالي (5 أحرف على الأقل)');
      return;
    }

    setReopening(true);
    setErrorMessage('');
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

      setMessage(`تمت إعادة فتح اليوم المالي بنجاح، ويمكن الآن استئناف العمليات عليه.`);
      setReopenModalOpen(false);
      setReopenReason('');
      fetchPreview(businessDate);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setReopening(false);
    }
  };

  const recon = preview?.reconciliation;
  const accounts = recon?.accounts || [];
  const byCurrency = recon?.byCurrency || {};
  const isClosed = preview?.isClosed;
  const blockingReasons = preview?.blockingReasons || [];
  const canClose = preview?.canClose;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Top Header Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm">
          <div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className="text-lg sm:text-2xl font-black text-slate-900">
                الإغلاق اليومي ومطابقة الخزائن (Daily Closing)
              </h1>
              {isClosed ? (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-600" />
                  اليوم مغلق ومجمد
                </span>
              ) : preview?.closingRecord?.status === 'reopened' ? (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5">
                  <Unlock className="w-3.5 h-3.5 text-amber-600" />
                  معاد فتحه للتدقيق
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                  اليوم مفتوح للعمليات
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              جرد الصناديق النقدية والبنوك من واقع قيود دفتر الأستاذ، رصد الفروقات، وتثبيت أرصدة نهاية اليوم
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center space-x-1.5 space-x-reverse bg-slate-50 border border-slate-300 px-3 py-2 rounded-xl">
              <Calendar className="w-4 h-4 text-slate-500" />
              <input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                className="bg-transparent font-mono text-xs sm:text-sm font-bold text-slate-800 outline-none cursor-pointer"
              />
            </div>

            <button
              onClick={() => fetchPreview(businessDate)}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-white border border-slate-200 text-slate-700 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-50 min-h-[44px] shadow-sm active:scale-95 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">تحديث المعاينة</span>
            </button>
          </div>
        </div>

        {/* Success Alert */}
        {message && (
          <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-900 flex items-center space-x-2 space-x-reverse text-xs sm:text-sm font-bold animate-fadeIn">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-4 bg-rose-50 border border-rose-300 rounded-2xl text-rose-900 flex items-center space-x-2 space-x-reverse text-xs sm:text-sm font-bold animate-fadeIn">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Blocking Conditions Alert Banner */}
        {blockingReasons.length > 0 && !isClosed && (
          <div className="p-4 sm:p-5 bg-amber-50 border-2 border-amber-300 rounded-2xl sm:rounded-3xl space-y-2">
            <div className="flex items-center space-x-2 space-x-reverse text-amber-900 font-black text-sm sm:text-base">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <span>شروط مانعة للإغلاق (يجب معالجتها قبل تثبيت اليوم المالي)</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm text-amber-800 font-semibold pr-2">
              {blockingReasons.map((b: any, idx: number) => (
                <li key={idx}>{b.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Multi-Currency Dynamic Summary Cards */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs sm:text-sm font-black text-slate-700">
              ملخص المطابقة النقدية بحسب العملة (معزولة بالكامل دون خلط):
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Object.keys(byCurrency).length === 0 ? (
              <div className="col-span-full p-4 bg-white border border-slate-200 rounded-2xl text-center text-xs text-slate-400">
                لا توجد خزائن نقدية مسجلة لعرض ملخص العملات
              </div>
            ) : (
              Object.entries(byCurrency).map(([cur, summary]: [string, any]) => (
                <div
                  key={cur}
                  className={`p-4 sm:p-5 rounded-2xl border shadow-sm space-y-2 transition-all ${
                    summary.isBalanced
                      ? 'bg-white border-slate-200'
                      : summary.status === 'deficit'
                      ? 'bg-rose-50/60 border-rose-200'
                      : 'bg-amber-50/60 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-black text-xs px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {cur}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        summary.isBalanced
                          ? 'bg-emerald-100 text-emerald-800'
                          : summary.status === 'deficit'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {summary.isBalanced ? '✓ مطابق 100%' : summary.status === 'deficit' ? 'عجز نقدي' : 'فائض نقدي'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">المتوقع دفترياً:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {summary.totalExpected.toLocaleString()} {cur}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">الفعلي المعدود:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {summary.totalActual.toLocaleString()} {cur}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs pt-1 border-t border-slate-100 font-black">
                      <span className="text-slate-700">فرق الجرد:</span>
                      <span
                        className={`font-mono ${
                          summary.totalDiff === 0
                            ? 'text-slate-600'
                            : summary.totalDiff > 0
                            ? 'text-emerald-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {summary.totalDiff > 0 ? `+${summary.totalDiff.toLocaleString()}` : summary.totalDiff.toLocaleString()} {cur}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Detailed Safes Cash Count & Reconciliation Table */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 mb-4 gap-2">
            <div>
              <h3 className="font-black text-slate-900 text-base sm:text-lg">
                جدول جرد ومطابقة أرصدة الصناديق والخزائن النقدية
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                حسابات النقدية والبنوك فقط • الرصيد الافتتاحي والوارد والمنصرف مستخرج مباشرة من قيود دفتر الأستاذ (Ledger)
              </p>
            </div>
            <div className="text-xs font-bold text-slate-600 self-end sm:self-auto">
              عدد الخزائن: {accounts.length}
            </div>
          </div>

          {/* Mobile Cards (< lg) */}
          <div className="lg:hidden space-y-3">
            {accounts.length === 0 ? (
              <p className="text-center text-slate-400 py-6 text-xs">لا توجد خزائن نقدية نشطة</p>
            ) : (
              accounts.map((acc: any) => (
                <div
                  key={acc.accountId}
                  className={`p-4 rounded-2xl border space-y-3 transition-all ${
                    acc.isBalanced
                      ? 'bg-slate-50/70 border-slate-200'
                      : acc.status === 'deficit'
                      ? 'bg-rose-50/50 border-rose-200'
                      : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-sm text-slate-900 block">{acc.accountName}</span>
                      <span className="font-mono text-[10px] text-slate-400">{acc.accountCode}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                        {acc.currency}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          acc.isBalanced
                            ? 'bg-emerald-100 text-emerald-800'
                            : acc.status === 'deficit'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {acc.isBalanced ? 'مطابق' : acc.status === 'deficit' ? 'عجز نقدي' : 'فائض نقدي'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-white p-2.5 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 block">افتتاحي اليوم</span>
                      <span className="font-mono font-bold text-slate-700">{acc.openingBalance.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">الوارد (+) / المنصرف (-)</span>
                      <span className="font-mono text-[11px] font-bold text-slate-700">
                        +{acc.totalInflow.toLocaleString()} / -{acc.totalOutflow.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">المتوقع دفترياً</span>
                      <span className="font-mono font-black text-slate-900">{acc.expectedBalance.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">الفرق الفعلي</span>
                      <span
                        className={`font-mono font-black ${
                          acc.difference === 0
                            ? 'text-slate-500'
                            : acc.difference > 0
                            ? 'text-emerald-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {acc.difference > 0 ? `+${acc.difference.toLocaleString()}` : acc.difference.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      الرصيد الفعلي المعدود في الخزينة:
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={isClosed}
                      defaultValue={acc.actualCountedBalance}
                      onBlur={(e) => handleCountedChange(acc.accountId, e.target.value)}
                      className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-bold rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 min-h-[44px] disabled:bg-slate-100"
                      placeholder={acc.expectedBalance.toString()}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Table (lg+) */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">اسم الصندوق / الحساب</th>
                  <th className="p-3">الرمز والنوع</th>
                  <th className="p-3">العملة</th>
                  <th className="p-3">افتتاحي اليوم</th>
                  <th className="p-3 text-emerald-700">الوارد (+)</th>
                  <th className="p-3 text-rose-700">المنصرف (-)</th>
                  <th className="p-3">الرصيد المتوقع (Ledger)</th>
                  <th className="p-3 w-48">الرصيد الفعلي المعدود</th>
                  <th className="p-3">الفرق</th>
                  <th className="p-3">حالة المطابقة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400">
                      لا توجد خزائن نقدية نشطة
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc: any) => (
                    <tr
                      key={acc.accountId}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        !acc.isBalanced
                          ? acc.status === 'deficit'
                            ? 'bg-rose-50/20'
                            : 'bg-amber-50/20'
                          : ''
                      }`}
                    >
                      <td className="p-3 font-bold text-slate-900">{acc.accountName}</td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">
                        {acc.accountCode} • {acc.accountType}
                      </td>
                      <td className="p-3 font-mono font-bold text-blue-600">{acc.currency}</td>
                      <td className="p-3 font-mono">{acc.openingBalance.toLocaleString()}</td>
                      <td className="p-3 font-mono font-bold text-emerald-600">
                        {acc.totalInflow > 0 ? `+${acc.totalInflow.toLocaleString()}` : '0'}
                      </td>
                      <td className="p-3 font-mono font-bold text-rose-600">
                        {acc.totalOutflow > 0 ? `-${acc.totalOutflow.toLocaleString()}` : '0'}
                      </td>
                      <td className="p-3 font-mono font-black text-slate-900">
                        {acc.expectedBalance.toLocaleString()}
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          inputMode="decimal"
                          disabled={isClosed}
                          defaultValue={acc.actualCountedBalance}
                          onBlur={(e) => handleCountedChange(acc.accountId, e.target.value)}
                          className="w-full px-3 py-1.5 font-mono text-xs font-bold rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                          placeholder={acc.expectedBalance.toString()}
                        />
                      </td>
                      <td className="p-3 font-mono font-bold">
                        <span
                          className={
                            acc.difference === 0
                              ? 'text-slate-500'
                              : acc.difference > 0
                              ? 'text-emerald-600'
                              : 'text-rose-600'
                          }
                        >
                          {acc.difference > 0 ? `+${acc.difference.toLocaleString()}` : acc.difference.toLocaleString()}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            acc.isBalanced
                              ? 'bg-emerald-100 text-emerald-800'
                              : acc.status === 'deficit'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {acc.isBalanced ? 'مطابق' : acc.status === 'deficit' ? 'عجز نقدي' : 'فائض نقدي'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Notes and Closing Action Area */}
          <div className="pt-6 border-t border-slate-100 mt-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ملاحظات الإغلاق اليومي وأسباب الفروقات النقدية (إن وجدت)
              </label>
              <textarea
                rows={2}
                disabled={isClosed}
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder="أدخل أي ملاحظات رقابية تخص تسوية اليوم أو إثبات أسباب العجز أو الفائض مع توقيع المسؤول..."
                className="w-full p-3 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {isClosed ? (
                  <span className="text-slate-600 font-bold flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-slate-500" />
                    تم تثبيت وإغلاق اليوم المالي ({businessDate}) بواسطة {preview?.closingRecord?.closedBy || 'المدير'}.
                  </span>
                ) : (
                  <span>عند الإغلاق: يتم تجميد حركات اليوم المالي في كافة المسارات، وحفظ لقطة أرصدة نهائية غير قابلة للتعديل.</span>
                )}
              </div>

              {!isClosed && (
                <button
                  onClick={handleExecuteClosing}
                  disabled={submitting || !canClose}
                  className="w-full sm:w-auto px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs sm:text-sm font-black shadow-lg shadow-amber-600/20 transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50 min-h-[48px]"
                >
                  <Lock className="w-4 h-4" />
                  <span>{submitting ? 'جاري تثبيت الإغلاق...' : 'تثبيت وإغلاق اليوم المالي الآن'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Read-Only Non-Cash Financial Position Monitoring (Excluded from Cash Count) */}
        {preview?.nonCashAccounts && preview.nonCashAccounts.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-xs sm:text-sm text-slate-800">
                موقف الحسابات المالية غير النقدية (رقابة الميزانية - مستبعدة من الجرد الفعلي للنقد):
              </h4>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 text-xs">
              {preview.nonCashAccounts.map((acc: any) => (
                <div key={acc.id} className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 block truncate">{acc.name}</span>
                  <span className="font-mono font-black text-slate-800 block text-xs mt-0.5">
                    {acc.currentBalance.toLocaleString()} {acc.currency}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Historical Closings Log Table */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">
              سجل الإغلاقات اليومية التاريخية ولقطات الأرصدة (Snapshot History)
            </h3>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {closings.length === 0 ? (
              <p className="text-slate-400 py-6 text-center">لا توجد إغلاقات يومية تاريخية مسجلة</p>
            ) : (
              closings.map((c) => (
                <div
                  key={c.id}
                  className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-50/50 px-2 rounded-xl transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-black text-slate-900 text-sm">{c.businessDate}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'closed'
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {c.status === 'closed' ? 'مغلق ومثبت' : 'معاد فتحه'}
                      </span>
                    </div>
                    <p className="text-slate-500 text-[11px]">
                      بواسطة: {c.closedBy || 'المدير'} • {c.closedAt ? new Date(c.closedAt).toLocaleString('ar-EG') : ''}
                    </p>
                    {c.notes && <p className="text-slate-400 text-[11px] truncate max-w-xl">{c.notes}</p>}
                  </div>

                  <div className="flex items-center space-x-2 space-x-reverse self-end sm:self-auto">
                    <button
                      onClick={() => {
                        setViewingClosing(c);
                        setSnapshotModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 min-h-[36px]"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>عرض اللقطة المحفوظة</span>
                    </button>

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

        {/* SNAPSHOT VIEWER MODAL */}
        {snapshotModalOpen && viewingClosing && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-3xl p-5 sm:p-6 border border-slate-100 text-right max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <div>
                  <h3 className="font-black text-slate-900 text-base sm:text-lg">
                    لقطة الأرصدة المحفوظة (Closing Snapshot) • {viewingClosing.businessDate}
                  </h3>
                  <p className="text-xs text-slate-500">
                    أغلقت بواسطة: {viewingClosing.closedBy} • {viewingClosing.closedAt ? new Date(viewingClosing.closedAt).toLocaleString('ar-EG') : ''}
                  </p>
                </div>
                <button
                  onClick={() => setSnapshotModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Snapshot Differences / Items */}
              {viewingClosing.parsedDifferences?.items ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2.5">الخزينة / الصندوق</th>
                          <th className="p-2.5">العملة</th>
                          <th className="p-2.5">الافتتاحي</th>
                          <th className="p-2.5">الوارد (+)</th>
                          <th className="p-2.5">المنصرف (-)</th>
                          <th className="p-2.5">المتوقع</th>
                          <th className="p-2.5">الفعلي المعدود</th>
                          <th className="p-2.5">الفرق</th>
                          <th className="p-2.5">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {viewingClosing.parsedDifferences.items.map((item: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2.5 font-bold text-slate-900">{item.accountName}</td>
                            <td className="p-2.5 font-mono font-bold text-blue-600">{item.currency}</td>
                            <td className="p-2.5 font-mono">{Number(item.openingBalance || 0).toLocaleString()}</td>
                            <td className="p-2.5 font-mono text-emerald-600">+{Number(item.totalInflow || 0).toLocaleString()}</td>
                            <td className="p-2.5 font-mono text-rose-600">-{Number(item.totalOutflow || 0).toLocaleString()}</td>
                            <td className="p-2.5 font-mono font-bold">{Number(item.expectedBalance || 0).toLocaleString()}</td>
                            <td className="p-2.5 font-mono font-bold">{Number(item.actualCountedBalance || 0).toLocaleString()}</td>
                            <td className="p-2.5 font-mono font-bold">
                              <span className={item.difference === 0 ? 'text-slate-500' : item.difference > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                {item.difference > 0 ? `+${item.difference.toLocaleString()}` : item.difference.toLocaleString()}
                              </span>
                            </td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                item.isBalanced ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                              }`}>
                                {item.isBalanced ? 'مطابق' : item.status === 'deficit' ? 'عجز' : 'فائض'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {viewingClosing.notes && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                      <span className="font-bold text-slate-700 block mb-0.5">الملاحظات المسجلة:</span>
                      <span className="text-slate-600">{viewingClosing.notes}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-xl font-mono text-xs overflow-x-auto">
                  {JSON.stringify(viewingClosing, null, 2)}
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 mt-4 flex justify-end">
                <button
                  onClick={() => setSnapshotModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        )}

        {/* REOPEN MODAL */}
        {reopenModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إعادة فتح اليوم المالي (صلاحية مدير)</h3>
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
                    سبب إعادة فتح اليوم المالي (إلزامي للرقابة والتدقيق) *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="مثال: تصحيح تسليم إيصال متأخر بموافقة الإدارة المالية..."
                    className="w-full p-3 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[80px]"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    سيتم تدوين اسم المدير والتاريخ والسبب في سجل التدقيق الرقابي غير القابل للحذف.
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
