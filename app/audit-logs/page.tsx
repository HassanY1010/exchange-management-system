'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  User,
  Clock,
  Download,
  ChevronRight,
  ChevronLeft,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Calendar,
  Layers,
  Activity,
  ArrowRightLeft,
  Lock,
  Eye,
  X,
  FileSpreadsheet,
} from 'lucide-react';

interface AuditLogItem {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: string | null;
  newValues: string | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: string;
  createdAt: string;
  cairoCreatedAt?: string;
  user?: {
    id: string;
    name: string;
    email?: string;
    role: string;
  };
}

interface PaginationInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const ACTION_OPTIONS = [
  { value: 'all', label: 'جميع أنواع العمليات (All Actions)' },
  { value: 'DAILY_CLOSING', label: 'إغلاق اليومية (DAILY_CLOSING)' },
  { value: 'REOPEN_DAILY_CLOSING', label: 'إعادة فتح اليومية (REOPEN_DAILY_CLOSING)' },
  { value: 'POST_LEDGER_ENTRY', label: 'ترحيل قيد يومية (POST_LEDGER_ENTRY)' },
  { value: 'FUND_TRANSFER', label: 'تحويل بين الخزائن (FUND_TRANSFER)' },
  { value: 'CAPITAL_ADD', label: 'إيداع رأس مال (CAPITAL_ADD)' },
  { value: 'CAPITAL_WITHDRAW', label: 'سحب رأس مال (CAPITAL_WITHDRAW)' },
  { value: 'RECORD_EXPENSE', label: 'تسجيل مصروف (RECORD_EXPENSE)' },
  { value: 'CANCEL_EXPENSE', label: 'إلغاء مصروف (CANCEL_EXPENSE)' },
  { value: 'CREATE_DEBT', label: 'تسجيل دين/ذمة (CREATE_DEBT)' },
  { value: 'DEBT_PAYMENT', label: 'سداد دين (DEBT_PAYMENT)' },
  { value: 'DELIVER_CUSTOMER_CASH', label: 'تسليم نقدية لعميل (DELIVER_CUSTOMER_CASH)' },
  { value: 'EXCEPTIONAL_CASH_DELIVERY', label: 'صرف نقدية استثنائي (EXCEPTIONAL_CASH_DELIVERY)' },
  { value: 'CREATE_CUSTOMER_SESSION', label: 'فتح جلسة عميل (CREATE_CUSTOMER_SESSION)' },
  { value: 'APPROVE_BANKAK_RECEIPT', label: 'اعتماد إشعار بنكك (APPROVE_BANKAK_RECEIPT)' },
  { value: 'REJECT_BANKAK_RECEIPT', label: 'رفض إشعار بنكك (REJECT_BANKAK_RECEIPT)' },
  { value: 'UPDATE_EXCHANGE_RATE', label: 'تحديث سعر الصرف (UPDATE_EXCHANGE_RATE)' },
  { value: 'SUPPLIER_TRANSACTION', label: 'معاملة مورد (SUPPLIER_TRANSACTION)' },
  { value: 'ISSUE_CUSTODY', label: 'صرف عهدة (ISSUE_CUSTODY)' },
  { value: 'SETTLE_CUSTODY', label: 'تسوية عهدة (SETTLE_CUSTODY)' },
  { value: 'LOGIN', label: 'تسجيل دخول (LOGIN)' },
  { value: 'LOGIN_FAILED', label: 'محاولة دخول فاشلة (LOGIN_FAILED)' },
];

