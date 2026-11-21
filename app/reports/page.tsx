'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  Download,
  Printer,
  Calendar,
  TrendingUp,
  ArrowDownLeft,
  DollarSign,
  FileSpreadsheet,
} from 'lucide-react';

export default function ReportsPage() {
  const [reportType, setReportType] = useState<'profit_loss' | 'balances' | 'daily'>('profit_loss');
  const [pnlData, setPnlData] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (reportType === 'profit_loss') {
      fetch('/api/v1/reports/profit-loss')
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setPnlData(data.data);
        })
        .finally(() => setLoading(false));
    } else {
      fetch('/api/v1/accounts')
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setAccounts(data.data || []);
        })
        .finally(() => setLoading(false));
    }
  }, [reportType]);

  const exportToExcel = () => {
    let wsData: any[] = [];
    let fileName = 'Financial_Report.xlsx';

    if (reportType === 'profit_loss' && pnlData) {
      fileName = 'Profit_and_Loss_Statement.xlsx';
      wsData = [
        ['قائمة الأرباح والخسائر (Profit & Loss Statement)'],
        ['التاريخ', new Date().toLocaleDateString('ar-EG')],
        [],
        ['البند', 'المبلغ (EGP)'],
        ['أرباح فروق أسعار الصرافة', pnlData.revenues?.exchangeProfits || 0],
        ['أرباح تداول العملات مع الموردين', pnlData.revenues?.supplierProfits || 0],
        ['إجمالي الإيرادات', pnlData.revenues?.totalRevenues || 0],
        [],
        ['المصروفات التشغيلية والعمومية', pnlData.expenses?.totalOperatingExpenses || 0],
        [],
        ['صافي الربح / الخسارة', pnlData.netProfit || 0],
      ];
    } else {
      fileName = 'Accounts_Balances.xlsx';
      wsData = [
        ['كشف أرصدة الصناديق والحسابات المالية'],
        ['التاريخ', new Date().toLocaleDateString('ar-EG')],
        [],
        ['كود الحساب', 'اسم الصندوق / الحساب', 'العملة', 'النوع', 'الرصيد الحالي'],
        ...accounts.map((a) => [a.accountCode, a.name, a.currency, a.accountType, a.currentBalance]),
      ];
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
    XLSX.writeFile(wb, fileName);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
          <div>
            <h1 className="text-2xl font-black text-slate-900">التقارير المالية والتحليل المحاسبي</h1>
            <p className="text-sm text-slate-500">
              قوائم الأرباح والخسائر، مطابقة الأرصدة، وتصدير البيانات إلى Excel و PDF
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <button
              onClick={exportToExcel}
              className="flex items-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20 transition-all"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel (XLSX)</span>
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center space-x-1.5 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md transition-all"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / PDF</span>
            </button>
          </div>
        </div>

        {/* Report Selector Tabs */}
        <div className="flex items-center space-x-2 space-x-reverse no-print">
          <button
            onClick={() => setReportType('profit_loss')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              reportType === 'profit_loss'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            قائمة الأرباح والخسائر (P&L)
          </button>
          <button
            onClick={() => setReportType('balances')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              reportType === 'balances'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            تقرير أرصدة الخزائن والصناديق
          </button>
        </div>

        {/* Printable Report Canvas */}
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm print:border-none print:shadow-none">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4 mb-6">
            <div>
              <h2 className="text-xl font-black text-slate-900">شركة النجم لخدمات الصرافة والتحويلات المالية</h2>
              <p className="text-xs text-slate-500">
                {reportType === 'profit_loss' ? 'قائمة الأرباح والخسائر الرسمية' : 'كشف أرصدة الخزائن والصناديق'}
              </p>
            </div>
            <div className="text-left font-mono text-xs">
              <div className="text-slate-500">تاريخ الإصدار: {new Date().toLocaleDateString('ar-EG')}</div>
              <div className="text-slate-400">العملة المرجعية: جنيه مصري (EGP)</div>
            </div>
          </div>

          {/* PROFIT & LOSS VIEW */}
          {reportType === 'profit_loss' && pnlData && (
            <div className="space-y-6">
              {/* Revenues Section */}
              <div>
                <h4 className="font-black text-sm text-slate-900 mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  أولاً: الإيرادات وأرباح الصرافة
                </h4>
                <div className="divide-y divide-slate-100 text-xs px-2">
                  <div className="py-2.5 flex justify-between">
                    <span className="text-slate-700">أرباح فروق أسعار الصرافة وتحويلات بنكك</span>
                    <span className="font-mono font-bold text-slate-900">
                      {(pnlData.revenues?.exchangeProfits || 0).toLocaleString()} EGP
                    </span>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <span className="text-slate-700">أرباح صفقات تداول العملات مع الموردين</span>
                    <span className="font-mono font-bold text-slate-900">
                      {(pnlData.revenues?.supplierProfits || 0).toLocaleString()} EGP
                    </span>
                  </div>
                  <div className="py-2.5 flex justify-between font-bold text-emerald-700 bg-emerald-50/50 px-2 rounded">
                    <span>إجمالي الإيرادات المحققة</span>
                    <span className="font-mono font-black">
                      {(pnlData.revenues?.totalRevenues || 0).toLocaleString()} EGP
                    </span>
                  </div>
                </div>
              </div>

              {/* Operating Expenses Section */}
              <div>
                <h4 className="font-black text-sm text-slate-900 mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  ثانياً: المصروفات التشغيلية والعمومية
                </h4>
                <div className="divide-y divide-slate-100 text-xs px-2">
                  {pnlData.expenses?.byCategory?.map((item: any, idx: number) => (
                    <div key={idx} className="py-2 flex justify-between">
                      <span className="text-slate-700">{item.category} ({item.date})</span>
                      <span className="font-mono font-bold text-slate-900">
                        {item.amount.toLocaleString()} EGP
                      </span>
                    </div>
                  ))}
                  <div className="py-2.5 flex justify-between font-bold text-rose-700 bg-rose-50/50 px-2 rounded">
                    <span>إجمالي المصروفات</span>
                    <span className="font-mono font-black">
                      {(pnlData.expenses?.totalOperatingExpenses || 0).toLocaleString()} EGP
                    </span>
                  </div>
                </div>
              </div>

              {/* Net Profit Summary */}
              <div className={`p-6 rounded-2xl border text-center ${
                pnlData.netProfit >= 0
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}>
                <div className="text-xs font-bold mb-1">
                  {pnlData.netProfit >= 0 ? 'صافي الربح للفترة (Net Profit)' : 'صافي الخسارة للفترة (Net Loss)'}
                </div>
                <div className="text-3xl font-black font-mono">
                  {pnlData.netProfit.toLocaleString()} <span className="text-sm font-normal">EGP</span>
                </div>
              </div>
            </div>
          )}

          {/* BALANCES VIEW */}
          {reportType === 'balances' && (
            <div>
              <table className="w-full text-right text-xs border border-slate-200 rounded-xl overflow-hidden">
                <thead className="bg-slate-100 text-slate-700 font-bold">
                  <tr>
                    <th className="p-3">كود الحساب</th>
                    <th className="p-3">اسم الصندوق / الحساب</th>
                    <th className="p-3">النوع</th>
                    <th className="p-3">العملة</th>
                    <th className="p-3">الرصيد الافتتاحي</th>
                    <th className="p-3">الرصيد الحالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td className="p-3 font-mono font-bold text-slate-900">{a.accountCode}</td>
                      <td className="p-3 font-bold text-slate-900">{a.name}</td>
                      <td className="p-3 text-slate-500">{a.accountType}</td>
                      <td className="p-3 font-mono font-bold text-blue-600">{a.currency}</td>
                      <td className="p-3 font-mono">{a.openingBalance.toLocaleString()}</td>
                      <td className="p-3 font-mono font-black text-slate-900">{a.currentBalance.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sign-off */}
          <div className="pt-10 border-t border-slate-200 flex justify-between items-end text-xs text-slate-500 mt-8">
            <div className="text-center">
              <div className="mb-8">إعداد: المحاسب القانوني</div>
              <div className="border-t border-dashed border-slate-400 w-32 mx-auto"></div>
            </div>
            <div className="text-center">
              <div className="mb-8">اعتماد: الإدارة المالية</div>
              <div className="border-t border-dashed border-slate-400 w-32 mx-auto"></div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
