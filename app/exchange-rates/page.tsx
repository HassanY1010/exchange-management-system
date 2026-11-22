'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  TrendingUp,
  Plus,
  RefreshCw,
  Clock,
  ArrowRightLeft,
  ShieldCheck,
  Building2,
  Scale,
  Search,
  CheckCircle2,
  AlertTriangle,
  Calculator,
  User,
} from 'lucide-react';

interface ExchangeRateItem {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rateType: 'customer' | 'supplier' | 'market_benchmark';
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

interface PairSpread {
  customerRate: number | null;
  supplierRate: number | null;
  marketRate: number | null;
  spread: number | null;
  marginPercent: number | null;
  isPositiveMargin?: boolean;
  quoteDirection?: 'DIRECT' | 'INDIRECT' | 'MIXED';
}

export default function ExchangeRatesPage() {
  const [rates, setRates] = useState<ExchangeRateItem[]>([]);
  const [activeRates, setActiveRates] = useState<ExchangeRateItem[]>([]);
  const [spreads, setSpreads] = useState<Record<string, PairSpread>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Selected Currency Pair for Quick View
  const [selectedPair, setSelectedPair] = useState<string>('EGP/SDG');

  // Filters for History
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'customer' | 'supplier' | 'market_benchmark'>('all');
  const [historyPairFilter, setHistoryPairFilter] = useState<string>('all');

  // Simulator / Converter State
  const [simulatorAmount, setSimulatorAmount] = useState<number | string>(1000);

  // Modal State for New/Update Rate
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFromCur, setModalFromCur] = useState('EGP');
  const [modalToCur, setModalToCur] = useState('SDG');
  const [modalRateType, setModalRateType] = useState<'customer' | 'supplier' | 'market_benchmark'>('customer');
  const [modalRateValue, setModalRateValue] = useState<number | string>('');
  const [modalReason, setModalReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fetch all rates from API
  const fetchRates = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/v1/exchange-rates');
      const json = await res.json();
      if (json.success) {
        setRates(json.data || []);
        setActiveRates(json.activeRates || []);
        setSpreads(json.spreads || {});
      }
    } catch (err) {
      console.error('Failed to load exchange rates:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRates();
  }, []);

  // Supported Pairs list
  const availablePairs = useMemo(() => {
    const set = new Set<string>(['EGP/SDG', 'USD/SDG', 'USD/EGP', 'SAR/SDG']);
    rates.forEach((r) => set.add(`${r.fromCurrency}/${r.toCurrency}`));
    return Array.from(set);
  }, [rates]);

  // Active rates for currently selected pair
  const currentPairActive = useMemo(() => {
    const [from, to] = selectedPair.split('/');
    const cust = activeRates.find((r) => r.fromCurrency === from && r.toCurrency === to && r.rateType === 'customer');
    const supp = activeRates.find((r) => r.fromCurrency === from && r.toCurrency === to && r.rateType === 'supplier');
    const mkt = activeRates.find((r) => r.fromCurrency === from && r.toCurrency === to && r.rateType === 'market_benchmark');
    return { cust, supp, mkt, spreadData: spreads[selectedPair] };
  }, [selectedPair, activeRates, spreads]);

  // Open modal pre-filled for a specific rate type
  const openEditModal = (type: 'customer' | 'supplier' | 'market_benchmark') => {
    const [from, to] = selectedPair.split('/');
    setModalFromCur(from);
    setModalToCur(to);
    setModalRateType(type);

    const activeItem = activeRates.find(
      (r) => r.fromCurrency === from && r.toCurrency === to && r.rateType === type
    );
    setModalRateValue(activeItem ? activeItem.rate : '');
    setModalReason('');
    setErrorMsg(null);
    setSuccessMsg(null);
    setModalOpen(true);
  };

  // Find currently active rate for the modal's current selection
  const modalCurrentActiveRate = useMemo(() => {
    return activeRates.find(
      (r) =>
        r.fromCurrency === modalFromCur &&
        r.toCurrency === modalToCur &&
        r.rateType === modalRateType
    );
  }, [modalFromCur, modalToCur, modalRateType, activeRates]);

