'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Scale,
  Upload,
  CheckCircle,
  AlertTriangle,
  FileCheck2,
  RefreshCw,
  Search,
  Check,
  Building,
  ArrowRight,
  X,
  FileSpreadsheet,
  ShieldCheck,
  Eye,
} from 'lucide-react';

export default function ReconciliationPage() {
  const [statements, setStatements] = useState<any[]>([]);
  const [activeStatement, setActiveStatement] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Import Modal State
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFilename, setImportFilename] = useState('');
  const [importRawText, setImportRawText] = useState('');
  const [importing, setImporting] = useState(false);

  // Actions State
  const [matching, setMatching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const fetchStatements = () => {
    setLoading(true);
    fetch('/api/v1/reconciliation')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const list = data.data || [];
          setStatements(list);
          if (list.length > 0 && !activeStatement) {
            setActiveStatement(list[0]);
          } else if (activeStatement) {
            const updated = list.find((s: any) => s.id === activeStatement.id);
            if (updated) setActiveStatement(updated);
          }
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatements();
  }, []);

  // Import Statement Handler
  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    setActionMessage('');

    try {
      const res = await fetch('/api/v1/reconciliation/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: importFilename || `bankak-statement-${Date.now()}.csv`,
          rawText: importRawText,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل استيراد كشف الحساب');
      }

      setImportModalOpen(false);
      setImportRawText('');
      setImportFilename('');
      fetchStatements();
      setActiveStatement(data.data);
      setActionMessage(`تم استيراد ${data.data.totalLines} حركة بنكية بنجاح! يمكنك الآن تشغيل المطابقة الآلية.`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Run Auto-Matching
  const handleRunMatch = async () => {
    if (!activeStatement) return;
    setMatching(true);
    setActionMessage('');

    try {
      const res = await fetch('/api/v1/reconciliation/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementId: activeStatement.id }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تشغيل المطابقة');
      }

      setActiveStatement(data.data);
      fetchStatements();
      setActionMessage(data.message);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setMatching(false);
    }
  };

  // Confirm Reconciliation
  const handleConfirmReconciliation = async () => {
    if (!activeStatement) return;
    if (!confirm('هل أنت متأكد من اعتماد المطابقة البنكية؟ سيتم تحديث حالة الإيصالات المطابقة إلى Verified دون تكرار أي قيود مالية.')) return;

    setConfirming(true);
    try {
      const res = await fetch('/api/v1/reconciliation/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementId: activeStatement.id }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل اعتماد المطابقة');
      }

      setActiveStatement(data.data);
      fetchStatements();
      setActionMessage(data.message);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setConfirming(false);
    }
  };

  const getMatchBadge = (status: string) => {
    switch (status) {
      case 'matched':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            <span>مطابق للإيصال</span>
          </span>
        );
      case 'amount_mismatch':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>اختلاف مبلغ!</span>
          </span>
        );
      case 'suspicious':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span>اشتباه تطابق</span>
          </span>
        );
      case 'unmatched':
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
            غير مسجل بالمنصة
          </span>
        );
    }
  };

  const lines = (activeStatement?.lines || []).filter((l: any) => {
    if (statusFilter && l.matchStatus !== statusFilter) return false;
    if (!search) return true;
    return (
      l.transactionId?.toLowerCase().includes(search.toLowerCase()) ||
      l.senderName?.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
              مطابقة كشف الحساب البنكي (Bank Reconciliation)
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              استيراد كشوفات بنكك (CSV / Excel)، مطابقة أرقام العمليات آلياً، والتأكد من وصول الأموال دون قيود وهمية
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse self-stretch sm:self-auto">
            <button
              onClick={() => setImportModalOpen(true)}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
            >
              <Upload className="w-4 h-4" />
              <span>استيراد كشف حساب جديد</span>
            </button>
            <button
              onClick={fetchStatements}
              className="p-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
              title="تحديث"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {actionMessage && (
          <div className="p-3.5 bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl text-xs font-bold flex items-center justify-between">
            <span>{actionMessage}</span>
            <button onClick={() => setActionMessage('')} className="p-1 hover:text-blue-950">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Statement Selector Toolbar */}
        {statements.length > 0 && (
          <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center space-x-2 space-x-reverse min-w-0">
              <span className="text-xs font-bold text-slate-500 whitespace-nowrap">كشف الحساب النشط:</span>
              <select
                value={activeStatement?.id || ''}
                onChange={(e) => {
                  const selected = statements.find((s) => s.id === e.target.value);
                  if (selected) setActiveStatement(selected);
                }}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold max-w-xs truncate"
              >
                {statements.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.statementNumber} - {s.filename} ({s.totalLines} حركة)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2">
              <button
                onClick={handleRunMatch}
                disabled={matching || !activeStatement}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 min-h-[40px] flex items-center space-x-1.5 space-x-reverse"
              >
                <Scale className="w-3.5 h-3.5" />
                <span>{matching ? 'جاري الفحص والمطابقة...' : 'تشغيل المطابقة الآلية'}</span>
              </button>

              {activeStatement?.status === 'reconciled' && (
                <button
                  onClick={handleConfirmReconciliation}
                  disabled={confirming}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 min-h-[40px] flex items-center space-x-1.5 space-x-reverse"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{confirming ? 'جاري الاعتماد...' : 'اعتماد المطابقة البنكية'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* KPI Cards for the active statement */}
        {activeStatement && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-slate-400 block mb-0.5">إجمالي الحركات</span>
              <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono">
                {activeStatement.totalLines}
              </span>
            </div>
            <div className="bg-emerald-50/70 p-3.5 sm:p-4 rounded-2xl border border-emerald-200 shadow-sm">
              <span className="text-[11px] text-emerald-700 block mb-0.5">حركات متطابقة مؤكدة</span>
              <span className="text-xl sm:text-2xl font-black text-emerald-800 font-mono">
                {activeStatement.matchedLines}
              </span>
            </div>
            <div className="bg-rose-50/70 p-3.5 sm:p-4 rounded-2xl border border-rose-200 shadow-sm">
              <span className="text-[11px] text-rose-700 block mb-0.5">اختلاف مالي / غير مطابق</span>
              <span className="text-xl sm:text-2xl font-black text-rose-800 font-mono">
                {activeStatement.unmatchedLines}
              </span>
            </div>
            <div className="bg-blue-50/70 p-3.5 sm:p-4 rounded-2xl border border-blue-200 shadow-sm">
              <span className="text-[11px] text-blue-700 block mb-0.5">حالة الكشف</span>
              <span className="text-sm sm:text-base font-black text-blue-900">
                {activeStatement.status === 'confirmed'
                  ? 'معتمد ومؤكد'
                  : activeStatement.status === 'reconciled'
                  ? 'تمت المطابقة'
                  : 'بانتظار الفحص'}
              </span>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        {activeStatement && (
          <div className="flex items-center space-x-2 space-x-reverse overflow-x-auto touch-scroll pb-1">
            {[
              { id: '', label: 'جميع الحركات' },
              { id: 'matched', label: 'مطابق للإيصال' },
              { id: 'amount_mismatch', label: 'اختلاف مالي' },
              { id: 'suspicious', label: 'مشتبه به' },
              { id: 'unmatched', label: 'غير مسجل' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setStatusFilter(btn.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all min-h-[38px] ${
                  statusFilter === btn.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* Statement Lines - Mobile Cards View */}
        <div className="lg:hidden space-y-3">
          {lines.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs sm:text-sm">
              {loading ? 'جاري التحميل...' : 'لا توجد حركات بنكية تطابق البحث'}
            </div>
          ) : (
            lines.map((l: any) => (
              <div
                key={l.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm text-blue-700">{l.transactionId}</span>
                  <div>{getMatchBadge(l.matchStatus)}</div>
                </div>

                <div className="flex justify-between items-baseline pt-1">
                  <span className="text-slate-400">المبلغ في البنك:</span>
                  <span className="font-mono font-black text-base text-slate-900">
                    {Number(l.amount).toLocaleString()} SDG
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-2 bg-slate-50 rounded-xl text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">المرسل:</span>
                    <span className="font-medium text-slate-800 truncate block">{l.senderName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">التاريخ:</span>
                    <span className="font-mono text-slate-600">{l.transactionDate}</span>
                  </div>
                </div>

                {l.notes && (
                  <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">{l.notes}</p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Statement Lines - Desktop Table View */}
        <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">رقم العملية البنكية (TXN)</th>
                  <th className="p-3.5">المبلغ (SDG)</th>
                  <th className="p-3.5">تاريخ الحركة</th>
                  <th className="p-3.5">المرسل</th>
                  <th className="p-3.5">المستفيد</th>
                  <th className="p-3.5">حالة المطابقة</th>
                  <th className="p-3.5">الملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400">
                      {loading ? 'جاري التحميل...' : 'لا توجد حركات بنكية تطابق البحث'}
                    </td>
                  </tr>
                ) : (
                  lines.map((l: any) => (
                    <tr key={l.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-blue-700">{l.transactionId}</td>
                      <td className="p-3.5 font-mono font-black text-slate-900 text-sm">
                        {Number(l.amount).toLocaleString()} SDG
                      </td>
                      <td className="p-3.5 font-mono text-slate-600">{l.transactionDate} {l.transactionTime}</td>
                      <td className="p-3.5">{l.senderName || '—'}</td>
                      <td className="p-3.5">{l.beneficiaryName || '—'}</td>
                      <td className="p-3.5">{getMatchBadge(l.matchStatus)}</td>
                      <td className="p-3.5 text-slate-500 max-w-xs truncate">{l.notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* IMPORT STATEMENT MODAL */}
        {importModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto touch-scroll rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2.5 space-x-reverse">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">استيراد كشف حساب بنك الخرطوم</h3>
                </div>
                <button
                  onClick={() => setImportModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleImport} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم الملف المستورد</label>
                  <input
                    type="text"
                    value={importFilename}
                    onChange={(e) => setImportFilename(e.target.value)}
                    placeholder="BOK-Statement-November-2026.csv"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      بيانات كشف الحساب (لصق نصوص CSV مفصولة بفواصل أو فواصل منقوطة) *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setImportRawText(
                          `Date,TransactionId,Amount,Sender,Beneficiary\n2026-11-21,BOK-20261121-517653,2000000,عمر أحمد عبدالله,مكتب الصرافة\n2026-11-21,BOK-20261121-693893,2000000,عمر أحمد عبدالله,مكتب الصرافة\n2026-11-21,BOK-20261121-999888,3500000,محمد عثمان,مكتب الصرافة`
                        );
                      }}
                      className="text-[11px] text-blue-600 font-bold hover:underline"
                    >
                      تحميل نموذج كشف حساب تجريبي
                    </button>
                  </div>
                  <textarea
                    rows={7}
                    value={importRawText}
                    onChange={(e) => setImportRawText(e.target.value)}
                    required
                    placeholder="2026-11-21,TXN123456789,2000000,عمر أحمد,مكتب الصرافة"
                    className="w-full p-3 font-mono text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setImportModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={importing}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {importing ? 'جاري الاستيراد والتحليل...' : 'تأكيد واستيراد الكشف'}
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
