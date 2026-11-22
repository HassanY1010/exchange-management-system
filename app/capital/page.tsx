'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Landmark,
  Plus,
  Minus,
  TrendingUp,
  Wallet,
  Clock,
  ShieldCheck,
  Building2,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  DollarSign,
  User,
  Scale,
} from 'lucide-react';

interface CapitalTransactionItem {
  id: string;
  transactionType: 'initial_capital' | 'addition' | 'withdrawal' | 'personal_draw';
  accountId: string;
  currency: string;
  amount: number;
  transactionDate: string;
  description: string;
  createdBy: string;
  createdAt: string;
  account?: {
    id: string;
    name: string;
    accountCode: string;
    currency: string;
  } | null;
}

interface EquityCurrencyItem {
  currency: string;
  investedCapital: number;
  netProfit: number;
  totalEquity: number;
  availableLiquidity: number;
  accountCode: string;
  accountId: string;
}

export default function CapitalPage() {
  const [transactions, setTransactions] = useState<CapitalTransactionItem[]>([]);
  const [currentCapitalEgp, setCurrentCapitalEgp] = useState<number>(0);
  const [capitalByCurrency, setCapitalByCurrency] = useState<Record<string, number>>({});
  const [equityStructure, setEquityStructure] = useState<Record<string, EquityCurrencyItem>>({});
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Selected Currency Tab
  const [selectedCurrencyTab, setSelectedCurrencyTab] = useState<string>('all');

  // History Filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'addition' | 'withdrawal'>('all');
  const [historyCurrencyFilter, setHistoryCurrencyFilter] = useState<string>('all');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [transType, setTransType] = useState<'addition' | 'withdrawal'>('addition');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [amount, setAmount] = useState<number | string>(50000);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchCapital = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/v1/capital');
      const data = await res.json();
      if (data.success) {
        setTransactions(data.data || []);
        setCurrentCapitalEgp(data.currentCapital || 0);
        setCapitalByCurrency(data.capitalByCurrency || {});
        setEquityStructure(data.equityStructure || {});
      }
    } catch (err) {
      console.error('Failed to load capital data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    try {
      const resAcc = await fetch('/api/v1/accounts');
      const dataAcc = await resAcc.json();
      if (dataAcc.success) {
        const cashAccounts = dataAcc.data?.filter((a: any) =>
          ['cash_safe', 'bank', 'bankak'].includes(a.accountType) && a.status === 'active'
        );
        setAccounts(cashAccounts || []);
        if (cashAccounts?.length > 0 && !selectedAccountId) {
          setSelectedAccountId(cashAccounts[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load accounts for capital:', err);
    }
  };

  useEffect(() => {
    fetchCapital();
  }, []);

  // Selected Account details for modal
  const selectedAccountDetails = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId) || null;
  }, [accounts, selectedAccountId]);

  // List of currencies available in capital accounts
  const availableCurrencies = useMemo(() => {
    const set = new Set<string>(['EGP', 'SDG', 'USD']);
    Object.keys(capitalByCurrency).forEach((c) => set.add(c));
    return Array.from(set);
  }, [capitalByCurrency]);

  // Open Modal Pre-configured
  const openModal = (type: 'addition' | 'withdrawal', cur?: string) => {
    setTransType(type);
    setErrorMsg(null);
    setSuccessMsg(null);
    setDescription('');

    if (cur) {
      const matchingAcc = accounts.find((a) => a.currency === cur);
      if (matchingAcc) setSelectedAccountId(matchingAcc.id);
    } else if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }

    setModalOpen(true);
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('يرجى إدخال مبلغ صحيح وأكبر من الصفر');
      return;
    }

    if (!selectedAccountId) {
      setErrorMsg('يرجى اختيار الصندوق أو الحساب البنكي لتنفيذ الحركة');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionType: transType,
          accountId: selectedAccountId,
          amount: numAmount,
          description: description.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل حركة رأس المال');
      }

      setSuccessMsg(data.message || 'تم توثيق حركة رأس المال وترحيل القيود بنجاح');
      setTimeout(() => {
        setModalOpen(false);
        fetchCapital();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered History
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Type Filter
      if (historyTypeFilter === 'addition' && !['addition', 'initial_capital'].includes(tx.transactionType)) {
        return false;
      }
      if (historyTypeFilter === 'withdrawal' && !['withdrawal', 'personal_draw'].includes(tx.transactionType)) {
        return false;
      }

      // Currency Filter
      if (historyCurrencyFilter !== 'all' && tx.currency !== historyCurrencyFilter) {
        return false;
      }

      // Search
      if (historySearch.trim()) {
        const query = historySearch.toLowerCase().trim();
        const matchesAccount = (tx.account?.name || '').toLowerCase().includes(query);
        const matchesDesc = (tx.description || '').toLowerCase().includes(query);
        const matchesUser = (tx.createdBy || '').toLowerCase().includes(query);
        const matchesAmount = tx.amount.toString().includes(query);
        if (!matchesAccount && !matchesDesc && !matchesUser && !matchesAmount) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, historyTypeFilter, historyCurrencyFilter, historySearch]);

  return (
    <DashboardLayout>
      <div className="space-y-5 sm:space-y-6 max-w-7xl mx-auto pb-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                إدارة رأس المال وحقوق الشركاء
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 font-mono">
                Equity & Capital
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              توثيق رأس المال المستثمر، المساهمات الإضافية، والمسحوبات بدقة محاسبية مزدوجة لكل عملة
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchCapital}
              disabled={refreshing}
              className="flex items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 min-h-[44px] min-w-[44px] shadow-sm active:scale-95 transition-all"
              title="تحديث البيانات"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-600' : ''}`} />
            </button>
            <button
              onClick={() => openModal('addition')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-500/20 active:scale-95 transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة رأس مال</span>
            </button>
            <button
              onClick={() => openModal('withdrawal')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-rose-500/20 active:scale-95 transition-all min-h-[44px]"
            >
              <Minus className="w-4 h-4" />
              <span>سحب رأس مال</span>
            </button>
          </div>
        </div>

        {/* Accounting Rule Alert */}
        <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 text-amber-900">
          <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <span className="font-black">قاعدة محاسبية صارمة (Equity Class 3): </span>
            رأس المال يمثل حقوق الملكية المستثمرة ويتم ترحيله بقيد يومية مزدوج (`مدين الخزينة المستلمة / دائن حساب رأس المال`). لا تُعد مساهمات رأس المال إيرادات تجارية، ولا تُعد مسحوبات الشركاء مصروفات تشغيلية، ولا يتم خلط العملات إطلاقاً.
          </div>
        </div>

        {/* Currency Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-xs font-bold text-slate-400 pl-2 shrink-0">عرض العملة:</span>
          <button
            onClick={() => setSelectedCurrencyTab('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all shrink-0 min-h-[40px] ${
              selectedCurrencyTab === 'all'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
            }`}
          >
            جميع العملات (Multi-Currency)
          </button>
          {availableCurrencies.map((cur) => (
            <button
              key={cur}
              onClick={() => setSelectedCurrencyTab(cur)}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all shrink-0 min-h-[40px] ${
                selectedCurrencyTab === cur
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {cur}
            </button>
          ))}
        </div>

        {/* CAPITAL & EQUITY CARDS PER CURRENCY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4">
          {availableCurrencies
            .filter((c) => selectedCurrencyTab === 'all' || selectedCurrencyTab === c)
            .map((cur) => {
              const eq = equityStructure[cur] || {
                currency: cur,
                investedCapital: capitalByCurrency[cur] || 0,
                netProfit: 0,
                totalEquity: capitalByCurrency[cur] || 0,
                availableLiquidity: 0,
                accountCode: cur === 'EGP' ? '3010' : `3010-${cur}`,
              };

              const isEgp = cur === 'EGP';
              const isUsd = cur === 'USD';

              return (
                <div
                  key={cur}
                  className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 hover:border-amber-400 p-4 sm:p-5 shadow-sm flex flex-col justify-between transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-800">
                        <Landmark className="w-3.5 h-3.5" />
                        <span>رأس مال {cur}</span>
                      </span>
                      <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                        حساب {eq.accountCode}
                      </span>
                    </div>

                    {/* Invested Capital */}
                    <div className="mb-3">
                      <span className="text-[11px] font-bold text-slate-400 block mb-0.5">
                        رأس المال المستثمر الأساسي
                      </span>
                      <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 tracking-tight">
                        {eq.investedCapital.toLocaleString()}{' '}
                        <span className="text-xs font-normal text-slate-400">{cur}</span>
                      </div>
                    </div>

                    {/* Equity Breakdown */}
                    <div className="space-y-1.5 pt-3 border-t border-slate-100 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">صافي أرباح الفترة التراكمية:</span>
                        <span
                          className={`font-mono font-bold ${
                            eq.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {eq.netProfit >= 0 ? `+${eq.netProfit.toLocaleString()}` : eq.netProfit.toLocaleString()}{' '}
                          {cur}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">إجمالي حقوق الملكية (Equity):</span>
                        <span className="font-mono font-black text-slate-900">
                          {eq.totalEquity.toLocaleString()} {cur}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-50">
                        <span className="text-slate-500 font-medium flex items-center gap-1">
                          <Wallet className="w-3 h-3 text-slate-400" />
                          السيولة النقدية بالصناديق:
                        </span>
                        <span className="font-mono font-bold text-blue-600">
                          {eq.availableLiquidity.toLocaleString()} {cur}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions per card */}
                  <div className="pt-3.5 mt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => openModal('addition', cur)}
                      className="flex-1 py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold transition-all text-center min-h-[34px] flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      <span>إضافة</span>
                    </button>
                    <button
                      onClick={() => openModal('withdrawal', cur)}
                      className="flex-1 py-1.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded-lg text-xs font-bold transition-all text-center min-h-[34px] flex items-center justify-center gap-1"
                    >
                      <Minus className="w-3 h-3" />
                      <span>سحب</span>
                    </button>
                  </div>
                </div>
              );
            })}
        </div>

        {/* TRANSACTIONS AUDIT LOG */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900">
                سجل حركات رأس المال والدفتر العام
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                توثيق كامل لكافة الإيداعات والمسحوبات ورقم القيد المحاسبي وحسابات الصناديق
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full self-start sm:self-auto">
              {filteredTransactions.length} حركة مطابقة
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
                placeholder="بحث بالوصف، الحساب، المستخدم، أو المبلغ..."
                className="w-full pr-9 pl-3 py-2 text-xs rounded-xl border border-slate-200 min-h-[42px] focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Type Filter */}
            <select
              value={historyTypeFilter}
              onChange={(e) => setHistoryTypeFilter(e.target.value as any)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 min-h-[42px] font-bold text-slate-700"
            >
              <option value="all">جميع أنواع الحركات</option>
              <option value="addition">إضافة رأس مال فقط (+)</option>
              <option value="withdrawal">سحب رأس مال فقط (-)</option>
            </select>

            {/* Currency Filter */}
            <select
              value={historyCurrencyFilter}
              onChange={(e) => setHistoryCurrencyFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 min-h-[42px] font-bold text-slate-700 font-mono"
            >
              <option value="all">جميع العملات</option>
              {availableCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Mobile Cards (< sm) */}
          <div className="sm:hidden divide-y divide-slate-100 -mx-4">
            {filteredTransactions.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">لا توجد حركات مسجلة تطابق التصفية</div>
            ) : (
              filteredTransactions.map((tx) => {
                const isAdd = tx.transactionType === 'addition' || tx.transactionType === 'initial_capital';

                return (
                  <div key={tx.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      {isAdd ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800">
                          <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                          <span>إضافة رأس مال</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800">
                          <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                          <span>سحب رأس مال</span>
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-slate-400">{tx.transactionDate}</span>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <span className="font-mono font-black text-lg text-slate-900">
                        {tx.amount.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{tx.currency}</span>
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        {tx.account?.name || 'خزينة النظام'}
                      </span>
                    </div>

                    {tx.description && (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-xl">
                        {tx.description}
                      </div>
                    )}

                    <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        بواسطة: <span className="font-semibold text-slate-700">{tx.createdBy}</span>
                      </span>
                      <span className="font-mono">
                        {new Date(tx.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
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
                  <th className="p-3">نوع الحركة</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">العملة</th>
                  <th className="p-3">الحساب المالي المرتبط</th>
                  <th className="p-3">الوصف والتفاصيل</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">المسؤول</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      لا توجد حركات مسجلة تطابق التصفية
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => {
                    const isAdd = tx.transactionType === 'addition' || tx.transactionType === 'initial_capital';

                    return (
                      <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3">
                          {isAdd ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800">
                              <Plus className="w-3.5 h-3.5 text-emerald-600" />
                              <span>إضافة رأس مال</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800">
                              <Minus className="w-3.5 h-3.5 text-rose-600" />
                              <span>سحب رأس مال</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono font-black text-slate-900 text-sm">
                          {tx.amount.toLocaleString()}
                        </td>
                        <td className="p-3 font-mono font-bold text-amber-700">{tx.currency}</td>
                        <td className="p-3 font-semibold text-slate-700">
                          {tx.account ? `${tx.account.name} (${tx.account.accountCode})` : 'خزينة نقدية'}
                        </td>
                        <td className="p-3 text-slate-600 max-w-xs truncate">{tx.description}</td>
                        <td className="p-3 font-mono text-slate-500">{tx.transactionDate}</td>
                        <td className="p-3 font-medium text-slate-700">{tx.createdBy}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL / BOTTOM SHEET */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 mb-4">
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    {transType === 'addition' ? 'إيداع وضخ رأس مال جديد' : 'سحب رأس مال / مسحوبات شخصية'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    ترحيل قيد يومية آلي مزدوج وضمان توازن دفتر الأستاذ
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

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Transaction Type Buttons */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">نوع الحركة</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTransType('addition')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all min-h-[44px] flex items-center justify-center gap-1.5 ${
                        transType === 'addition'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة رأس مال (+)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransType('withdrawal')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all min-h-[44px] flex items-center justify-center gap-1.5 ${
                        transType === 'withdrawal'
                          ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Minus className="w-4 h-4" />
                      <span>سحب رأس مال (-)</span>
                    </button>
                  </div>
                </div>

                {/* Target Safe/Bank Account */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {transType === 'addition' ? 'الصندوق / الحساب المستلم للمبلغ:' : 'الصندوق / الحساب المخصوم منه:'}
                  </label>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px] font-semibold"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — الرصيد: {Number(a.currentBalance).toLocaleString()} {a.currency} ({a.accountCode})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Associated Capital Account Indicator */}
                {selectedAccountDetails && (
                  <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
                    <span className="font-medium">الحساب المحاسبي المقابل لرأس المال:</span>
                    <span className="font-mono font-black text-amber-950">
                      {selectedAccountDetails.currency === 'EGP' ? '3010' : `3010-${selectedAccountDetails.currency}`}{' '}
                      ({selectedAccountDetails.currency})
                    </span>
                  </div>
                )}

                {/* Amount Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المبلغ المطلوب ({selectedAccountDetails?.currency || 'العملة'}):
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    placeholder="مثال: 50000"
                    className="w-full px-3 py-2.5 font-mono text-base font-black rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                  />
                </div>

                {/* Description Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    البيان / وصف الحركة (توثيق التدقيق):
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="مثال: ضخ سيولة إضافية من المالك لتوسيع نشاط الصرافة"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    disabled={submitting}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-50 min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`w-full sm:w-auto px-6 py-2.5 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md disabled:opacity-50 min-h-[44px] transition-all ${
                      transType === 'addition'
                        ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                        : 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20'
                    }`}
                  >
                    {submitting ? 'جاري الترحيل والحفظ...' : 'تأكيد وترحيل القيد'}
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
