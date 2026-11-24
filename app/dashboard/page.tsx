'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Wallet,
  ArrowDownLeft,
  TrendingUp,
  FileCheck2,
  AlertTriangle,
  UserCheck,
  Building2,
  Users,
  ShieldCheck,
  RefreshCw,
  Scale,
  Lock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = () => {
    setLoading(true);
    setError(null);
    fetch('/api/v1/reports/dashboard')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`خطأ في استجابة الخادم (${res.status})`);
        }
        return res.json();
      })
      .then((resData) => {
        if (resData.success) {
          setData(resData.data);
        } else {
          setError(resData.error || 'تعذر تحميل بيانات لوحة التحكم');
        }
      })
      .catch((err) => {
        setError(err.message || 'حدث خطأ أثناء الاتصال بالخادم');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const kpi = data?.kpi || {};
  const alerts = data?.alerts || [];
  const recentLedger = data?.recentLedger || [];
  const permissions = data?.permissions || {};
  const userRole = data?.userRole || '';

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Top Header & Refresh */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-amber-50 border border-amber-200/80 rounded-full mb-1.5 shadow-xs">
              <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center p-0.5 shrink-0 overflow-hidden shadow-xs border border-amber-200">
                <img src="/brand/logo.png" alt="أبو جواد للتجارة" className="w-full h-full object-contain" />
              </div>
              <span className="text-xs font-bold text-amber-900">أبو جواد للتجارة</span>
              <span className="text-[10px] text-amber-600/80 font-mono tracking-wider">| ABU JAWAD FOR TRADEING</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">لوحة التحكم والمؤشرات المالية</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              نظرة شاملة ولحظية على أرصدة السيولة النقدية، إيصالات بنكك والعهد
              {data?.businessDate && (
                <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] mr-2">
                  اليوم المالي: {data.businessDate}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse self-stretch sm:self-auto">
            <button
              onClick={fetchDashboard}
              disabled={loading}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 space-x-reverse bg-white border border-slate-200 hover:bg-slate-50 active:bg-slate-100 text-slate-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold shadow-sm transition-all min-h-[44px] disabled:opacity-70"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            {permissions?.canCloseDay && (
              <Link
                href="/daily-closing"
                className="flex-1 sm:flex-none flex items-center justify-center bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-amber-600/20 transition-all min-h-[44px] text-center"
              >
                مطابقة وإغلاق اليوم
              </Link>
            )}
          </div>
        </div>

        {/* Error Alert if Fetch Fails */}
        {error && (
          <div className="p-3.5 sm:p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-rose-900 text-xs sm:text-sm">
            <div className="flex items-center space-x-2 space-x-reverse">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={fetchDashboard}
              className="font-bold underline hover:text-rose-950 px-2 py-1"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Alerts Banner */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alert: any, idx: number) => (
              <div
                key={idx}
                className="p-3.5 sm:p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-amber-900"
              >
                <div className="flex items-start sm:items-center space-x-3 space-x-reverse min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                    <AlertTriangle className="w-4 h-4 text-amber-800" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-xs sm:text-sm truncate">{alert.title}</h4>
                    <p className="text-[11px] sm:text-xs text-amber-700 leading-snug">{alert.message}</p>
                  </div>
                </div>
                <Link
                  href={alert.title.includes('إيصالات') ? '/receipts' : '/customer-sessions'}
                  className="text-xs font-bold text-amber-800 underline hover:text-amber-950 shrink-0 self-end sm:self-auto py-1"
                >
                  معالجة الآن &larr;
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Primary Balances Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Total EGP Balance */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-xs font-bold text-slate-500">إجمالي الجنيه المصري (EGP)</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mb-1 truncate">
              {(kpi.totalEgp || 0).toLocaleString()} <span className="text-xs font-medium text-slate-400">EGP</span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100 flex-wrap gap-1">
              <span>خزينة: {(kpi.mainEgpSafe || 0).toLocaleString()}</span>
              {Number(kpi.bankBalance || 0) > 0 && <span>بنك: {(kpi.bankBalance || 0).toLocaleString()}</span>}
              <span>عهد: {(kpi.custodyBalance || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Total SDG Balance */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-xs font-bold text-slate-500">إجمالي الجنيه السوداني (SDG)</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mb-1 truncate">
              {(kpi.totalSdg || 0).toLocaleString()} <span className="text-xs font-medium text-slate-400">SDG</span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100 flex-wrap gap-1">
              <span>بنكك: {(kpi.bankakBalance || 0).toLocaleString()}</span>
              <span>كاش: {(kpi.mainSdgSafe || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Bankak Khartoum Safe */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-xs font-bold text-slate-500">رصيد حساب بنكك (BOK)</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-black text-indigo-700 mb-1 truncate">
              {(kpi.bankakBalance || 0).toLocaleString()} <span className="text-xs font-medium text-indigo-400">SDG</span>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
              <span>استلام تحويلات بنكك الإلكترونية</span>
            </div>
          </div>

          {/* Invested Capital / Role-Specific Primary Metric */}
          {permissions?.canViewCapital ? (
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <span className="text-xs font-bold text-slate-500">رأس المال المستثمر</span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900 mb-1 truncate">
                {(kpi.capitalBalance || 0).toLocaleString()} <span className="text-xs font-medium text-slate-400">EGP</span>
              </div>
              <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                <span>حقوق الملكية للمؤسسة (رأس المال المودع)</span>
              </div>
            </div>
          ) : (
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <span className="text-xs font-bold text-slate-500">
                  {userRole === 'custody_officer'
                    ? 'مصري مسلّم اليوم'
                    : userRole === 'bankak_auditor'
                    ? 'إيصالات بانتظار المراجعة'
                    : 'إجمالي الإيصالات'}
                </span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900 mb-1 truncate">
                {userRole === 'custody_officer'
                  ? `${(kpi.totalDeliveredEgpToday || 0).toLocaleString()} EGP`
                  : userRole === 'bankak_auditor'
                  ? `${kpi.pendingReceiptsCount || 0} إيصال`
                  : `${kpi.totalReceiptsCount || 0} إيصال`}
              </div>
              <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                <span>مؤشر العمليات المعتمد للدور</span>
              </div>
            </div>
          )}
        </div>

        {/* Customer Balances: Multi-Currency Debtors & Creditors Separation */}
        {permissions?.canViewAllBalances && (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 mb-4 gap-1">
              <div>
                <h3 className="font-black text-slate-900 text-sm sm:text-base">أرصدة العملاء (فصل المدينين والدائنين بالعملة)</h3>
                <p className="text-[11px] sm:text-xs text-slate-500">فصل محاسبي دقيق بين الجنيه المصري والسوداني دون مقاصة آلية</p>
              </div>
              <Link href="/customers" className="text-xs font-bold text-blue-600 hover:text-blue-800 self-start sm:self-auto">
                إدارة العملاء وتفاصيل الحسابات &larr;
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Debtors EGP */}
              <div className="bg-amber-50/60 border border-amber-200/70 p-3.5 sm:p-4 rounded-xl">
                <div className="flex items-center justify-between text-xs font-bold text-amber-800 mb-1.5">
                  <span>المدينون بالجنيه المصري (EGP)</span>
                  <Scale className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <div className="text-lg sm:text-xl font-black text-amber-950 font-mono">
                  {(kpi.customerBalances?.debtors?.EGP || 0).toLocaleString()} <span className="text-xs font-normal">EGP</span>
                </div>
                <span className="text-[10px] text-amber-700/80 block mt-1">ديون ومستحقات على العملاء للمؤسسة</span>
              </div>

              {/* Debtors SDG */}
              <div className="bg-orange-50/60 border border-orange-200/70 p-3.5 sm:p-4 rounded-xl">
                <div className="flex items-center justify-between text-xs font-bold text-orange-800 mb-1.5">
                  <span>المدينون بالجنيه السوداني (SDG)</span>
                  <Scale className="w-3.5 h-3.5 text-orange-600" />
                </div>
                <div className="text-lg sm:text-xl font-black text-orange-950 font-mono">
                  {(kpi.customerBalances?.debtors?.SDG || 0).toLocaleString()} <span className="text-xs font-normal">SDG</span>
                </div>
                <span className="text-[10px] text-orange-700/80 block mt-1">ديون ومطالبات سودانية على العملاء</span>
              </div>

              {/* Creditors EGP */}
              <div className="bg-emerald-50/60 border border-emerald-200/70 p-3.5 sm:p-4 rounded-xl">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-800 mb-1.5">
                  <span>الدائنون بالجنيه المصري (EGP)</span>
                  <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <div className="text-lg sm:text-xl font-black text-emerald-950 font-mono">
                  {(kpi.customerBalances?.creditors?.EGP || 0).toLocaleString()} <span className="text-xs font-normal">EGP</span>
                </div>
                <span className="text-[10px] text-emerald-700/80 block mt-1">مستحقات للعملاء بذمة الصندوق للتسليم</span>
              </div>

              {/* Creditors SDG */}
              <div className="bg-blue-50/60 border border-blue-200/70 p-3.5 sm:p-4 rounded-xl">
                <div className="flex items-center justify-between text-xs font-bold text-blue-800 mb-1.5">
                  <span>الدائنون بالجنيه السوداني (SDG)</span>
                  <ArrowDownLeft className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div className="text-lg sm:text-xl font-black text-blue-950 font-mono">
                  {(kpi.customerBalances?.creditors?.SDG || 0).toLocaleString()} <span className="text-xs font-normal">SDG</span>
                </div>
                <span className="text-[10px] text-blue-700/80 block mt-1">أمانات وزيادات إيداع غير مسواة</span>
              </div>
            </div>
          </div>
        )}

        {/* Operational Flow Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
          <div className="bg-white p-3 rounded-xl border border-slate-200 text-center sm:text-right">
            <div className="text-slate-400 text-[11px] mb-0.5 font-medium">عملاء اليوم</div>
            <div className="text-base sm:text-lg font-bold text-slate-900">{kpi.totalCustomersToday || 0}</div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200 text-center sm:text-right">
            <div className="text-slate-400 text-[11px] mb-0.5 font-medium">سوداني اليوم</div>
            <div className="text-base sm:text-lg font-bold text-emerald-600 truncate">
              {(kpi.totalReceivedSdgToday || 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200 text-center sm:text-right">
            <div className="text-slate-400 text-[11px] mb-0.5 font-medium">مصري مسلّم</div>
            <div className="text-base sm:text-lg font-bold text-blue-600 truncate">
              {(kpi.totalDeliveredEgpToday || 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200 text-center sm:text-right">
            <div className="text-slate-400 text-[11px] mb-0.5 font-medium">إجمالي الإيصالات</div>
            <div className="text-base sm:text-lg font-bold text-slate-900">{kpi.totalReceiptsCount || 0}</div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200 text-center sm:text-right">
            <div className="text-slate-400 text-[11px] mb-0.5 font-medium">بانتظار الإجراء</div>
            <div className="text-base sm:text-lg font-bold text-amber-600">
              {kpi.pendingReceiptsCount || 0}
              {kpi.verifiedAwaitingApprovalCount > 0 && (
                <span className="text-[10px] font-normal text-slate-400 block">
                  ({kpi.verifiedAwaitingApprovalCount} بانتظار الاعتماد)
                </span>
              )}
            </div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200 text-center sm:text-right">
            <div className="text-slate-400 text-[11px] mb-0.5 font-medium">إيصالات مكررة</div>
            <div className="text-base sm:text-lg font-bold text-rose-600">
              {(kpi.duplicateReceiptsCount || 0) + (kpi.suspiciousReceiptsCount || 0)}
            </div>
          </div>
        </div>

        {/* Two-Column Section: Recent Transactions & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Recent Ledger Entries (2 cols) */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 sm:p-6">
            <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-100 mb-3 sm:mb-4">
              <div>
                <h3 className="font-black text-slate-900 text-sm sm:text-base">سجل القيود المحاسبية الأخيرة</h3>
                <p className="text-[11px] sm:text-xs text-slate-500">حركات السجل المالي المركزي المزدوج (مدين ودائن متوازن)</p>
              </div>
              {permissions?.canViewLedger && (
                <Link href="/accounts" className="text-xs font-bold text-blue-600 hover:text-blue-800 p-1">
                  دليل الحسابات &larr;
                </Link>
              )}
            </div>

            {!permissions?.canViewLedger ? (
              <div className="text-center py-10 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-xs sm:text-sm font-bold text-slate-700">بيانات السجل المحاسبي المركزي محمية</p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                  الاطلاع على القيود المحاسبية المركزية مقتصر على المحاسب المالي ومدير النظام وفق معايير فصل الصلاحيات والامتثال المالي.
                </p>
              </div>
            ) : recentLedger.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs sm:text-sm">
                لا توجد قيود مالية مسجلة بعد
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentLedger.map((entry: any) => (
                  <div key={entry.id} className="py-3.5 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4">
                      <div className="min-w-0">
                        <div className="font-bold text-xs sm:text-sm text-slate-900 leading-snug">{entry.description}</div>
                        <div className="text-[11px] text-slate-500 flex items-center space-x-1.5 space-x-reverse flex-wrap mt-0.5">
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-600 shrink-0">
                            {entry.entryNumber}
                          </span>
                          <span>•</span>
                          <span className="shrink-0">{entry.entryDate}</span>
                          <span>•</span>
                          <span className="truncate">بواسطة: {entry.createdBy}</span>
                        </div>
                      </div>
                      <div className="self-start sm:self-auto shrink-0">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            entry.status === 'posted'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : entry.status === 'reversed'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {entry.status === 'posted' ? 'قيد معتمد' : entry.status === 'reversed' ? 'قيد معكوس' : entry.status}
                        </span>
                      </div>
                    </div>

                    {/* Ledger lines breakdown showing Debit & Credit distinctly */}
                    {entry.lines && entry.lines.length > 0 && (
                      <div className="bg-slate-50/70 p-2 sm:p-2.5 rounded-xl border border-slate-100 space-y-1 text-xs">
                        {entry.lines.map((line: any) => (
                          <div
                            key={line.id}
                            className="flex items-center justify-between text-[11px] py-0.5 flex-wrap gap-1"
                          >
                            <div className="flex items-center space-x-1.5 space-x-reverse min-w-0">
                              <span
                                className={`px-1.5 py-0.2 rounded font-bold text-[10px] ${
                                  line.debit > 0
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-blue-100 text-blue-800'
                                }`}
                              >
                                {line.debit > 0 ? 'مدين' : 'دائن'}
                              </span>
                              <span className="font-mono text-slate-500 text-[10px]">[{line.accountCode}]</span>
                              <span className="text-slate-700 truncate font-medium">{line.accountName}</span>
                            </div>
                            <div className="font-mono font-bold text-slate-800 shrink-0">
                              {(line.debit > 0 ? line.debit : line.credit).toLocaleString()}{' '}
                              <span className="text-[10px] font-normal text-slate-500">{line.currency}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Shortcuts & Navigation Panel */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 sm:p-6 flex flex-col justify-between">
            <div>
              <h3 className="font-black text-slate-900 text-sm sm:text-base mb-1">العمليات السريعة</h3>
              <p className="text-[11px] sm:text-xs text-slate-500 mb-3 sm:mb-4">
                إجراء المعاملات المالية المعتمدة وفق صلاحيات المستخدم ({userRole || 'المستخدم'})
              </p>

              <div className="space-y-2">
                {/* Upload Receipts - Data entry, Accountant, Admin */}
                {permissions?.canUploadReceipts && (
                  <Link
                    href="/receipts"
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-all text-right group min-h-[52px]"
                  >
                    <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                        <FileCheck2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-800 group-hover:text-blue-700 truncate">رفع إيصالات بنكك</div>
                        <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">معالجة OCR فورية وكشف التكرار</div>
                      </div>
                    </div>
                    <span className="text-slate-400 group-hover:text-blue-600 shrink-0">&larr;</span>
                  </Link>
                )}

                {/* Bankak Auditor Verification */}
                {permissions?.canAuditBankak && !permissions?.canUploadReceipts && (
                  <Link
                    href="/receipts"
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 active:bg-indigo-100 transition-all text-right group min-h-[52px]"
                  >
                    <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-800 group-hover:text-indigo-700 truncate">تدقيق إيصالات بنكك</div>
                        <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">مطابقة ومراجعة التحويلات البنكية</div>
                      </div>
                    </div>
                    <span className="text-slate-400 group-hover:text-indigo-600 shrink-0">&larr;</span>
                  </Link>
                )}

                {/* Open Customer Session */}
                {permissions?.canOpenSession && (
                  <Link
                    href="/customer-sessions"
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 active:bg-emerald-100 transition-all text-right group min-h-[52px]"
                  >
                    <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-800 group-hover:text-emerald-700 truncate">فتح جلسة عميل يومية</div>
                        <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">حساب سعر الصرف وتجميع الإيصالات</div>
                      </div>
                    </div>
                    <span className="text-slate-400 group-hover:text-emerald-600 shrink-0">&larr;</span>
                  </Link>
                )}

                {/* Deliver Cash From Custody - Strictly Custody Officer & Admin (HIDDEN for Accountant) */}
                {permissions?.canDeliver && (
                  <Link
                    href="/custody"
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 active:bg-indigo-100 transition-all text-right group min-h-[52px]"
                  >
                    <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <UserCheck className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-800 group-hover:text-indigo-700 truncate">تسليم نقدية من العهدة</div>
                        <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">صرف كاش مصري ومطابقة العهدة</div>
                      </div>
                    </div>
                    <span className="text-slate-400 group-hover:text-indigo-600 shrink-0">&larr;</span>
                  </Link>
                )}

                {/* Supplier Transactions - Admin & Accountant */}
                {permissions?.canManageSuppliers && (
                  <Link
                    href="/suppliers"
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50 active:bg-amber-100 transition-all text-right group min-h-[52px]"
                  >
                    <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-800 group-hover:text-amber-700 truncate">معاملات الموردين</div>
                        <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">شراء وبيع العملة وحساب الأرباح</div>
                      </div>
                    </div>
                    <span className="text-slate-400 group-hover:text-amber-600 shrink-0">&larr;</span>
                  </Link>
                )}

                {/* Bank Reconciliation - Bankak Auditor / Accountant / Admin */}
                {permissions?.canAuditBankak && (
                  <Link
                    href="/reconciliation"
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-purple-500 hover:bg-purple-50 active:bg-purple-100 transition-all text-right group min-h-[52px]"
                  >
                    <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                        <Scale className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-800 group-hover:text-purple-700 truncate">مطابقة كشف الحساب البنكي</div>
                        <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">فحص وتأكيد حركات بنكك إلكترونياً</div>
                      </div>
                    </div>
                    <span className="text-slate-400 group-hover:text-purple-600 shrink-0">&larr;</span>
                  </Link>
                )}
              </div>
            </div>

            <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
              <div className="font-bold mb-1 flex items-center space-x-1.5 space-x-reverse text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>الأمان والامتثال المالي</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                جميع العمليات مشفرة ومدعومة بسجل رقابي غير قابل للتعديل (Audit Log).
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
