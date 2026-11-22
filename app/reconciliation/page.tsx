'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  FileUp,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Clock,
  Layers,
} from 'lucide-react';

export default function ReconciliationPage() {
  const [statements, setStatements] = useState<any[]>([]);
  const [activeStatementId, setActiveStatementId] = useState<string>('');
  const [activeStatementData, setActiveStatementData] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLines, setLoadingLines] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Import Modal State
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTab, setImportTab] = useState<'file' | 'text'>('file');
  const [importFilename, setImportFilename] = useState('');
  const [importRawText, setImportRawText] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewSummary, setFilePreviewSummary] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Actions State
  const [matching, setMatching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // 1. Fetch statements list
  const fetchStatements = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/v1/reconciliation');
      const data = await res.json();
      if (data.success) {
        const list = data.data || [];
        setStatements(list);
        if (list.length > 0 && !activeStatementId) {
          setActiveStatementId(list[0].id);
        }
      } else {
        setErrorMessage(data.error || 'فشل تحميل كشوفات الحساب');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatements();
  }, []);

  // 2. Fetch lines & stats for the active statement
  const fetchStatementLines = async (stmtId: string, pageNum: number, filter: string, query: string) => {
    if (!stmtId) return;
    setLoadingLines(true);
    try {
      const params = new URLSearchParams({
        statementId: stmtId,
        page: String(pageNum),
        pageSize: '25',
      });
      if (filter) params.append('status', filter);
      if (query) params.append('search', query);

      const res = await fetch(`/api/v1/reconciliation?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setActiveStatementData(data.statement);
        setLines(data.data || []);
        setStats(data.stats);
        setTotalPages(data.pagination?.totalPages || 1);
        setTotalCount(data.pagination?.total || 0);
      } else {
        setErrorMessage(data.error || 'فشل تحميل بيانات الكشف');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'خطأ في الاتصال');
    } finally {
      setLoadingLines(false);
    }
  };

  useEffect(() => {
    if (activeStatementId) {
      setPage(1);
      fetchStatementLines(activeStatementId, 1, statusFilter, search);
    }
  }, [activeStatementId, statusFilter]);

  // Handle Search input
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    fetchStatementLines(activeStatementId, 1, statusFilter, val);
  };

  // Pagination Handler
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    fetchStatementLines(activeStatementId, newPage, statusFilter, search);
  };

  // File Selection Handler (CSV or Excel)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(csv|xlsx|xls)$/i)) {
      alert('يرجى اختيار ملف كشف حساب بصيغة CSV أو Excel (.xlsx, .xls)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('الحد الأقصى لحجم الملف هو 10 ميجابايت');
      return;
    }

    setSelectedFile(file);
    setImportFilename(file.name);
    setFilePreviewSummary(`الملف المختار: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setFileBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  // Import Statement Handler
  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    setActionMessage('');
    setErrorMessage('');

    try {
      const payload: any = {
        filename: importFilename || (selectedFile ? selectedFile.name : `bankak-statement-${Date.now()}.csv`),
      };

      if (importTab === 'file' && fileBase64) {
        payload.fileBase64 = fileBase64;
      } else if (importTab === 'text' && importRawText.trim()) {
        payload.rawText = importRawText;
      } else {
        throw new Error('يرجى اختيار ملف كشف حساب أو لصق البيانات');
      }

      const res = await fetch('/api/v1/reconciliation/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل استيراد كشف الحساب');
      }

      setImportModalOpen(false);
      setImportRawText('');
      setImportFilename('');
      setFileBase64('');
      setSelectedFile(null);
      setFilePreviewSummary('');

      await fetchStatements();
      setActiveStatementId(data.data.id);
      setActionMessage(`تم استيراد ${data.data.totalLines} حركة بنكية بنجاح! يمكنك الآن تشغيل المطابقة الآلية.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء الاستيراد');
    } finally {
      setImporting(false);
    }
  };

  // Run Auto-Matching
  const handleRunMatch = async () => {
    if (!activeStatementId) return;
    setMatching(true);
    setActionMessage('');
    setErrorMessage('');

    try {
      const res = await fetch('/api/v1/reconciliation/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementId: activeStatementId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تشغيل المطابقة');
      }

      setActionMessage(data.message);
      await fetchStatements();
      await fetchStatementLines(activeStatementId, page, statusFilter, search);
    } catch (err: any) {
      setErrorMessage(err.message || 'فشل تشغيل محرك المطابقة');
    } finally {
      setMatching(false);
    }
  };

  // Confirm Reconciliation
  const handleConfirmReconciliation = async () => {
    if (!activeStatementId) return;
    if (
      !confirm(
        'هل أنت متأكد من اعتماد المطابقة البنكية؟ سيتم ترقية حالة الإيصالات المطابقة إلى Verified دون تكرار أي قيود مالية.'
      )
    )
      return;

    setConfirming(true);
    setActionMessage('');
    setErrorMessage('');

    try {
      const res = await fetch('/api/v1/reconciliation/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementId: activeStatementId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل اعتماد المطابقة');
      }

      setActionMessage(data.message);
      await fetchStatements();
      await fetchStatementLines(activeStatementId, page, statusFilter, search);
    } catch (err: any) {
      setErrorMessage(err.message || 'فشل اعتماد المطابقة');
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
            <span>مطابق مؤكد</span>
          </span>
        );
      case 'suspicious':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span>اشتباه (مراجعة)</span>
          </span>
        );
      case 'multiple_candidates':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-100 text-orange-800">
            <Layers className="w-3 h-3 text-orange-600" />
            <span>مرشحين متعددين</span>
          </span>
        );
      case 'amount_mismatch':
      case 'conflict':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            <span>اختلاف مالي / تعارض</span>
          </span>
        );
      case 'duplicate':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800">
            <RefreshCw className="w-3 h-3 text-purple-600" />
            <span>حركة مكررة</span>
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

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full" dir="rtl">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight flex items-center space-x-2 space-x-reverse">
              <Scale className="w-6 h-6 text-blue-600" />
              <span>مطابقة كشف الحساب البنكي (Bank Reconciliation)</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              استيراد كشوفات بنكك (Excel / CSV)، مطابقة أرقام العمليات آلياً، والتحقق المالي دون قيود وهمية
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse self-stretch sm:self-auto">
            <button
              onClick={() => {
                setImportModalOpen(true);
                setFilePreviewSummary('');
                setFileBase64('');
                setSelectedFile(null);
              }}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
            >
              <Upload className="w-4 h-4" />
              <span>استيراد كشف حساب جديد</span>
            </button>
            <button
              onClick={() => {
                fetchStatements();
                if (activeStatementId) {
                  fetchStatementLines(activeStatementId, page, statusFilter, search);
                }
              }}
              disabled={loading || loadingLines}
              className="p-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 disabled:opacity-50"
              title="تحديث"
            >
              <RefreshCw className={`w-4 h-4 ${loading || loadingLines ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Action Messages */}
        {actionMessage && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs font-bold flex items-center justify-between">
            <div className="flex items-center space-x-2 space-x-reverse">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>{actionMessage}</span>
            </div>
            <button onClick={() => setActionMessage('')} className="p-1 hover:text-emerald-950">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl text-xs font-bold flex items-center justify-between">
            <div className="flex items-center space-x-2 space-x-reverse">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage('')} className="p-1 hover:text-rose-950">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Statement Selector & Action Toolbar */}
        {statements.length > 0 && (
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center space-x-2.5 space-x-reverse min-w-0">
              <FileSpreadsheet className="w-5 h-5 text-blue-600 shrink-0" />
              <span className="text-xs font-bold text-slate-500 whitespace-nowrap">كشف الحساب:</span>
              <select
                value={activeStatementId}
                onChange={(e) => setActiveStatementId(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm font-bold max-w-sm truncate bg-slate-50 focus:bg-white"
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
                disabled={matching || !activeStatementId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 min-h-[40px] flex items-center space-x-1.5 space-x-reverse"
              >
                <Scale className="w-3.5 h-3.5" />
                <span>{matching ? 'جاري الفحص والمطابقة...' : 'تشغيل المطابقة الآلية'}</span>
              </button>

              {activeStatementData?.status === 'reconciled' && (
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

        {/* Detailed KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-slate-500 block mb-0.5 font-bold">إجمالي الحركات</span>
              <span className="text-xl font-black text-slate-900 font-mono">{stats.total}</span>
              <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                {((stats.matchedAmount || 0) + (stats.unmatchedAmount || 0)).toLocaleString()} SDG
              </span>
            </div>

            <div className="bg-emerald-50/80 p-3.5 rounded-2xl border border-emerald-200 shadow-sm">
              <span className="text-[11px] text-emerald-800 block mb-0.5 font-bold">مطابق مؤكد</span>
              <span className="text-xl font-black text-emerald-900 font-mono">{stats.matchedCount}</span>
              <span className="text-[10px] text-emerald-700 block mt-1 font-mono">
                {Number(stats.matchedAmount || 0).toLocaleString()} SDG
              </span>
            </div>

            <div className="bg-amber-50/80 p-3.5 rounded-2xl border border-amber-200 shadow-sm">
              <span className="text-[11px] text-amber-800 block mb-0.5 font-bold">اشتباه / مرشحين</span>
              <span className="text-xl font-black text-amber-900 font-mono">{stats.suspiciousCount}</span>
              <span className="text-[10px] text-amber-700 block mt-1 font-mono">
                {Number(stats.suspiciousAmount || 0).toLocaleString()} SDG
              </span>
            </div>

            <div className="bg-rose-50/80 p-3.5 rounded-2xl border border-rose-200 shadow-sm">
              <span className="text-[11px] text-rose-800 block mb-0.5 font-bold">اختلاف مالي / تعارض</span>
              <span className="text-xl font-black text-rose-900 font-mono">{stats.mismatchCount}</span>
              <span className="text-[10px] text-rose-700 block mt-1 font-mono">
                {Number(stats.mismatchAmount || 0).toLocaleString()} SDG
              </span>
            </div>

            <div className="bg-purple-50/80 p-3.5 rounded-2xl border border-purple-200 shadow-sm">
              <span className="text-[11px] text-purple-800 block mb-0.5 font-bold">حركات مكررة</span>
              <span className="text-xl font-black text-purple-900 font-mono">{stats.duplicateCount}</span>
              <span className="text-[10px] text-purple-700 block mt-1 font-mono">
                {Number(stats.duplicateAmount || 0).toLocaleString()} SDG
              </span>
            </div>

            <div className="bg-slate-100/80 p-3.5 rounded-2xl border border-slate-300 shadow-sm">
              <span className="text-[11px] text-slate-600 block mb-0.5 font-bold">غير مسجل</span>
              <span className="text-xl font-black text-slate-800 font-mono">{stats.unmatchedCount}</span>
              <span className="text-[10px] text-slate-500 block mt-1 font-mono">
                {Number(stats.unmatchedAmount || 0).toLocaleString()} SDG
              </span>
            </div>
          </div>
        )}

        {/* Filter Tabs & Search Bar */}
        {activeStatementId && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-1.5 space-x-reverse overflow-x-auto touch-scroll pb-1">
              {[
                { id: '', label: 'الكل' },
                { id: 'matched', label: 'مطابق مؤكد' },
                { id: 'suspicious', label: 'اشتباه (مراجعة)' },
                { id: 'multiple_candidates', label: 'مرشحين متعددين' },
                { id: 'amount_mismatch', label: 'اختلاف مالي' },
                { id: 'duplicate', label: 'مكرر' },
                { id: 'unmatched', label: 'غير مسجل' },
              ].map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => setStatusFilter(btn.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[38px] ${
                    statusFilter === btn.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="relative min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input
                type="text"
                value={search}
                onChange={handleSearchChange}
                placeholder="بحث برقم TXN أو المرسل..."
                className="w-full pr-9 pl-3 py-2 text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 bg-white min-h-[38px]"
              />
            </div>
          </div>
        )}

        {/* Mobile View: Cards */}
        <div className="lg:hidden space-y-3">
          {loadingLines ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs sm:text-sm">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
              <span>جاري تحميل الحركات البنكية...</span>
            </div>
          ) : lines.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs sm:text-sm">
              لا توجد حركات بنكية تطابق البحث أو الفلتر المحدد
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
                    {Number(l.amount).toLocaleString()} {l.currency || 'SDG'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-2 bg-slate-50 rounded-xl text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">المرسل:</span>
                    <span className="font-medium text-slate-800 truncate block">{l.senderName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">التاريخ:</span>
                    <span className="font-mono text-slate-600">
                      {l.transactionDate} {l.transactionTime ? `(${l.transactionTime})` : ''}
                    </span>
                  </div>
                </div>

                {l.notes && (
                  <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100 font-sans">{l.notes}</p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Desktop View: Table */}
        <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">رقم العملية (TXN)</th>
                  <th className="p-3.5">المبلغ</th>
                  <th className="p-3.5">التاريخ والوقت</th>
                  <th className="p-3.5">المرسل</th>
                  <th className="p-3.5">المستفيد</th>
                  <th className="p-3.5">حالة المطابقة</th>
                  <th className="p-3.5">الملاحظات والنتائج</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loadingLines ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                      <span>جاري تحميل الحركات البنكية...</span>
                    </td>
                  </tr>
                ) : lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400">
                      لا توجد حركات بنكية تطابق البحث أو الفلتر
                    </td>
                  </tr>
                ) : (
                  lines.map((l: any) => (
                    <tr key={l.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-blue-700">{l.transactionId}</td>
                      <td className="p-3.5 font-mono font-black text-slate-900 text-sm">
                        {Number(l.amount).toLocaleString()} {l.currency || 'SDG'}
                      </td>
                      <td className="p-3.5 font-mono text-slate-600">
                        {l.transactionDate} {l.transactionTime ? `(${l.transactionTime})` : ''}
                      </td>
                      <td className="p-3.5">{l.senderName || '—'}</td>
                      <td className="p-3.5">{l.beneficiaryName || '—'}</td>
                      <td className="p-3.5">{getMatchBadge(l.matchStatus)}</td>
                      <td className="p-3.5 text-slate-600 max-w-sm truncate font-sans">{l.notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm text-xs">
            <span className="text-slate-500 font-medium">
              عرض الصفحة {page} من أصل {totalPages} (إجمالي الحركات: {totalCount})
            </span>
            <div className="flex items-center space-x-2 space-x-reverse">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1 || loadingLines}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-700 disabled:opacity-40 hover:bg-slate-50 flex items-center space-x-1 space-x-reverse"
              >
                <ChevronRight className="w-4 h-4" />
                <span>السابق</span>
              </button>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages || loadingLines}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-700 disabled:opacity-40 hover:bg-slate-50 flex items-center space-x-1 space-x-reverse"
              >
                <span>التالي</span>
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* IMPORT STATEMENT MODAL */}
        {importModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto touch-scroll rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2.5 space-x-reverse">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">استيراد كشف حساب بنكي</h3>
                </div>
                <button
                  onClick={() => setImportModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Import Method Tabs */}
              <div className="flex space-x-2 space-x-reverse p-1 bg-slate-100 rounded-xl mb-4 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setImportTab('file')}
                  className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center space-x-1.5 space-x-reverse ${
                    importTab === 'file' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  <FileUp className="w-4 h-4" />
                  <span>رفع ملف Excel أو CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => setImportTab('text')}
                  className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center space-x-1.5 space-x-reverse ${
                    importTab === 'text' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>لصق نصوص يدوياً</span>
                </button>
              </div>

              <form onSubmit={handleImport} className="space-y-4">
                {importTab === 'file' ? (
                  <div className="space-y-3">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-blue-50/20"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".csv, .xlsx, .xls"
                        className="hidden"
                      />
                      <FileUp className="w-10 h-10 text-blue-600 mx-auto mb-2" />
                      <p className="text-sm font-bold text-slate-800">
                        اضغط لاختيار ملف كشف الحساب من الجهاز أو اسحبه هنا
                      </p>
                      <p className="text-xs text-slate-400 mt-1">يدعم ملفات Excel (.xlsx, .xls) وملفات CSV النصية</p>
                    </div>

                    {filePreviewSummary && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs font-bold text-blue-900 flex items-center justify-between">
                        <span>{filePreviewSummary}</span>
                        <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700">
                        بيانات كشف الحساب (نصوص CSV مفصولة بفواصل أو فواصل منقوطة) *
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setImportRawText(
                            `التاريخ,رقم العملية,المبلغ,المرسل,المستفيد\n2026-11-21,TXN-20261121-1001,2000000,عمر أحمد عبدالله,مكتب الصرافة\n2026-11-21,TXN-20261121-1002,3500000,حاتم إبراهيم,مكتب الصرافة\n2026-11-21,TXN-20261121-1003,1500000,محمد عثمان,مكتب الصرافة`
                          );
                        }}
                        className="text-[11px] text-blue-600 font-bold hover:underline"
                      >
                        تحميل نموذج عربي تجريبي
                      </button>
                    </div>
                    <textarea
                      rows={6}
                      value={importRawText}
                      onChange={(e) => setImportRawText(e.target.value)}
                      placeholder="2026-11-21,TXN-123456789,2000000,عمر أحمد,مكتب الصرافة"
                      className="w-full p-3 font-mono text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم كشف الحساب (اختياري)</label>
                  <input
                    type="text"
                    value={importFilename}
                    onChange={(e) => setImportFilename(e.target.value)}
                    placeholder="BOK-Statement-November-2026.xlsx"
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setImportModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={importing || (importTab === 'file' && !fileBase64) || (importTab === 'text' && !importRawText.trim())}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px] flex items-center space-x-1.5 space-x-reverse"
                  >
                    {importing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>جاري التحليل والاستيراد...</span>
                      </>
                    ) : (
                      <span>تأكيد واستيراد الكشف</span>
                    )}
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