const ENTITY_OPTIONS = [
  { value: 'all', label: 'جميع الكيانات (All Entities)' },
  { value: 'DailyClosing', label: 'الإغلاق اليومي (DailyClosing)' },
  { value: 'LedgerEntry', label: 'قيود الأستاذ العام (LedgerEntry)' },
  { value: 'AccountTransfer', label: 'التحويلات المالية (AccountTransfer)' },
  { value: 'CustomerSession', label: 'جلسات العملاء (CustomerSession)' },
  { value: 'Customer', label: 'العملاء (Customer)' },
  { value: 'CapitalTransaction', label: 'رأس المال (CapitalTransaction)' },
  { value: 'Expense', label: 'المصروفات (Expense)' },
  { value: 'Debt', label: 'الديون والذمم (Debt)' },
  { value: 'DebtPayment', label: 'سداد الديون (DebtPayment)' },
  { value: 'BankakReceipt', label: 'إشعارات بنكك (BankakReceipt)' },
  { value: 'Supplier', label: 'الموردون (Supplier)' },
  { value: 'SupplierTransaction', label: 'معاملات الموردين (SupplierTransaction)' },
  { value: 'EmployeeCustody', label: 'العهد المالية (EmployeeCustody)' },
  { value: 'Account', label: 'الحسابات والخزائن (Account)' },
  { value: 'ExchangeRate', label: 'أسعار الصرف (ExchangeRate)' },
  { value: 'User', label: 'المستخدمون (User)' },
  { value: 'SystemSettings', label: 'إعدادات النظام (SystemSettings)' },
];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 25,
    totalCount: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedAction, setSelectedAction] = useState('all');
  const [selectedEntity, setSelectedEntity] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Inspection modal
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
  const [activeTab, setActiveTab] = useState<'comparison' | 'rawOld' | 'rawNew'>('comparison');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch audit logs with full server-side pagination & filtering
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('page', currentPage.toString());
      params.set('limit', pageSize.toString());

      if (debouncedSearch) params.set('search', debouncedSearch);
      if (selectedAction && selectedAction !== 'all') params.set('action', selectedAction);
      if (selectedEntity && selectedEntity !== 'all') params.set('entityType', selectedEntity);
      if (selectedStatus && selectedStatus !== 'all') params.set('status', selectedStatus);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      const res = await fetch(`/api/v1/audit-logs?${params.toString()}`);
      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'فشل في تحميل سجلات التدقيق');
      }

      setLogs(result.data || []);
      if (result.pagination) {
        setPagination(result.pagination);
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ في الاتصال بالخادم');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, debouncedSearch, selectedAction, selectedEntity, selectedStatus, fromDate, toDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Handle Export
  const handleExport = (format: 'csv' | 'json') => {
    const params = new URLSearchParams();
    params.set('export', format);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (selectedAction && selectedAction !== 'all') params.set('action', selectedAction);
    if (selectedEntity && selectedEntity !== 'all') params.set('entityType', selectedEntity);
    if (selectedStatus && selectedStatus !== 'all') params.set('status', selectedStatus);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);

    window.open(`/api/v1/audit-logs?${params.toString()}`, '_blank');
  };

  // Reset filters
  const handleResetFilters = () => {
    setSearch('');
    setSelectedAction('all');
    setSelectedEntity('all');
    setSelectedStatus('all');
    setFromDate('');
    setToDate('');
    setCurrentPage(1);
  };

  // Quick Date presets
  const handleSetDatePreset = (preset: 'today' | 'week' | 'month' | 'all') => {
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(now);

    if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === 'week') {
      const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setFromDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(pastWeek));
      setToDate(todayStr);
    } else if (preset === 'month') {
      const [y, m] = todayStr.split('-');
      setFromDate(`${y}-${m}-01`);
      setToDate(todayStr);
    } else {
      setFromDate('');
      setToDate('');
    }
    setCurrentPage(1);
  };

  // Format Before / After diff
  const parsedDiff = useMemo(() => {
    if (!selectedLog) return null;
    let oldObj: Record<string, any> = {};
    let newObj: Record<string, any> = {};

    try {
      if (selectedLog.oldValues) oldObj = JSON.parse(selectedLog.oldValues);
    } catch {}
    try {
      if (selectedLog.newValues) newObj = JSON.parse(selectedLog.newValues);
    } catch {}

    const allKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));
    return allKeys.map((key) => {
      const oldVal = oldObj[key];
      const newVal = newObj[key];
      const isChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);
      return {
        key,
        oldVal: oldVal !== undefined ? JSON.stringify(oldVal, null, 2) : '—',
        newVal: newVal !== undefined ? JSON.stringify(newVal, null, 2) : '—',
        isChanged,
      };
    });
  }, [selectedLog]);

  const getActionColor = (action: string) => {
    if (action.includes('REOPEN') || action.includes('FAILED') || action.includes('REJECT') || action.includes('CANCEL')) {
      return 'bg-rose-50 text-rose-700 border-rose-200';
    }
    if (action.includes('CLOSING')) {
      return 'bg-purple-50 text-purple-700 border-purple-200';
    }
    if (action.includes('CAPITAL') || action.includes('TRANSFER') || action.includes('DELIVER')) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (action.includes('APPROVE') || action.includes('POST')) {
      return 'bg-blue-50 text-blue-700 border-blue-200';
    }
    return 'bg-slate-100 text-slate-800 border-slate-200';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900">سجل التدقيق الرقابي غير القابل للتعديل</h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  توثيق ذري لكافة العمليات المالية، الجلسات، الخزائن، إغلاقات اليومية، وإجراءات المستخدمين (بتوقيت القاهرة)
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center space-x-1.5 space-x-reverse bg-emerald-50 border border-emerald-200 text-emerald-700 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold hover:bg-emerald-100 min-h-[40px] transition-colors"
              title="تصدير النتائج إلى ملف Excel / CSV"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>تصدير Excel</span>
            </button>

            <button
              onClick={() => handleExport('json')}
              className="flex items-center space-x-1.5 space-x-reverse bg-slate-50 border border-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-100 min-h-[40px] transition-colors"
              title="تصدير JSON"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>JSON</span>
            </button>

            <button
              onClick={fetchLogs}
              disabled={loading}
              className="flex items-center space-x-1.5 space-x-reverse bg-white border border-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-50 min-h-[40px] shadow-sm transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {/* Security & Immutability Notice */}
        <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start sm:items-center space-x-3 space-x-reverse text-emerald-900 text-xs sm:text-sm">
          <Lock className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5 sm:mt-0" />
          <div className="flex-1">
            <span className="font-bold">سجل محمي ومثبت برمجياً: </span>
            <span>
              جميع السجلات غير قابلة للتعديل أو الحذف من أي مستخدم أو واجهة برمجة (Read-Only Immutable). كل عملية مالية يتم قيدها وتوثيقها ذرياً داخل المعاملة المصرفية مع تعتيم البيانات السرية تلقائياً.
            </span>
          </div>
        </div>

        {/* Filter Controls Panel */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2 space-x-reverse text-slate-800 font-bold text-sm">
              <Filter className="w-4 h-4 text-blue-600" />
              <span>خيارات البحث والتصفية الرقابية</span>
            </div>
            <button
              onClick={handleResetFilters}
              className="text-xs text-blue-600 hover:text-blue-700 font-bold hover:underline"
            >
              إعادة ضبط الفلاتر
            </button>
          </div>

          {/* Search bar & quick preset buttons */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-6 relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث حر بالبيان، معرف الكيان، المستخدم، أو عنوان IP..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            </div>

            <div className="md:col-span-6 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500 font-bold ml-1">فترات سريعة:</span>
              <button
                onClick={() => handleSetDatePreset('today')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                اليوم
              </button>
              <button
                onClick={() => handleSetDatePreset('week')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                آخر 7 أيام
              </button>
              <button
                onClick={() => handleSetDatePreset('month')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                الشهر الحالي
              </button>
              <button
                onClick={() => handleSetDatePreset('all')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                كل الفترات
              </button>
            </div>
          </div>

          {/* Detailed Filters row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
            {/* Action Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">نوع العملية (Action)</label>
              <select
                value={selectedAction}
                onChange={(e) => {
                  setSelectedAction(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 min-h-[40px] bg-white font-medium"
              >
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Entity Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">الكيان الرقابي (Entity)</label>
              <select
                value={selectedEntity}
                onChange={(e) => {
                  setSelectedEntity(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 min-h-[40px] bg-white font-medium"
              >
                {ENTITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Status / Outcome Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">نتيجة العملية (Status)</label>
              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 min-h-[40px] bg-white font-medium"
              >
                <option value="all">جميع الحالات (All)</option>
                <option value="SUCCESS">ناجحة فقط (SUCCESS)</option>
                <option value="FAILED">فاشلة / مرفوضة (FAILED)</option>
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">من تاريخ (توقيت القاهرة)</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 min-h-[40px] bg-white"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">إلى تاريخ (توقيت القاهرة)</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500 min-h-[40px] bg-white"
              />
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center space-x-3 space-x-reverse text-rose-800 text-xs sm:text-sm">
            <XCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Logs Table & Mobile Cards */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center space-x-2.5 space-x-reverse">
              <Activity className="w-5 h-5 text-slate-700" />
              <h3 className="font-black text-sm sm:text-base text-slate-900">سجل الأحداث والعمليات المالية</h3>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-mono font-bold">
                {pagination.totalCount.toLocaleString()} سجل
              </span>
            </div>

            {/* Page Size Selector */}
            <div className="flex items-center space-x-2 space-x-reverse text-xs text-slate-600 self-end sm:self-auto">
              <span>عرض:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs bg-white font-bold"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>سجل لكل صفحة</span>
            </div>
          </div>

          {/* Loading State */}
          {loading ? (
            <div className="py-16 text-center text-slate-400 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500" />
              <p className="text-xs font-bold">جارٍ استعلام وتحميل سجلات التدقيق...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <AlertCircle className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm font-bold text-slate-700">لا توجد سجلات تدقيق مطابقة للشروط</p>
              <p className="text-xs text-slate-400">جرّب تغيير كلمات البحث أو توسيع نطاق التواريخ والفلاتر</p>
            </div>
          ) : (
            <>
              {/* Mobile Card List (< sm) */}
              <div className="sm:hidden divide-y divide-slate-100 -mx-4">
                {logs.map((log) => (
                  <div key={log.id} className="p-4 space-y-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-1 rounded-lg border font-mono font-bold text-xs ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {log.status === 'SUCCESS' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>ناجحة</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-rose-600" />
                            <span>فاشلة</span>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                        {log.entityType}
                      </span>
                      {log.entityId && (
                        <span className="font-mono text-slate-400 text-[11px]" title={log.entityId}>
                          ID: {log.entityId.slice(0, 8)}...
                        </span>
                      )}
                    </div>

                    {log.reason && (
                      <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100 leading-relaxed">
                        {log.reason}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{log.user?.name || log.userId || 'النظام'}</span>
                      </div>
                      <div className="flex items-center gap-1 font-mono text-slate-400">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{log.cairoCreatedAt || new Date(log.createdAt).toLocaleDateString('ar-EG')}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedLog(log);
                        setActiveTab('comparison');
                      }}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs min-h-[40px] flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-600" />
                      <span>عرض تفاصيل العملية والتغييرات</span>
                    </button>
                  </div>
                ))}
              </div>

              {/* Desktop Table View (>= sm) */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3 text-center w-12">الحالة</th>
                      <th className="p-3">نوع العملية (Action)</th>
                      <th className="p-3">الكيان (Entity)</th>
                      <th className="p-3">المستخدم والمنفذ</th>
                      <th className="p-3">السبب / البيان</th>
                      <th className="p-3">التاريخ والوقت (توقيت القاهرة)</th>
                      <th className="p-3">عنوان IP</th>
                      <th className="p-3 text-center">التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 text-center">
                          {log.status === 'SUCCESS' ? (
                            <span title="عملية ناجحة" className="inline-block p-1 bg-emerald-50 rounded-full text-emerald-600">
                              <CheckCircle2 className="w-4 h-4" />
                            </span>
                          ) : (
                            <span title="عملية فاشلة / مرفوضة" className="inline-block p-1 bg-rose-50 rounded-full text-rose-600">
                              <XCircle className="w-4 h-4" />
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className={`inline-block px-2.5 py-1 rounded-lg border font-mono font-bold text-xs ${getActionColor(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-blue-700">
                          <div>{log.entityType}</div>
                          {log.entityId && (
                            <span className="text-[10px] font-mono text-slate-400 block" title={log.entityId}>
                              {log.entityId.slice(0, 10)}...
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{log.user?.name || log.userId || 'النظام'}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{log.user?.role || '—'}</div>
                        </td>
                        <td className="p-3 max-w-xs">
                          <p className="truncate text-slate-600" title={log.reason || '—'}>
                            {log.reason || '—'}
                          </p>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {log.cairoCreatedAt || new Date(log.createdAt).toLocaleString('ar-EG')}
                        </td>
                        <td className="p-3 font-mono text-slate-400 text-[11px]">
                          {log.ipAddress || '127.0.0.1'}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => {
                              setSelectedLog(log);
                              setActiveTab('comparison');
                            }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs min-h-[32px] inline-flex items-center gap-1 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>فحص</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Server-Side Pagination Bar */}
              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-slate-600">
                <div className="font-bold">
                  عرض {logs.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} إلى{' '}
                  {Math.min(currentPage * pageSize, pagination.totalCount)} من إجمالي {pagination.totalCount.toLocaleString()} سجل
                </div>

                <div className="flex items-center gap-1 self-center sm:self-auto">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={!pagination.hasPrev || loading}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
                  >
                    <ChevronRight className="w-4 h-4" />
                    <span>السابق</span>
                  </button>

                  <div className="px-3 py-1.5 font-bold font-mono text-slate-800 bg-slate-100 rounded-lg">
                    {currentPage} / {pagination.totalPages || 1}
                  </div>

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                    disabled={!pagination.hasNext || loading}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
                  >
                    <span>التالي</span>
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* DETAILS MODAL / DRAWER */}
        {selectedLog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-slate-900 text-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-2xl p-5 sm:p-6 border border-slate-800 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <div>
                  <h3 className="font-black text-base sm:text-lg text-white">تفاصيل سجل التدقيق الرقابي</h3>
                  <span className="text-[11px] font-mono text-slate-400">معرف السجل: {selectedLog.id}</span>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white text-sm font-bold min-h-[44px] min-w-[44px] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Meta Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-800/60 p-4 rounded-2xl border border-slate-800 text-xs mb-4">
                <div>
                  <span className="text-slate-400 block text-[10px]">نوع العملية:</span>
                  <span className="font-bold text-emerald-400 font-mono">{selectedLog.action}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">الكيان:</span>
                  <span className="font-bold text-blue-400">{selectedLog.entityType}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">النتيجة:</span>
                  <span className={`font-bold ${selectedLog.status === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedLog.status === 'SUCCESS' ? 'ناجحة (SUCCESS)' : 'فاشلة (FAILED)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">المستخدم:</span>
                  <span className="font-bold text-slate-200">{selectedLog.user?.name || selectedLog.userId || 'النظام'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">التاريخ (توقيت القاهرة):</span>
                  <span className="font-mono text-slate-300 text-[11px]">
                    {selectedLog.cairoCreatedAt || new Date(selectedLog.createdAt).toLocaleString('ar-EG')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">عنوان IP:</span>
                  <span className="font-mono text-slate-400">{selectedLog.ipAddress || '127.0.0.1'}</span>
                </div>
              </div>

              {selectedLog.reason && (
                <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 text-xs mb-4">
                  <span className="text-slate-400 block text-[10px] mb-0.5">السبب / البيان المسجل:</span>
                  <p className="text-slate-200 leading-relaxed">{selectedLog.reason}</p>
                </div>
              )}

              {/* Tab Selector */}
              <div className="flex border-b border-slate-800 mb-4 gap-2 text-xs">
                <button
                  onClick={() => setActiveTab('comparison')}
                  className={`pb-2.5 px-3 font-bold border-b-2 transition-colors ${
                    activeTab === 'comparison'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-300'
                  }`}
                >
                  مقارنة التغييرات (Before / After)
                </button>
                {selectedLog.oldValues && (
                  <button
                    onClick={() => setActiveTab('rawOld')}
                    className={`pb-2.5 px-3 font-bold border-b-2 transition-colors ${
                      activeTab === 'rawOld'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    القيم السابقة (Old Values)
                  </button>
                )}
                {selectedLog.newValues && (
                  <button
                    onClick={() => setActiveTab('rawNew')}
                    className={`pb-2.5 px-3 font-bold border-b-2 transition-colors ${
                      activeTab === 'rawNew'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    القيم الجديدة (New Values)
                  </button>
                )}
              </div>

              {/* Tab Contents */}
              {activeTab === 'comparison' && (
                <div className="space-y-3">
                  {!parsedDiff || parsedDiff.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      لا توجد بيانات مقارنة (عملية بدون تعديل حقول)
                    </div>
                  ) : (
                    <div className="border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800 text-xs font-mono">
                      <div className="grid grid-cols-12 bg-slate-800 p-2.5 text-slate-400 font-bold text-[11px]">
                        <div className="col-span-4">الحقل (Field)</div>
                        <div className="col-span-4 text-amber-400">القيمة السابقة (Before)</div>
                        <div className="col-span-4 text-emerald-400">القيمة الجديدة (After)</div>
                      </div>
                      {parsedDiff.map((d) => (
                        <div
                          key={d.key}
                          className={`grid grid-cols-12 p-2.5 items-start ${
                            d.isChanged ? 'bg-blue-950/20' : ''
                          }`}
                        >
                          <div className="col-span-4 font-bold text-slate-300 break-words">{d.key}</div>
                          <div className="col-span-4 text-amber-300/90 break-words text-[11px] whitespace-pre-wrap">
                            {d.oldVal}
                          </div>
                          <div className="col-span-4 text-emerald-300/90 break-words text-[11px] whitespace-pre-wrap">
                            {d.newVal}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'rawOld' && selectedLog.oldValues && (
                <pre className="bg-slate-950 p-4 rounded-2xl overflow-x-auto text-[11px] font-mono text-amber-300 border border-slate-800 max-h-72">
                  {JSON.stringify(JSON.parse(selectedLog.oldValues), null, 2)}
                </pre>
              )}

              {activeTab === 'rawNew' && selectedLog.newValues && (
                <pre className="bg-slate-950 p-4 rounded-2xl overflow-x-auto text-[11px] font-mono text-emerald-300 border border-slate-800 max-h-72">
                  {JSON.stringify(JSON.parse(selectedLog.newValues), null, 2)}
                </pre>
              )}

              {/* Close Button */}
              <div className="pt-4 mt-6 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => setSelectedLog(null)}
                  className="w-full sm:w-auto px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs sm:text-sm font-bold min-h-[44px] transition-colors"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
