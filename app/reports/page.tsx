'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  Download,
  Printer,
  Calendar,
  TrendingUp,
  TrendingDown,
  ArrowDownLeft,
  ArrowUpRight,
  DollarSign,
  FileSpreadsheet,
  Scale,
  Wallet,
  Receipt,
  Layers,
  Search,
  X,
  Filter,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Eye,
} from 'lucide-react';

type ReportTab = 'profit_loss' | 'balance_sheet' | 'trial_balance' | 'cash_flow' | 'balances' | 'ledger';
type PeriodPreset = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';

export default function ReportsPage() {
  // State
  const [activeTab, setActiveTab] = useState<ReportTab>('profit_loss');
  const [period, setPeriod] = useState<PeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [compareWithPrior, setCompareWithPrior] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL');

  // Data states
  const [pnlData, setPnlData] = useState<any>(null);
  const [trialData, setTrialData] = useState<any>(null);
  const [balanceSheetData, setBalanceSheetData] = useState<any>(null);
  const [cashFlowData, setCashFlowData] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [ledgerLines, setLedgerLines] = useState<any[]>([]);
  const [ledgerTotals, setLedgerTotals] = useState({ totalCount: 0, totalDebit: 0, totalCredit: 0 });
  const [loading, setLoading] = useState(true);

  // Drilldown modal
  const [drilldownAccount, setDrilldownAccount] = useState<{ id: string; name: string; code: string; cur: string } | null>(null);
  const [drilldownLines, setDrilldownLines] = useState<any[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Fetch report data based on active tab and filters
  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('period', period);
      if (period === 'custom') {
        if (customFrom) queryParams.set('fromDate', customFrom);
        if (customTo) queryParams.set('toDate', customTo);
      }
      if (selectedCurrency !== 'ALL') {
        queryParams.set('currency', selectedCurrency);
      }
      if (compareWithPrior) {
        queryParams.set('compare', 'true');
      }

      if (activeTab === 'profit_loss') {
        const res = await fetch(`/api/v1/reports/profit-loss?${queryParams.toString()}`);
        const data = await res.json();
        if (data.success) setPnlData(data.data);
      } else if (activeTab === 'trial_balance') {
        const res = await fetch(`/api/v1/reports/trial-balance?${queryParams.toString()}`);
        const data = await res.json();
        if (data.success) setTrialData(data.data);
      } else if (activeTab === 'balance_sheet') {
        const res = await fetch(`/api/v1/reports/balance-sheet?${queryParams.toString()}`);
        const data = await res.json();
        if (data.success) setBalanceSheetData(data.data);
      } else if (activeTab === 'cash_flow') {
        const res = await fetch(`/api/v1/reports/cash-flow?${queryParams.toString()}`);
        const data = await res.json();
        if (data.success) setCashFlowData(data.data);
      } else if (activeTab === 'balances') {
        const res = await fetch('/api/v1/accounts');
        const data = await res.json();
        if (data.success) setAccounts(data.data || []);
      } else if (activeTab === 'ledger') {
        const res = await fetch(`/api/v1/reports/ledger-drilldown?${queryParams.toString()}&limit=100`);
        const data = await res.json();
        if (data.success) {
          setLedgerLines(data.data.lines || []);
          setLedgerTotals({
            totalCount: data.data.totalCount || 0,
            totalDebit: data.data.totalDebit || 0,
            totalCredit: data.data.totalCredit || 0,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, period, customFrom, customTo, selectedCurrency, compareWithPrior]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  // Handle drilldown
  const handleOpenDrilldown = async (acc: { id: string; name: string; code: string; cur: string }) => {
    setDrilldownAccount(acc);
    setDrilldownLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('accountId', acc.id);
      if (period === 'custom') {
        if (customFrom) q.set('fromDate', customFrom);
        if (customTo) q.set('toDate', customTo);
      } else if (pnlData?.fromDate && pnlData?.toDate) {
        q.set('fromDate', pnlData.fromDate);
        q.set('toDate', pnlData.toDate);
      }
      const res = await fetch(`/api/v1/reports/ledger-drilldown?${q.toString()}`);
      const data = await res.json();
      if (data.success) {
        setDrilldownLines(data.data.lines || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDrilldownLoading(false);
    }
  };

  // Currencies list from active data
  const availableCurrencies = useMemo(() => {
    if (activeTab === 'profit_loss' && pnlData) return pnlData.currencies || ['EGP', 'SDG', 'USD'];
    if (activeTab === 'trial_balance' && trialData) return trialData.currencies || ['EGP', 'SDG', 'USD'];
    if (activeTab === 'balance_sheet' && balanceSheetData) return balanceSheetData.currencies || ['EGP', 'SDG', 'USD'];
    if (activeTab === 'cash_flow' && cashFlowData) return cashFlowData.currencies || ['EGP', 'SDG', 'USD'];
    return ['EGP', 'SDG', 'USD', 'SAR', 'AED'];
  }, [activeTab, pnlData, trialData, balanceSheetData, cashFlowData]);

  // Current primary currency for KPI summary
  const summaryCur = selectedCurrency !== 'ALL' ? selectedCurrency : 'EGP';

  // Export to Excel handler
  const exportToExcel = () => {
    let wsData: any[] = [];
    let fileName = `تقرير_مالي_${activeTab}.xlsx`;

    if (activeTab === 'profit_loss' && pnlData) {
      fileName = 'قائمة_الأرباح_والخسائر.xlsx';
      wsData = [
        ['قائمة الأرباح والخسائر الرسمية (Profit & Loss Statement)'],
        ['الفترة من:', pnlData.fromDate, 'إلى:', pnlData.toDate],
        ['تاريخ الإصدار:', new Date().toLocaleDateString('ar-EG')],
        [],
      ];
      for (const cur of pnlData.currencies) {
        const cData = pnlData.byCurrency[cur];
        wsData.push(
          [`--- العملة: ${cur} ---`],
          ['البند', 'المبلغ'],
          ['أرباح تداول وفروق العملات', cData.revenues.tradingProfits],
          ['إيرادات تشغيلية أخرى', cData.revenues.otherRevenues],
          ['إجمالي الإيرادات', cData.revenues.totalRevenues],
          ['المصروفات التشغيلية والعمومية', cData.expenses.totalExpenses],
          ['صافي الربح / (الخسارة)', cData.netProfit],
          []
        );
      }
    } else if (activeTab === 'trial_balance' && trialData) {
      fileName = 'ميزان_المراجعة.xlsx';
      wsData = [
        ['ميزان المراجعة (Trial Balance)'],
        ['الفترة من:', trialData.fromDate, 'إلى:', trialData.toDate],
        [],
      ];
      for (const cur of trialData.currencies) {
        const t = trialData.byCurrency[cur];
        wsData.push(
          [`--- ميزان المراجعة: ${cur} (متوازن: ${t.isBalanced ? 'نعم' : 'لا'}) ---`],
          ['كود الحساب', 'اسم الحساب', 'النوع', 'الرصيد الافتتاحي', 'حركات مدين', 'حركات دائن', 'الرصيد الختامي']
        );
        const allAccs = [
          ...t.classes.assets,
          ...t.classes.liabilities,
          ...t.classes.equity,
          ...t.classes.revenues,
          ...t.classes.expenses,
        ];
        for (const a of allAccs) {
          wsData.push([
            a.accountCode,
            a.name,
            a.accountType,
            a.openingBalance,
            a.periodDebit,
            a.periodCredit,
            a.closingBalance,
          ]);
        }
        wsData.push(
          ['الإجمالي', '', '', '', t.totalDebit, t.totalCredit, 'الفرق: ' + t.difference],
          []
        );
      }
    } else if (activeTab === 'balance_sheet' && balanceSheetData) {
      fileName = 'الميزانية_العمومية.xlsx';
      wsData = [
        ['الميزانية العمومية (Balance Sheet)'],
        ['كما في تاريخ:', balanceSheetData.asOfDate],
        [],
      ];
      for (const cur of balanceSheetData.currencies) {
        const bs = balanceSheetData.byCurrency[cur];
        wsData.push(
          [`--- الميزانية العمومية: ${cur} ---`],
          ['الأصول (Assets)'],
          ...bs.assets.items.map((i: any) => [i.accountCode, i.name, i.balance]),
          ['إجمالي الأصول', '', bs.assets.total],
          [],
          ['الخصوم والالتزامات (Liabilities)'],
          ...bs.liabilities.items.map((i: any) => [i.accountCode, i.name, i.balance]),
          ['إجمالي الالتزامات', '', bs.liabilities.total],
          [],
          ['حقوق الملكية (Equity)'],
          ['رأس المال المستثمر', '', bs.equity.capitalTotal],
          ['الأرباح المبقاة وتسويات الأرصدة الافتتاحية', '', bs.equity.retainedEarnings],
          ['أرباح الفترة الحالية', '', bs.equity.currentPeriodProfit],
          ['إجمالي حقوق الملكية', '', bs.equity.total],
          ['إجمالي الالتزامات وحقوق الملكية', '', bs.totalLiabilitiesAndEquity],
          ['حالة المطابقة', '', bs.isBalanced ? 'متوازنة 100%' : 'فرق: ' + bs.difference],
          []
        );
      }
    } else if (activeTab === 'cash_flow' && cashFlowData) {
      fileName = 'قائمة_التدفقات_النقدية.xlsx';
      wsData = [
        ['قائمة التدفقات النقدية (Cash Flow Statement)'],
        ['الفترة من:', cashFlowData.fromDate, 'إلى:', cashFlowData.toDate],
        [],
      ];
      for (const cur of cashFlowData.currencies) {
        const cf = cashFlowData.byCurrency[cur];
        wsData.push(
          [`--- التدفقات النقدية: ${cur} ---`],
          ['البند', 'المبلغ'],
          ['الرصيد النقدي أول الفترة', cf.openingCash],
          ['تدفقات نقدية داخلة من العمليات', cf.operatingInflow],
          ['تدفقات نقدية خارجة للعمليات والمصروفات', cf.operatingOutflow],
          ['صافي التدفقات التشغيلية', cf.netOperatingFlow],
          ['صافي التدفقات التمويلية (رأس المال)', cf.netFinancingFlow],
          ['صافي التغير في النقدية', cf.netChange],
          ['الرصيد النقدي آخر الفترة', cf.endingCash],
          []
        );
      }
    } else if (activeTab === 'balances') {
      fileName = 'كشف_أرصدة_الحسابات.xlsx';
      wsData = [
        ['كشف أرصدة الصناديق والحسابات المالية'],
        ['التاريخ:', new Date().toLocaleDateString('ar-EG')],
        [],
        ['كود الحساب', 'اسم الصندوق / الحساب', 'العملة', 'النوع', 'الرصيد الافتتاحي', 'الرصيد الحالي'],
        ...accounts.map((a) => [
          a.accountCode,
          a.name,
          a.currency,
          a.accountType,
          a.openingBalance,
          a.currentBalance,
        ]),
      ];
    } else if (activeTab === 'ledger') {
      fileName = 'سجل_قيود_اليومية_العامة.xlsx';
      wsData = [
        ['سجل قيود اليومية العامة (General Ledger Entries)'],
        ['التاريخ:', new Date().toLocaleDateString('ar-EG')],
        [],
        ['رقم القيد', 'التاريخ', 'النوع', 'كود الحساب', 'اسم الحساب', 'العملة', 'مدين', 'دائن', 'البيان', 'المستخدم'],
        ...ledgerLines.map((l) => [
          l.entryNumber,
          l.entryDate,
          l.entryType,
          l.accountCode,
          l.accountName,
          l.currency,
          l.debit,
          l.credit,
          l.description,
          l.createdBy,
        ]),
      ];
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'التقرير المحاسبي');
    XLSX.writeFile(wb, fileName);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header & Main Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              التقارير المالية والتحليل المحاسبي
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              القوائم المالية الختامية، ميزان المراجعة، التدفقات النقدية، وفحص قيود الأستاذ العام
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportToExcel}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-500/20 transition-all min-h-[40px]"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel (XLSX)</span>
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all min-h-[40px]"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / PDF</span>
            </button>
          </div>
        </div>

        {/* FINANCIAL KPI CARDS (Calculated for summary currency) */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 no-print">
          {/* Revenues Card */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-bold">إجمالي الإيرادات ({summaryCur})</span>
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-lg sm:text-xl font-black font-mono text-emerald-600">
              {(pnlData?.byCurrency?.[summaryCur]?.revenues?.totalRevenues || 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-400">
              أرباح صرافة: {(pnlData?.byCurrency?.[summaryCur]?.revenues?.tradingProfits || 0).toLocaleString()}
            </div>
          </div>

          {/* Expenses Card */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-bold">المصروفات التشغيلية ({summaryCur})</span>
              <ArrowDownLeft className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-lg sm:text-xl font-black font-mono text-rose-600">
              {(pnlData?.byCurrency?.[summaryCur]?.expenses?.totalExpenses || 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-400">
              صافي بعد التسويات
            </div>
          </div>

          {/* Net Profit Card */}
          <div className={`p-4 rounded-2xl border shadow-sm space-y-1 ${
            (pnlData?.byCurrency?.[summaryCur]?.netProfit || 0) >= 0
              ? 'bg-emerald-50/50 border-emerald-200'
              : 'bg-rose-50/50 border-rose-200'
          }`}>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-bold">صافي الربح / الخسارة ({summaryCur})</span>
              <BarChart3 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className={`text-lg sm:text-xl font-black font-mono ${
              (pnlData?.byCurrency?.[summaryCur]?.netProfit || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}>
              {(pnlData?.byCurrency?.[summaryCur]?.netProfit || 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500">
              {(pnlData?.byCurrency?.[summaryCur]?.netProfit || 0) >= 0 ? 'فترة رابحة' : 'فترة خاسرة'}
            </div>
          </div>

          {/* Cash Liquidity Assets Card */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-bold">السيولة النقدية ({summaryCur})</span>
              <Wallet className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-lg sm:text-xl font-black font-mono text-slate-900">
              {(balanceSheetData?.byCurrency?.[summaryCur]?.assets?.total || 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-400">
              الخزائن والبنوك والعهد
            </div>
          </div>

          {/* Total Equity Card */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-1 col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-bold">حقوق الملكية ({summaryCur})</span>
              <Scale className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-lg sm:text-xl font-black font-mono text-indigo-900">
              {(balanceSheetData?.byCurrency?.[summaryCur]?.equity?.total || 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-400">
              رأس المال + الأرباح
            </div>
          </div>
        </div>

        {/* Filter Toolbar: Presets, Date inputs, Currency switcher, Comparison */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 no-print">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Period presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'today', label: 'اليوم' },
                { id: 'yesterday', label: 'أمس' },
                { id: 'week', label: 'هذا الأسبوع' },
                { id: 'month', label: 'هذا الشهر' },
                { id: 'year', label: 'هذا العام' },
                { id: 'custom', label: 'مخصص' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id as PeriodPreset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    period === p.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Currency selector */}
            <div className="flex items-center space-x-1.5 space-x-reverse">
              <span className="text-xs font-bold text-slate-500">العملة:</span>
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
                {['ALL', 'EGP', 'SDG', 'USD', 'SAR', 'AED'].map((cur) => (
                  <button
                    key={cur}
                    onClick={() => setSelectedCurrency(cur)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                      selectedCurrency === cur
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cur === 'ALL' ? 'الكل' : cur}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom Date Inputs & Compare Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-bold">من:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-800"
                />
                <span className="text-slate-500 font-bold">إلى:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-800"
                />
              </div>
            )}

            <div className="flex items-center gap-4 mr-auto">
              {activeTab === 'profit_loss' && (
                <label className="flex items-center space-x-1.5 space-x-reverse cursor-pointer font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={compareWithPrior}
                    onChange={(e) => setCompareWithPrior(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>مقارنة بالفترة السابقة (Period Comparison)</span>
                </label>
              )}

              <button
                onClick={fetchReportData}
                disabled={loading}
                className="flex items-center space-x-1 space-x-reverse text-blue-600 hover:text-blue-700 font-bold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
            </div>
          </div>
        </div>

        {/* Report Selector Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-print">
          {[
            { id: 'profit_loss', label: 'قائمة الأرباح والخسائر (P&L)', icon: BarChart3 },
            { id: 'balance_sheet', label: 'الميزانية العمومية (Balance Sheet)', icon: Scale },
            { id: 'trial_balance', label: 'ميزان المراجعة (Trial Balance)', icon: Layers },
            { id: 'cash_flow', label: 'التدفقات النقدية (Cash Flow)', icon: Wallet },
            { id: 'balances', label: 'أرصدة الصناديق والخزائن', icon: Receipt },
            { id: 'ledger', label: 'قيود دفتر الأستاذ (General Ledger)', icon: Eye },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ReportTab)}
                className={`flex items-center space-x-1.5 space-x-reverse px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* PRINTABLE REPORT CANVAS */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-8 shadow-sm print:border-none print:shadow-none min-h-[500px]">
          {/* Formal Official Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b-2 border-slate-900 pb-4 mb-6 gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black text-slate-900">
                  شركة النجم لخدمات الصرافة والتحويلات المالية
                </h2>
                <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  نظام الأستاذ العام المعتمد
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeTab === 'profit_loss' && 'قائمة الأرباح والخسائر الرسمية (Profit & Loss Statement)'}
                {activeTab === 'balance_sheet' && 'الميزانية العمومية كما في نهاية الفترة (Balance Sheet)'}
                {activeTab === 'trial_balance' && 'ميزان المراجعة بالأرصدة والمجاميع (Trial Balance)'}
                {activeTab === 'cash_flow' && 'قائمة التدفقات النقدية التشغيلية والتمويلية (Cash Flows)'}
                {activeTab === 'balances' && 'كشف الأرصدة الحالية للصناديق والحسابات المصرفية'}
                {activeTab === 'ledger' && 'سجل حركات وقيود دفتر الأستاذ العام (General Ledger Audit)'}
              </p>
            </div>
            <div className="text-right sm:text-left font-mono text-xs text-slate-500">
              <div>تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</div>
              <div className="text-slate-400">توقيت المعالجة: Africa/Cairo (UTC+2/UTC+3)</div>
            </div>
          </div>

          {loading ? (
            <div className="py-24 text-center space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
              <p className="text-sm font-bold text-slate-500">جاري إعداد التقرير المحاسبي من دفتر الأستاذ...</p>
            </div>
          ) : (
            <>
              {/* 1. PROFIT & LOSS VIEW */}
              {activeTab === 'profit_loss' && pnlData && (
                <div className="space-y-8">
                  {pnlData.currencies
                    .filter((c: string) => selectedCurrency === 'ALL' || selectedCurrency === c)
                    .map((cur: string) => {
                      const cData = pnlData.byCurrency[cur];
                      const priorData = pnlData.priorPeriod?.byCurrency?.[cur];

                      return (
                        <div key={cur} className="border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5 bg-slate-50/30">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-black px-2.5 py-1 bg-blue-600 text-white rounded-lg">
                                {cur}
                              </span>
                              <h3 className="font-black text-sm text-slate-900">
                                نتائج الأعمال والأرباح والخسائر ({cur})
                              </h3>
                            </div>
                            <span className="text-xs text-slate-500 font-mono">
                              الفترة: {pnlData.fromDate} إلى {pnlData.toDate}
                            </span>
                          </div>

                          {/* Revenues Section */}
                          <div className="space-y-2">
                            <h4 className="font-black text-xs text-slate-700 bg-emerald-50 text-emerald-950 p-2 rounded-lg">
                              أولاً: الإيرادات وأرباح الصرافة المحققة
                            </h4>
                            <div className="divide-y divide-slate-100 text-xs px-2">
                              <div className="py-2.5 flex justify-between">
                                <span className="text-slate-700">أرباح صفقات وفروق أسعار الصرف (Exchange & Trading Profits)</span>
                                <span className="font-mono font-bold text-slate-900">
                                  {cData.revenues.tradingProfits.toLocaleString()} {cur}
                                </span>
                              </div>
                              {cData.revenues.items.map((it: any) => (
                                <div
                                  key={it.accountId}
                                  onClick={() => handleOpenDrilldown({ id: it.accountId, name: it.name, code: it.accountCode, cur })}
                                  className="py-1.5 flex justify-between text-slate-600 hover:text-blue-600 cursor-pointer group"
                                >
                                  <span className="group-hover:underline flex items-center gap-1">
                                    <span>• {it.name} ({it.accountCode})</span>
                                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                                  </span>
                                  <span className="font-mono">{it.amount.toLocaleString()} {cur}</span>
                                </div>
                              ))}
                              <div className="py-2.5 flex justify-between font-bold text-emerald-800 bg-emerald-100/50 px-2 rounded">
                                <span>إجمالي الإيرادات المحققة</span>
                                <span className="font-mono font-black">
                                  {cData.revenues.totalRevenues.toLocaleString()} {cur}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Operating Expenses Section */}
                          <div className="space-y-2">
                            <h4 className="font-black text-xs text-slate-700 bg-rose-50 text-rose-950 p-2 rounded-lg">
                              ثانياً: المصروفات التشغيلية والعمومية
                            </h4>
                            <div className="divide-y divide-slate-100 text-xs px-2">
                              {cData.expenses.items.map((it: any) => (
                                <div
                                  key={it.accountId}
                                  onClick={() => handleOpenDrilldown({ id: it.accountId, name: it.name, code: it.accountCode, cur })}
                                  className="py-2 flex justify-between text-slate-700 hover:text-blue-600 cursor-pointer group"
                                >
                                  <span className="group-hover:underline flex items-center gap-1">
                                    <span>{it.name} ({it.accountCode})</span>
                                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                                  </span>
                                  <span className="font-mono font-bold text-slate-900">
                                    {it.amount.toLocaleString()} {cur}
                                  </span>
                                </div>
                              ))}
                              <div className="py-2.5 flex justify-between font-bold text-rose-800 bg-rose-100/50 px-2 rounded">
                                <span>إجمالي المصروفات التشغيلية</span>
                                <span className="font-mono font-black">
                                  {cData.expenses.totalExpenses.toLocaleString()} {cur}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Net Profit Summary */}
                          <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 ${
                            cData.isProfitable
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                              : 'bg-rose-50 border-rose-300 text-rose-950'
                          }`}>
                            <div>
                              <div className="text-xs font-bold">
                                {cData.isProfitable ? 'صافي الربح للفترة المحاسبية' : 'صافي الخسارة للفترة المحاسبية'}
                              </div>
                              <div className="text-xs text-slate-500">
                                الإيرادات ({cData.revenues.totalRevenues.toLocaleString()}) - المصروفات ({cData.expenses.totalExpenses.toLocaleString()})
                              </div>
                            </div>

                            <div className="flex items-center gap-6">
                              {priorData && (
                                <div className="text-left font-mono text-xs">
                                  <span className="text-slate-500 block">الفترة السابقة:</span>
                                  <span className="font-bold text-slate-700">
                                    {priorData.netProfit.toLocaleString()} {cur}
                                  </span>
                                </div>
                              )}
                              <div className="text-2xl font-black font-mono">
                                {cData.netProfit.toLocaleString()} <span className="text-xs font-normal">{cur}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 2. BALANCE SHEET VIEW */}
              {activeTab === 'balance_sheet' && balanceSheetData && (
                <div className="space-y-8">
                  {balanceSheetData.currencies
                    .filter((c: string) => selectedCurrency === 'ALL' || selectedCurrency === c)
                    .map((cur: string) => {
                      const bs = balanceSheetData.byCurrency[cur];
                      return (
                        <div key={cur} className="border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-6">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-black px-2.5 py-1 bg-slate-900 text-white rounded-lg">
                                {cur}
                              </span>
                              <h3 className="font-black text-sm text-slate-900">
                                الميزانية العمومية كما في {balanceSheetData.asOfDate} ({cur})
                              </h3>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs font-bold">
                              {bs.isBalanced ? (
                                <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>الميزانية متوازنة تماماً (Assets = Liab + Equity)</span>
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>فرق غير متوازن: {bs.difference.toLocaleString()} {cur}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Assets Column */}
                            <div className="space-y-3">
                              <h4 className="font-black text-xs text-slate-800 bg-blue-50 text-blue-900 p-2.5 rounded-xl border border-blue-100">
                                جانب الأصول (Assets)
                              </h4>
                              <div className="divide-y divide-slate-100 text-xs">
                                {bs.assets.items.map((a: any) => (
                                  <div
                                    key={a.id}
                                    onClick={() => handleOpenDrilldown({ id: a.id, name: a.name, code: a.accountCode, cur })}
                                    className="py-2 flex justify-between items-center hover:text-blue-600 cursor-pointer group"
                                  >
                                    <span className="group-hover:underline flex items-center gap-1">
                                      <span className="font-mono font-bold text-slate-500">{a.accountCode}</span>
                                      <span>{a.name}</span>
                                    </span>
                                    <span className="font-mono font-bold text-slate-900">
                                      {a.balance.toLocaleString()} {cur}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="p-3 bg-blue-100/60 rounded-xl flex justify-between font-bold text-xs text-blue-950">
                                <span>إجمالي الأصول</span>
                                <span className="font-mono font-black text-sm">{bs.assets.total.toLocaleString()} {cur}</span>
                              </div>
                            </div>

                            {/* Liabilities & Equity Column */}
                            <div className="space-y-4">
                              {/* Liabilities */}
                              <div className="space-y-2">
                                <h4 className="font-black text-xs text-slate-800 bg-amber-50 text-amber-900 p-2.5 rounded-xl border border-amber-100">
                                  الالتزامات والخصوم (Liabilities)
                                </h4>
                                <div className="divide-y divide-slate-100 text-xs">
                                  {bs.liabilities.items.map((l: any) => (
                                    <div
                                      key={l.id}
                                      onClick={() => handleOpenDrilldown({ id: l.id, name: l.name, code: l.accountCode, cur })}
                                      className="py-2 flex justify-between items-center hover:text-blue-600 cursor-pointer group"
                                    >
                                      <span className="group-hover:underline flex items-center gap-1">
                                        <span className="font-mono font-bold text-slate-500">{l.accountCode}</span>
                                        <span>{l.name}</span>
                                      </span>
                                      <span className="font-mono font-bold text-slate-900">
                                        {l.balance.toLocaleString()} {cur}
                                      </span>
                                    </div>
                                  ))}
                                  {bs.liabilities.items.length === 0 && (
                                    <div className="py-2 text-slate-400 italic">لا توجد التزامات مسجلة</div>
                                  )}
                                </div>
                                <div className="p-2.5 bg-amber-100/50 rounded-xl flex justify-between font-bold text-xs text-amber-950">
                                  <span>إجمالي الالتزامات</span>
                                  <span className="font-mono font-black">{bs.liabilities.total.toLocaleString()} {cur}</span>
                                </div>
                              </div>

                              {/* Equity */}
                              <div className="space-y-2">
                                <h4 className="font-black text-xs text-slate-800 bg-indigo-50 text-indigo-900 p-2.5 rounded-xl border border-indigo-100">
                                  حقوق الملكية (Equity)
                                </h4>
                                <div className="divide-y divide-slate-100 text-xs">
                                  <div className="py-2 flex justify-between">
                                    <span className="text-slate-700">رأس المال المستثمر والمدفوع</span>
                                    <span className="font-mono font-bold text-slate-900">
                                      {bs.equity.capitalTotal.toLocaleString()} {cur}
                                    </span>
                                  </div>
                                  <div className="py-2 flex justify-between">
                                    <span className="text-slate-700">الأرباح المبقاة وتسويات الأرصدة الافتتاحية</span>
                                    <span className="font-mono font-bold text-slate-900">
                                      {bs.equity.retainedEarnings.toLocaleString()} {cur}
                                    </span>
                                  </div>
                                  <div className="py-2 flex justify-between text-emerald-700 font-bold">
                                    <span>أرباح الفترة الحالية (من قائمة الدخل)</span>
                                    <span className="font-mono">
                                      {bs.equity.currentPeriodProfit.toLocaleString()} {cur}
                                    </span>
                                  </div>
                                </div>
                                <div className="p-2.5 bg-indigo-100/50 rounded-xl flex justify-between font-bold text-xs text-indigo-950">
                                  <span>إجمالي حقوق الملكية</span>
                                  <span className="font-mono font-black">{bs.equity.total.toLocaleString()} {cur}</span>
                                </div>
                              </div>

                              {/* Total Liabilities & Equity */}
                              <div className="p-3 bg-slate-900 text-white rounded-xl flex justify-between font-bold text-xs">
                                <span>إجمالي الالتزامات وحقوق الملكية</span>
                                <span className="font-mono font-black text-sm">
                                  {bs.totalLiabilitiesAndEquity.toLocaleString()} {cur}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 3. TRIAL BALANCE VIEW */}
              {activeTab === 'trial_balance' && trialData && (
                <div className="space-y-8">
                  {trialData.currencies
                    .filter((c: string) => selectedCurrency === 'ALL' || selectedCurrency === c)
                    .map((cur: string) => {
                      const t = trialData.byCurrency[cur];
                      const allAccounts = [
                        ...t.classes.assets,
                        ...t.classes.liabilities,
                        ...t.classes.equity,
                        ...t.classes.revenues,
                        ...t.classes.expenses,
                      ];

                      return (
                        <div key={cur} className="border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-black px-2.5 py-1 bg-blue-600 text-white rounded-lg">
                                {cur}
                              </span>
                              <h3 className="font-black text-sm text-slate-900">
                                ميزان المراجعة بالأرصدة والمجاميع ({cur})
                              </h3>
                            </div>
                            <div className="text-xs font-bold">
                              {t.isBalanced ? (
                                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>الميزان متطابق 100% (المدين = الدائن)</span>
                                </span>
                              ) : (
                                <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>فرق غير متطابق: {t.difference.toLocaleString()} {cur}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full text-right text-xs border border-slate-200 rounded-xl overflow-hidden">
                              <thead className="bg-slate-100 text-slate-700 font-bold">
                                <tr>
                                  <th className="p-2.5">كود الحساب</th>
                                  <th className="p-2.5">اسم الحساب</th>
                                  <th className="p-2.5">فئة الحساب</th>
                                  <th className="p-2.5">الرصيد الافتتاحي</th>
                                  <th className="p-2.5 text-blue-700">حركات مدين</th>
                                  <th className="p-2.5 text-blue-700">حركات دائن</th>
                                  <th className="p-2.5 font-black">الرصيد الختامي</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {allAccounts.map((a: any) => (
                                  <tr
                                    key={a.id}
                                    onClick={() => handleOpenDrilldown({ id: a.id, name: a.name, code: a.accountCode, cur })}
                                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                                  >
                                    <td className="p-2.5 font-mono font-bold text-slate-700">{a.accountCode}</td>
                                    <td className="p-2.5 font-bold text-slate-900 flex items-center gap-1">
                                      <span>{a.name}</span>
                                      <ExternalLink className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100" />
                                    </td>
                                    <td className="p-2.5 text-slate-500">
                                      {a.accountClass === '1' && 'أصول'}
                                      {a.accountClass === '2' && 'خصوم'}
                                      {a.accountClass === '3' && 'حقوق ملكية'}
                                      {a.accountClass === '4' && 'إيرادات'}
                                      {a.accountClass === '5' && 'مصروفات'}
                                    </td>
                                    <td className="p-2.5 font-mono">{a.openingBalance.toLocaleString()}</td>
                                    <td className="p-2.5 font-mono text-blue-600 font-bold">{a.periodDebit.toLocaleString()}</td>
                                    <td className="p-2.5 font-mono text-indigo-600 font-bold">{a.periodCredit.toLocaleString()}</td>
                                    <td className="p-2.5 font-mono font-black text-slate-900">{a.closingBalance.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="bg-slate-900 text-white font-bold">
                                <tr>
                                  <td colSpan={4} className="p-2.5 text-left font-black">المجموع العام:</td>
                                  <td className="p-2.5 font-mono font-black text-emerald-400">{t.totalDebit.toLocaleString()}</td>
                                  <td className="p-2.5 font-mono font-black text-emerald-400">{t.totalCredit.toLocaleString()}</td>
                                  <td className="p-2.5 font-mono text-xs">{t.isBalanced ? 'متوازن' : 'غير متوازن'}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 4. CASH FLOW STATEMENT VIEW */}
              {activeTab === 'cash_flow' && cashFlowData && (
                <div className="space-y-8">
                  {cashFlowData.currencies
                    .filter((c: string) => selectedCurrency === 'ALL' || selectedCurrency === c)
                    .map((cur: string) => {
                      const cf = cashFlowData.byCurrency[cur];
                      return (
                        <div key={cur} className="border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-black px-2.5 py-1 bg-blue-600 text-white rounded-lg">
                                {cur}
                              </span>
                              <h3 className="font-black text-sm text-slate-900">
                                قائمة التدفقات النقدية ({cur})
                              </h3>
                            </div>
                            <span className="text-xs text-slate-500 font-mono">
                              من {cashFlowData.fromDate} إلى {cashFlowData.toDate}
                            </span>
                          </div>

                          <div className="divide-y divide-slate-100 text-xs px-2">
                            <div className="py-2.5 flex justify-between font-bold text-slate-700 bg-slate-50 px-2 rounded">
                              <span>الرصيد النقدي أول الفترة (Opening Cash Balance)</span>
                              <span className="font-mono font-black">{cf.openingCash.toLocaleString()} {cur}</span>
                            </div>

                            <div className="py-2 flex justify-between">
                              <span className="text-slate-600">تدفقات نقدية داخلة من العمليات والتحويلات</span>
                              <span className="font-mono font-bold text-emerald-600">
                                +{cf.operatingInflow.toLocaleString()} {cur}
                              </span>
                            </div>

                            <div className="py-2 flex justify-between">
                              <span className="text-slate-600">تدفقات نقدية خارجة للعملاء والمصروفات</span>
                              <span className="font-mono font-bold text-rose-600">
                                -{cf.operatingOutflow.toLocaleString()} {cur}
                              </span>
                            </div>

                            <div className="py-2.5 flex justify-between font-bold text-slate-800 bg-slate-50/50 px-2 rounded">
                              <span>صافي التدفقات النقدية التشغيلية</span>
                              <span className={`font-mono font-black ${cf.netOperatingFlow >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {cf.netOperatingFlow.toLocaleString()} {cur}
                              </span>
                            </div>

                            <div className="py-2 flex justify-between">
                              <span className="text-slate-600">صافي التدفقات من الأنشطة التمويلية (رأس المال)</span>
                              <span className="font-mono font-bold text-indigo-600">
                                {cf.netFinancingFlow.toLocaleString()} {cur}
                              </span>
                            </div>

                            <div className="py-2.5 flex justify-between font-bold text-blue-900 bg-blue-50 px-2 rounded">
                              <span>صافي التغير في النقدية خلال الفترة</span>
                              <span className="font-mono font-black">{cf.netChange.toLocaleString()} {cur}</span>
                            </div>

                            <div className="py-3 flex justify-between font-bold text-sm text-slate-900 bg-slate-900 text-white px-3 rounded-xl mt-2">
                              <span>الرصيد النقدي في نهاية الفترة (Ending Cash Balance)</span>
                              <span className="font-mono font-black text-emerald-400">
                                {cf.endingCash.toLocaleString()} {cur}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 5. ACCOUNTS & BALANCES VIEW */}
              {activeTab === 'balances' && (
                <div className="space-y-4">
                  {/* Desktop Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs border border-slate-200 rounded-xl overflow-hidden">
                      <thead className="bg-slate-100 text-slate-700 font-bold">
                        <tr>
                          <th className="p-3">كود الحساب</th>
                          <th className="p-3">اسم الصندوق / الحساب</th>
                          <th className="p-3">النوع</th>
                          <th className="p-3">العملة</th>
                          <th className="p-3">الرصيد الافتتاحي</th>
                          <th className="p-3 font-black">الرصيد الحالي المعتمد</th>
                          <th className="p-3 text-center">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {accounts
                          .filter((a) => selectedCurrency === 'ALL' || a.currency === selectedCurrency)
                          .map((a) => (
                            <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                              <td className="p-3 font-mono font-bold text-slate-900">{a.accountCode}</td>
                              <td className="p-3 font-bold text-slate-900">{a.name}</td>
                              <td className="p-3 text-slate-500">{a.accountType}</td>
                              <td className="p-3 font-mono font-bold text-blue-600">{a.currency}</td>
                              <td className="p-3 font-mono">{Number(a.openingBalance).toLocaleString()}</td>
                              <td className="p-3 font-mono font-black text-slate-900">{Number(a.currentBalance).toLocaleString()}</td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={() => handleOpenDrilldown({ id: a.id, name: a.name, code: a.accountCode, cur: a.currency })}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-bold inline-flex items-center gap-1"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>فحص القيود</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 6. GENERAL LEDGER VIEW */}
              {activeTab === 'ledger' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span className="font-bold">إجمالي القيود المعروضة: {ledgerTotals.totalCount} قيد</span>
                    <div className="flex items-center gap-4 font-mono font-bold">
                      <span className="text-emerald-700">إجمالي مدين: {ledgerTotals.totalDebit.toLocaleString()}</span>
                      <span className="text-indigo-700">إجمالي دائن: {ledgerTotals.totalCredit.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs border border-slate-200 rounded-xl overflow-hidden">
                      <thead className="bg-slate-100 text-slate-700 font-bold">
                        <tr>
                          <th className="p-2.5">رقم القيد</th>
                          <th className="p-2.5">التاريخ</th>
                          <th className="p-2.5">نوع العملية</th>
                          <th className="p-2.5">الحساب</th>
                          <th className="p-2.5">العملة</th>
                          <th className="p-2.5 text-blue-700">مدين</th>
                          <th className="p-2.5 text-indigo-700">دائن</th>
                          <th className="p-2.5">البيان</th>
                          <th className="p-2.5">المستخدم</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ledgerLines.map((l) => (
                          <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-2.5 font-mono font-bold text-slate-800">{l.entryNumber}</td>
                            <td className="p-2.5 font-mono text-slate-600">{l.entryDate}</td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                                {l.entryType}
                              </span>
                            </td>
                            <td className="p-2.5 font-bold text-slate-900">{l.accountName} ({l.accountCode})</td>
                            <td className="p-2.5 font-mono font-bold text-blue-600">{l.currency}</td>
                            <td className="p-2.5 font-mono text-blue-700 font-bold">{l.debit > 0 ? l.debit.toLocaleString() : '-'}</td>
                            <td className="p-2.5 font-mono text-indigo-700 font-bold">{l.credit > 0 ? l.credit.toLocaleString() : '-'}</td>
                            <td className="p-2.5 text-slate-600 max-w-xs truncate">{l.description}</td>
                            <td className="p-2.5 text-slate-500 text-[11px]">{l.createdBy}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Official Sign-off Footer */}
          <div className="pt-8 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center sm:items-end gap-6 text-xs text-slate-500 mt-12">
            <div className="text-center">
              <div className="mb-6 sm:mb-8 font-bold">إعداد: المحاسب القانوني</div>
              <div className="border-t border-dashed border-slate-400 w-36 mx-auto"></div>
            </div>
            <div className="text-center">
              <div className="mb-6 sm:mb-8 font-bold">مراجعة: رئيس الحسابات</div>
              <div className="border-t border-dashed border-slate-400 w-36 mx-auto"></div>
            </div>
            <div className="text-center">
              <div className="mb-6 sm:mb-8 font-bold">اعتماد: الإدارة المالية والتنفيذية</div>
              <div className="border-t border-dashed border-slate-400 w-36 mx-auto"></div>
            </div>
          </div>
        </div>
      </div>

      {/* DRILLDOWN MODAL */}
      {drilldownAccount && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    {drilldownAccount.code}
                  </span>
                  <h3 className="font-black text-base text-slate-900">
                    فحص قيود دفتر الأستاذ: {drilldownAccount.name}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  جميع القيود المحاسبية الثنائية المكونة لرصيد هذا الحساب خلال الفترة المحددة
                </p>
              </div>
              <button
                onClick={() => setDrilldownAccount(null)}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/50 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              {drilldownLoading ? (
                <div className="py-16 text-center space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-600" />
                  <p className="text-xs text-slate-500">جاري جلب القيود المحاسبية...</p>
                </div>
              ) : drilldownLines.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs italic">
                  لا توجد قيود مسجلة لهذا الحساب خلال الفترة المحددة
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead className="bg-slate-100 text-slate-700 font-bold">
                      <tr>
                        <th className="p-2.5">رقم القيد</th>
                        <th className="p-2.5">التاريخ</th>
                        <th className="p-2.5">النوع</th>
                        <th className="p-2.5">البيان</th>
                        <th className="p-2.5 text-blue-700">مدين ({drilldownAccount.cur})</th>
                        <th className="p-2.5 text-indigo-700">دائن ({drilldownAccount.cur})</th>
                        <th className="p-2.5">المسؤول</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {drilldownLines.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-mono font-bold text-slate-800">{l.entryNumber}</td>
                          <td className="p-2.5 font-mono text-slate-600">{l.entryDate}</td>
                          <td className="p-2.5">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                              {l.entryType}
                            </span>
                          </td>
                          <td className="p-2.5 text-slate-700 max-w-xs">{l.description}</td>
                          <td className="p-2.5 font-mono font-bold text-blue-700">
                            {l.debit > 0 ? l.debit.toLocaleString() : '-'}
                          </td>
                          <td className="p-2.5 font-mono font-bold text-indigo-700">
                            {l.credit > 0 ? l.credit.toLocaleString() : '-'}
                          </td>
                          <td className="p-2.5 text-slate-500 text-[11px]">{l.createdBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center text-xs">
              <span className="font-bold text-slate-500">
                إجمالي الحركات: {drilldownLines.length}
              </span>
              <button
                onClick={() => setDrilldownAccount(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