  // Handle Rate Submission
  const handleSubmitRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const numVal = Number(modalRateValue);
    if (!modalRateValue || isNaN(numVal) || numVal <= 0) {
      setErrorMsg('يرجى إدخال قيمة سعر صرف صحيحة وأكبر من الصفر');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/v1/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromCurrency: modalFromCur,
          toCurrency: modalToCur,
          rateType: modalRateType,
          rate: numVal,
          reason: modalReason.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تحديث سعر الصرف');
      }

      setSuccessMsg(data.message || 'تم تحديث وتثبيت سعر الصرف بنجاح');
      setTimeout(() => {
        setModalOpen(false);
        fetchRates();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  // Filtered History
  const filteredHistory = useMemo(() => {
    return rates.filter((r) => {
      // Type Filter
      if (historyTypeFilter !== 'all' && r.rateType !== historyTypeFilter) {
        return false;
      }
      // Pair Filter
      const pair = `${r.fromCurrency}/${r.toCurrency}`;
      if (historyPairFilter !== 'all' && pair !== historyPairFilter) {
        return false;
      }
      // Search Filter
      if (historySearch.trim()) {
        const query = historySearch.toLowerCase().trim();
        const matchesPair = pair.toLowerCase().includes(query);
        const matchesUser = (r.createdBy || '').toLowerCase().includes(query);
        const matchesDate = new Date(r.createdAt).toLocaleDateString('ar-EG').includes(query);
        const matchesRate = r.rate.toString().includes(query);
        if (!matchesPair && !matchesUser && !matchesDate && !matchesRate) {
          return false;
        }
      }
      return true;
    });
  }, [rates, historyTypeFilter, historyPairFilter, historySearch]);

  // Simulator Calculations
  const simNum = Number(simulatorAmount || 0);
  const simCustTotal = currentPairActive.cust ? simNum * currentPairActive.cust.rate : 0;
  const simSuppTotal = currentPairActive.supp ? simNum * currentPairActive.supp.rate : 0;
  const simProfit = simCustTotal > 0 && simSuppTotal > 0 ? simCustTotal - simSuppTotal : 0;

  return (
    <DashboardLayout>
      <div className="space-y-5 sm:space-y-6 max-w-7xl mx-auto pb-12">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                إدارة ومراقبة أسعار الصرف
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 font-mono">
                FX Engine
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              تحديد ومتابعة أسعار تعامل العملاء، أسعار الموردين، والأسعار المرجعية مع التوثيق الكامل للسجل التاريخي
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchRates}
              disabled={refreshing}
              className="flex items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:border-slate-300 min-h-[44px] min-w-[44px] shadow-sm active:scale-95 transition-all"
              title="تحديث البيانات"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-600' : ''}`} />
            </button>
            <button
              onClick={() => openEditModal('customer')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>تحديث / إضافة سعر صرف</span>
            </button>
          </div>
        </div>

        {/* Security Notice Banner */}
        <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 text-amber-900">
          <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <span className="font-black">مبدأ الأمان المالي والمحاسبي: </span>
            أي تعديل في أسعار الصرف يُطبق حصرياً على العمليات المالية الجديدة التي تُنشأ بعد لحظة الحفظ. العمليات التاريخية وسندات الصرف وإيصالات بنكك والقيود المحاسبية السابقة تحتفظ بأسعارها الفعلية المسجلة دون أي تغيير.
          </div>
        </div>

        {/* Currency Pair Tabs Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-xs font-bold text-slate-400 pl-2 shrink-0">زوج العملات:</span>
          {availablePairs.map((pair) => (
            <button
              key={pair}
              onClick={() => setSelectedPair(pair)}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all shrink-0 min-h-[40px] ${
                selectedPair === pair
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {pair}
            </button>
          ))}
        </div>

        {/* ACTIVE RATES CARDS FOR SELECTED PAIR */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4">
          {/* 1. Customer Rate Card */}
          <div
            onClick={() => openEditModal('customer')}
            className="bg-white rounded-2xl sm:rounded-3xl border-2 border-blue-100 hover:border-blue-400 p-4 sm:p-5 shadow-sm flex flex-col justify-between cursor-pointer transition-all active:scale-[0.99] group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/50 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-blue-50 text-blue-700">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>سعر صرف العملاء (Customer Rate)</span>
                </span>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  نشط حالياً
                </span>
              </div>

              <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 tracking-tight my-1">
                1 {selectedPair.split('/')[0]} ={' '}
                <span className="text-blue-600">
                  {currentPairActive.cust ? currentPairActive.cust.rate.toLocaleString() : '—'}
                </span>{' '}
                <span className="text-xs font-normal text-slate-400">{selectedPair.split('/')[1]}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                السعر المستخدم لاحتساب المستحقات وتسليم كاش العملاء
              </p>
            </div>

            <div className="pt-3.5 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {currentPairActive.cust
                  ? new Date(currentPairActive.cust.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
                  : 'غير مسجل'}
              </span>
              <span className="text-blue-600 font-bold group-hover:underline">تعديل السعر &larr;</span>
            </div>
          </div>

          {/* 2. Supplier Rate Card */}
          <div
            onClick={() => openEditModal('supplier')}
            className="bg-white rounded-2xl sm:rounded-3xl border-2 border-purple-100 hover:border-purple-400 p-4 sm:p-5 shadow-sm flex flex-col justify-between cursor-pointer transition-all active:scale-[0.99] group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-50/50 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-purple-50 text-purple-700">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>سعر صرف الموردين (Supplier Rate)</span>
                </span>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  نشط حالياً
                </span>
              </div>

              <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 tracking-tight my-1">
                1 {selectedPair.split('/')[0]} ={' '}
                <span className="text-purple-600">
                  {currentPairActive.supp ? currentPairActive.supp.rate.toLocaleString() : '—'}
                </span>{' '}
                <span className="text-xs font-normal text-slate-400">{selectedPair.split('/')[1]}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                سعر شراء السيولة والعملات من التجار وتغذية الصناديق
              </p>
            </div>

            <div className="pt-3.5 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {currentPairActive.supp
                  ? new Date(currentPairActive.supp.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
                  : 'غير مسجل'}
              </span>
              <span className="text-purple-600 font-bold group-hover:underline">تعديل السعر &larr;</span>
            </div>
          </div>

          {/* 3. Market Benchmark Card */}
          <div
            onClick={() => openEditModal('market_benchmark')}
            className="bg-white rounded-2xl sm:rounded-3xl border-2 border-slate-200 hover:border-slate-400 p-4 sm:p-5 shadow-sm flex flex-col justify-between cursor-pointer transition-all active:scale-[0.99] group relative overflow-hidden"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-700">
                  <Scale className="w-3.5 h-3.5" />
                  <span>السعر المرجعي للسوق (Benchmark)</span>
                </span>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  استرشادي فقط
                </span>
              </div>

              <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 tracking-tight my-1">
                1 {selectedPair.split('/')[0]} ={' '}
                <span className="text-slate-700">
                  {currentPairActive.mkt ? currentPairActive.mkt.rate.toLocaleString() : '—'}
                </span>{' '}
                <span className="text-xs font-normal text-slate-400">{selectedPair.split('/')[1]}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                مؤشر سعر السوق الموازي للمقارنة ولا يُنفذ آلياً بالعمليات
              </p>
            </div>

            <div className="pt-3.5 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {currentPairActive.mkt
                  ? new Date(currentPairActive.mkt.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
                  : 'غير مسجل'}
              </span>
              <span className="text-slate-600 font-bold group-hover:underline">تعديل السعر &larr;</span>
            </div>
          </div>
        </div>

        {/* COMMERCIAL SPREAD & MARGIN ANALYSIS BAR */}
        {currentPairActive.spreadData && currentPairActive.spreadData.spread !== null && (
          <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl sm:rounded-3xl p-4 sm:p-5 text-white shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-white/10 rounded text-[11px] font-bold text-blue-200">
                    مؤشر الربحية لزوج {selectedPair} {currentPairActive.spreadData.quoteDirection === 'INDIRECT' ? '(تسعير عكسي)' : ''}
                  </span>
                  {currentPairActive.spreadData.isPositiveMargin ? (
                    <span className="text-emerald-300 text-xs font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      هامش تجاري إيجابي
                    </span>
                  ) : (
                    <span className="text-rose-300 text-xs font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      تنبيه: الهامش سلبي أو متطابق
                    </span>
                  )}
                </div>
                <div className="text-xs sm:text-sm text-blue-100">
                  فارق السعر بين بيع العملاء ({currentPairActive.spreadData.customerRate}) وشراء الموردين ({currentPairActive.spreadData.supplierRate}):
                </div>
              </div>

              <div className="flex items-center gap-6 self-end sm:self-auto">
                <div className="text-left sm:text-right">
                  <div className="text-xs text-blue-200 font-bold">الفارق بالوحدة</div>
                  <div className="text-xl sm:text-2xl font-black font-mono text-white">
                    {currentPairActive.spreadData.spread > 0 ? `+${currentPairActive.spreadData.spread}` : currentPairActive.spreadData.spread}{' '}
                    <span className="text-xs font-normal text-blue-200">{selectedPair.split('/')[1]}</span>
                  </div>
                </div>

                <div className="text-left sm:text-right border-r border-white/20 pr-6">
                  <div className="text-xs text-blue-200 font-bold">نسبة الهامش التجاري</div>
                  <div className={`text-xl sm:text-2xl font-black font-mono ${currentPairActive.spreadData.isPositiveMargin ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {currentPairActive.spreadData.marginPercent}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CONVERSION SIMULATOR & CALCULATOR */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-blue-600" />
              <h3 className="font-black text-xs sm:text-sm text-slate-900">
                حاسبة التحويل السريع ومحاكاة الأرباح لزوج ({selectedPair})
              </h3>
            </div>
            <span className="text-[11px] text-slate-400 font-bold">حساب فوري</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">
                المبلغ بالعملة الأساس ({selectedPair.split('/')[0]}):
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={simulatorAmount}
                onChange={(e) => setSimulatorAmount(e.target.value)}
                placeholder="1000"
                className="w-full px-3 py-2 font-mono text-sm font-black rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              />
            </div>

            <div className="p-2.5 rounded-xl bg-blue-50/60 border border-blue-100">
              <div className="text-[11px] text-blue-700 font-bold">المطلوب من العميل (سعر العملاء):</div>
              <div className="text-base font-black font-mono text-blue-900 mt-0.5">
                {simCustTotal.toLocaleString()}{' '}
                <span className="text-[10px] font-normal text-blue-700">{selectedPair.split('/')[1]}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-purple-50/60 border border-purple-100">
              <div className="text-[11px] text-purple-700 font-bold">التكلفة على المورد (سعر الموردين):</div>
              <div className="text-base font-black font-mono text-purple-900 mt-0.5">
                {simSuppTotal.toLocaleString()}{' '}
                <span className="text-[10px] font-normal text-purple-700">{selectedPair.split('/')[1]}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
              <div className="text-[11px] text-emerald-700 font-bold">صافي الربح التجاري المقدر:</div>
              <div className="text-base font-black font-mono text-emerald-900 mt-0.5">
                {simProfit > 0 ? `+${simProfit.toLocaleString()}` : '0.00'}{' '}
                <span className="text-[10px] font-normal text-emerald-700">{selectedPair.split('/')[1]}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RATES HISTORY & AUDIT LOG SECTION */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900">
                سجل أسعار الصرف التاريخية والتدقيق
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                أرشيف غير قابل للتعديل يوثق جميع التغييرات، التاريخ، والمستخدم المسؤول
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full self-start sm:self-auto">
              {filteredHistory.length} تسجيلة مطابقة
            </span>
          </div>

          {/* Filters Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="بحث بالعملة، المستخدم، أو التاريخ..."
                className="w-full pr-9 pl-3 py-2 text-xs rounded-xl border border-slate-200 min-h-[42px] focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Type Filter */}
            <select
              value={historyTypeFilter}
              onChange={(e) => setHistoryTypeFilter(e.target.value as any)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 min-h-[42px] font-bold text-slate-700"
            >
              <option value="all">جميع أنواع الأسعار</option>
              <option value="customer">سعر العملاء فقط</option>
              <option value="supplier">سعر الموردين فقط</option>
              <option value="market_benchmark">السعر المرجعي فقط</option>
            </select>

            {/* Pair Filter */}
            <select
              value={historyPairFilter}
              onChange={(e) => setHistoryPairFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 min-h-[42px] font-bold text-slate-700 font-mono"
            >
              <option value="all">جميع أزواج العملات</option>
              {availablePairs.map((pair) => (
                <option key={pair} value={pair}>
                  {pair}
                </option>
              ))}
            </select>
          </div>

          {/* Mobile History Cards (< sm) */}
          <div className="sm:hidden divide-y divide-slate-100 -mx-4">
            {filteredHistory.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">لا يوجد سجل تاريخي يطابق الفلترة</div>
            ) : (
              filteredHistory.map((r) => {
                const typeBadge =
                  r.rateType === 'customer'
                    ? { bg: 'bg-blue-50 text-blue-700 border-blue-200', label: 'عملاء' }
                    : r.rateType === 'supplier'
                    ? { bg: 'bg-purple-50 text-purple-700 border-purple-200', label: 'موردين' }
                    : { bg: 'bg-slate-100 text-slate-700 border-slate-200', label: 'مرجعي' };

                return (
                  <div key={r.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-md">
                        {r.fromCurrency} / {r.toCurrency}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${typeBadge.bg}`}>
                          {typeBadge.label}
                        </span>
                        {r.isActive ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                            نشط
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">
                            مؤرشف
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <span className="font-mono font-black text-lg text-slate-900">
                        1 {r.fromCurrency} = {r.rate.toLocaleString()} {r.toCurrency}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(r.createdAt).toLocaleDateString('ar-EG')}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        بواسطة: <span className="font-semibold text-slate-800">{r.createdBy || 'النظام'}</span>
                      </span>
                      <span className="text-slate-400 font-mono">
                        {new Date(r.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table (sm+) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">زوج العملات</th>
                  <th className="p-3">نوع السعر</th>
                  <th className="p-3">سعر الصرف المسجل</th>
                  <th className="p-3">الحالة الدفترية</th>
                  <th className="p-3">المستخدم المسؤول</th>
                  <th className="p-3">تاريخ ووقت التفعيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      لا توجد أسعار صرف تطابق خيارات التصفية المحددة
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((r) => {
                    const typeBadge =
                      r.rateType === 'customer'
                        ? { bg: 'bg-blue-50 text-blue-700 border-blue-200', label: 'سعر العملاء' }
                        : r.rateType === 'supplier'
                        ? { bg: 'bg-purple-50 text-purple-700 border-purple-200', label: 'سعر الموردين' }
                        : { bg: 'bg-slate-100 text-slate-700 border-slate-200', label: 'سعر السوق المرجعي' };

                    return (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-black text-slate-900">
                          {r.fromCurrency} / {r.toCurrency}
                        </td>
                        <td className="p-3">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${typeBadge.bg}`}>
                            {typeBadge.label}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-black text-slate-900 text-sm">
                          1 {r.fromCurrency} = {r.rate.toLocaleString()} {r.toCurrency}
                        </td>
                        <td className="p-3">
                          {r.isActive ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3" />
                              نشط حالياً
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">
                              مؤرشف
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-slate-700">{r.createdBy || 'النظام'}</td>
                        <td className="p-3 font-mono text-[11px] text-slate-500">
                          {new Date(r.createdAt).toLocaleString('ar-EG')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* BOTTOM SHEET / MODAL FOR NEW RATE */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 mb-4">
                <div>
                  <h3 className="font-black text-slate-900 text-base">تحديث / تثبيت سعر صرف جديد</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    تطبيق فوري على العمليات الجديدة مع أرشفة السعر القديم
                  </p>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {/* Status alerts */}
              {errorMsg && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}
              {successMsg && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{successMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmitRate} className="space-y-4">
                {/* Currency Pair selection */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة الأساس</label>
                    <select
                      value={modalFromCur}
                      onChange={(e) => setModalFromCur(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 font-bold min-h-[44px]"
                    >
                      <option value="EGP">EGP - جنيه مصري</option>
                      <option value="USD">USD - دولار أمريكي</option>
                      <option value="SAR">SAR - ريال سعودي</option>
                      <option value="AED">AED - درهم إماراتي</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة المقابلة</label>
                    <select
                      value={modalToCur}
                      onChange={(e) => setModalToCur(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 font-bold min-h-[44px]"
                    >
                      <option value="SDG">SDG - جنيه سوداني</option>
                      <option value="EGP">EGP - جنيه مصري</option>
                      <option value="USD">USD - دولار أمريكي</option>
                    </select>
                  </div>
                </div>

                {/* Rate Type selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">نوع سعر الصرف</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setModalRateType('customer')}
                      className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-center min-h-[44px] ${
                        modalRateType === 'customer'
                          ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      سعر العملاء
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalRateType('supplier')}
                      className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-center min-h-[44px] ${
                        modalRateType === 'supplier'
                          ? 'border-purple-600 bg-purple-50 text-purple-900 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      سعر الموردين
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalRateType('market_benchmark')}
                      className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-center min-h-[44px] ${
                        modalRateType === 'market_benchmark'
                          ? 'border-slate-600 bg-slate-100 text-slate-900 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      السوق المرجعي
                    </button>
                  </div>
                </div>

                {/* Current Active Rate Indicator */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <span className="text-xs text-slate-600 font-bold">السعر النشط حالياً:</span>
                  <span className="font-mono font-black text-sm text-slate-900">
                    {modalCurrentActiveRate
                      ? `1 ${modalFromCur} = ${modalCurrentActiveRate.rate.toLocaleString()} ${modalToCur}`
                      : 'لا يوجد سعر نشط مسجل'}
                  </span>
                </div>

                {/* Rate Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    السعر الجديد المطلوب اعتماده (قيمة 1 {modalFromCur} بالـ {modalToCur}):
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    value={modalRateValue}
                    onChange={(e) => setModalRateValue(e.target.value)}
                    required
                    placeholder="مثال: 200"
                    className="w-full px-3 py-2.5 font-mono text-base font-black rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                  {modalCurrentActiveRate && modalRateValue && (
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">
                      الفارق عن السعر الحالي:{' '}
                      <span
                        className={
                          Number(modalRateValue) >= modalCurrentActiveRate.rate
                            ? 'text-emerald-600 font-bold'
                            : 'text-rose-600 font-bold'
                        }
                      >
                        {(Number(modalRateValue) - modalCurrentActiveRate.rate).toFixed(4)}{' '}
                        ({(((Number(modalRateValue) - modalCurrentActiveRate.rate) / modalCurrentActiveRate.rate) * 100).toFixed(2)}%)
                      </span>
                    </div>
                  )}
                </div>

                {/* Reason Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سبب التعديل أو الملاحظات (توثيق التدقيق):
                  </label>
                  <input
                    type="text"
                    value={modalReason}
                    onChange={(e) => setModalReason(e.target.value)}
                    placeholder="مثال: تعديل لافتتاح الفترة الصباحية / تغير سعر السوق الموازي"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                {/* Safety Footnote */}
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-amber-900 text-[11px] leading-relaxed">
                  تنبيه تدقيق: سيتم توثيق هذا التعديل في سجل AuditLog باسم حسابك الحالي وتاريخ ووقت العملية.
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    disabled={saving}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-50 min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px] transition-all"
                  >
                    {saving ? 'جاري الاعتماد والحفظ...' : 'تثبيت واعتماد السعر الجديد'}
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
