'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  FileCheck2,
  AlertTriangle,
  UserCheck,
  Building2,
  Users,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = () => {
    setLoading(true);
    fetch('/api/v1/reports/dashboard')
      .then((res) => res.json())
      .then((resData) => {
        if (resData.success) {
          setData(resData.data);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const kpi = data?.kpi || {};
  const alerts = data?.alerts || [];
  const recentLedger = data?.recentLedger || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Top Header & Refresh */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">لوحة التحكم والمؤشرات المالية المركزية</h1>
            <p className="text-sm text-slate-500">نظرة شاملة ولحظية على أرصدة الخزينة، إيصالات بنكك والعهد اليومية</p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <button
              onClick={fetchDashboard}
              className="flex items-center space-x-1.5 space-x-reverse bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث الأرصدة</span>
            </button>
            <Link
              href="/daily-closing"
              className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-amber-600/20 transition-all"
            >
              مطابقة وإغلاق اليوم
            </Link>
          </div>
        </div>

        {/* Alerts Banner (Section 5.4) */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alert: any, idx: number) => (
              <div
                key={idx}
                className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-amber-900"
              >
                <div className="flex items-center space-x-3 space-x-reverse">
                  <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-4 h-4 text-amber-800" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">{alert.title}</h4>
                    <p className="text-xs text-amber-700">{alert.message}</p>
                  </div>
                </div>
                <Link
                  href={alert.title.includes('إيصالات') ? '/receipts' : '/customer-sessions'}
                  className="text-xs font-bold text-amber-800 underline hover:text-amber-950"
                >
                  معالجة الآن &larr;
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Primary Balances Grid (Section 5.1 & 18) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total EGP Balance */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500">إجمالي الجنيه المصري (EGP)</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 mb-1">
              {(kpi.totalEgp || 0).toLocaleString()} <span className="text-xs font-medium text-slate-400">EGP</span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
              <span>الخزينة الرئيسية: {(kpi.mainEgpSafe || 0).toLocaleString()}</span>
              <span>العهد: {(kpi.custodyBalance || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Total SDG Balance */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500">إجمالي الجنيه السوداني (SDG)</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 mb-1">
              {(kpi.totalSdg || 0).toLocaleString()} <span className="text-xs font-medium text-slate-400">SDG</span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
              <span>رصيد بنكك: {(kpi.bankakBalance || 0).toLocaleString()}</span>
              <span>خزينة الكاش: {(kpi.mainSdgSafe || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Bankak Khartoum Safe */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500">رصيد حساب بنكك (BOK)</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-indigo-700 mb-1">
              {(kpi.bankakBalance || 0).toLocaleString()} <span className="text-xs font-medium text-indigo-400">SDG</span>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
              <span>استلام تحويلات بنكك الإلكترونية</span>
            </div>
          </div>

          {/* Invested Capital */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500">رأس المال المستثمر</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 mb-1">
              {(kpi.capitalBalance || 0).toLocaleString()} <span className="text-xs font-medium text-slate-400">EGP</span>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
              <span>حقوق الملكية للمؤسسة</span>
            </div>
          </div>
        </div>

        {/* Operational Flow Stats (Section 5.2) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
            <div className="text-slate-400 text-xs mb-1 font-medium">عملاء اليوم</div>
            <div className="text-lg font-bold text-slate-900">{kpi.totalCustomersToday || 0}</div>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
            <div className="text-slate-400 text-xs mb-1 font-medium">سوداني مستلم اليوم</div>
            <div className="text-lg font-bold text-emerald-600">{(kpi.totalReceivedSdgToday || 0).toLocaleString()}</div>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
            <div className="text-slate-400 text-xs mb-1 font-medium">مصري مسلّم اليوم</div>
            <div className="text-lg font-bold text-blue-600">{(kpi.totalDeliveredEgpToday || 0).toLocaleString()}</div>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
            <div className="text-slate-400 text-xs mb-1 font-medium">إجمالي الإيصالات</div>
            <div className="text-lg font-bold text-slate-900">{kpi.totalReceiptsCount || 0}</div>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
            <div className="text-slate-400 text-xs mb-1 font-medium">بانتظار المراجعة</div>
            <div className="text-lg font-bold text-amber-600">{kpi.pendingReceiptsCount || 0}</div>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
            <div className="text-slate-400 text-xs mb-1 font-medium">إيصالات مكررة</div>
            <div className="text-lg font-bold text-rose-600">{kpi.duplicateReceiptsCount || 0}</div>
          </div>
        </div>

        {/* Two-Column Section: Recent Transactions & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Ledger Entries (2 cols) */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div>
                <h3 className="font-black text-slate-900 text-base">سجل القيود المحاسبية والحركات الأخيرة</h3>
                <p className="text-xs text-slate-500">حركات السجل المالي المركزي (Double-Entry Central Ledger)</p>
              </div>
              <Link href="/accounts" className="text-xs font-bold text-blue-600 hover:text-blue-800">
                عرض دليل الحسابات &larr;
              </Link>
            </div>

            <div className="divide-y divide-slate-100">
              {recentLedger.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  لا توجد قيود مالية مسجلة بعد
                </div>
              ) : (
                recentLedger.map((entry: any) => (
                  <div key={entry.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-slate-900 mb-0.5">{entry.description}</div>
                      <div className="text-xs text-slate-500 flex items-center space-x-2 space-x-reverse">
                        <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px] text-slate-600">
                          {entry.entryNumber}
                        </span>
                        <span>•</span>
                        <span>{entry.entryDate}</span>
                        <span>•</span>
                        <span>بواسطة: {entry.createdBy}</span>
                      </div>
                    </div>
                    <div className="text-left font-mono">
                      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                        {entry.status === 'posted' ? 'قيد معتمد' : entry.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Shortcuts & Navigation Panel */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 flex flex-col justify-between">
            <div>
              <h3 className="font-black text-slate-900 text-base mb-1">العمليات السريعة</h3>
              <p className="text-xs text-slate-500 mb-4">إجراء المعاملات المالية المعتادة بنقرة واحدة</p>

              <div className="space-y-2.5">
                <Link
                  href="/receipts"
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-right group"
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                      <FileCheck2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-800 group-hover:text-blue-700">رفع إيصالات بنكك</div>
                      <div className="text-[11px] text-slate-500">معالجة OCR فورية وكشف التكرار</div>
                    </div>
                  </div>
                  <span className="text-slate-400 group-hover:text-blue-600">&larr;</span>
                </Link>

                <Link
                  href="/customer-sessions"
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-right group"
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-800 group-hover:text-emerald-700">فتح جلسة عميل يومية</div>
                      <div className="text-[11px] text-slate-500">حساب سعر الصرف وتجميع الإيصالات</div>
                    </div>
                  </div>
                  <span className="text-slate-400 group-hover:text-emerald-600">&larr;</span>
                </Link>

                <Link
                  href="/custody"
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-right group"
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-800 group-hover:text-indigo-700">تسليم نقدية من العهدة</div>
                      <div className="text-[11px] text-slate-500">صرف كاش مصري ومطابقة رصيد الموظف</div>
                    </div>
                  </div>
                  <span className="text-slate-400 group-hover:text-indigo-600">&larr;</span>
                </Link>

                <Link
                  href="/suppliers"
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50 transition-all text-right group"
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-800 group-hover:text-amber-700">شراء / بيع عملة مع مورد</div>
                      <div className="text-[11px] text-slate-500">تطبيق متوسط التكلفة وحساب الأرباح</div>
                    </div>
                  </div>
                  <span className="text-slate-400 group-hover:text-amber-600">&larr;</span>
                </Link>
              </div>
            </div>

            <div className="mt-6 p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
              <div className="font-bold mb-1 flex items-center space-x-1.5 space-x-reverse text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>الأمان والامتثال المالي</span>
              </div>
              <p className="text-[11px] text-slate-500">
                جميع العمليات مشفرة ومدعومة بسجل رقابي غير قابل للتعديل (Audit Log).
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
