'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Receipt,
  Plus,
  Search,
  Filter,
  DollarSign,
  Calendar,
  Building,
  RotateCcw,
  CheckCircle2,
  XCircle,
  FileText,
  AlertCircle,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ expensesByCurrency: {} });
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedCurrency, setSelectedCurrency] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Register Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Cancel Modal
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [expenseToCancel, setExpenseToCancel] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // View Ledger Modal
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [selectedExpenseForLedger, setSelectedExpenseForLedger] = useState<any | null>(null);

  const fetchExpenses = () => {
    setLoading(true);
    fetch('/api/v1/expenses')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setExpenses(data.data || []);
          if (data.summary) setSummary(data.summary);
        }
      })
      .catch((err) => console.error('Failed to fetch expenses:', err))
      .finally(() => setLoading(false));

    fetch('/api/v1/expenses/categories')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setCategories(data.data || []);
          if (data.data?.length > 0 && !categoryId) setCategoryId(data.data[0].id);
        }
      })
      .catch((err) => console.error('Failed to fetch categories:', err));

    fetch('/api/v1/accounts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const cashAccs = (data.data || []).filter(
            (a: any) =>
              ['cash_safe', 'bank', 'bankak', 'employee_custody'].includes(a.accountType) &&
              a.status === 'active' &&
              !['1060', '1065'].includes(a.accountCode)
          );
          setAccounts(cashAccs);
          if (cashAccs.length > 0 && !accountId) setAccountId(cashAccs[0].id);
        }
      })
      .catch((err) => console.error('Failed to fetch accounts:', err));
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  const selectedSafe = accounts.find((a) => a.id === accountId);
  const safeCurrency = selectedSafe?.currency || 'EGP';
  const safeAvailableBalance = Number(selectedSafe?.currentBalance || 0);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      setFormError('يرجى إدخال مبلغ صحيح أكبر من الصفر');
      return;
    }

    if (numAmount > safeAvailableBalance) {
      setFormError(
        `المبلغ المطلوب (${numAmount.toLocaleString()} ${safeCurrency}) يتجاوز رصيد الصندوق المتاح (${safeAvailableBalance.toLocaleString()} ${safeCurrency})`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          accountId,
          amount: numAmount,
          currency: safeCurrency,
          expenseDate,
          description,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل المصروف');
      }

      setModalOpen(false);
      setDescription('');
      setAmount('');
      fetchExpenses();
    } catch (err: any) {
      setFormError(err.message || 'خطأ أثناء تسجيل المصروف');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelExpense = async () => {
    if (!expenseToCancel) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/v1/expenses/${expenseToCancel.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إلغاء المصروف');
      }

      setCancelModalOpen(false);
      setExpenseToCancel(null);
      setCancelReason('');
      fetchExpenses();
    } catch (err: any) {
      alert(err.message || 'خطأ أثناء إلغاء المصروف');
    } finally {
      setCancelling(false);
    }
  };

  // Filtered expenses
  const filteredExpenses = expenses.filter((exp) => {
    if (selectedCurrency !== 'ALL' && exp.currency !== selectedCurrency) return false;
    if (selectedCategory !== 'ALL' && exp.categoryId !== selectedCategory) return false;
    if (selectedStatus !== 'ALL' && exp.status !== selectedStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNum = exp.expenseNumber?.toLowerCase().includes(q);
      const matchDesc = exp.description?.toLowerCase().includes(q);
      const matchCat = exp.category?.name?.toLowerCase().includes(q);
      const matchUser = exp.createdBy?.toLowerCase().includes(q);
      if (!matchNum && !matchDesc && !matchCat && !matchUser) return false;
    }
    return true;
  });

  const currenciesList = ['ALL', 'EGP', 'SDG', 'USD', 'SAR'];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
              <Receipt className="w-6 h-6 text-rose-600" />
              <span>إدارة المصروفات التشغيلية (Operating Expenses)</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              تسجيل وتبويب المصروفات حسب الحسابات (5xxx)، الخصم الذري من الصناديق، وإصدار القيود المزدوجة المتوازنة
            </p>
          </div>
          <button
            onClick={() => {
              setFormError('');
              setModalOpen(true);
            }}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-rose-500/20 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4 ml-1" />
            <span>تسجيل مصروف جديد</span>
          </button>
        </div>

        {/* Currency-Isolated Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <span className="text-xs font-bold text-slate-500 block mb-1">مصروفات الجنيه المصري (EGP)</span>
            <div className="text-xl sm:text-2xl font-black font-mono text-rose-700">
              {(summary?.expensesByCurrency?.['EGP'] || 0).toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">EGP</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-1">خصم معتمد من الخزائن المصرية</span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <span className="text-xs font-bold text-slate-500 block mb-1">مصروفات الجنيه السوداني (SDG)</span>
            <div className="text-xl sm:text-2xl font-black font-mono text-amber-700">
              {(summary?.expensesByCurrency?.['SDG'] || 0).toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">SDG</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-1">خصم معتمد من بنكك والخزائن السودانية</span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <span className="text-xs font-bold text-slate-500 block mb-1">مصروفات الدولار (USD)</span>
            <div className="text-xl sm:text-2xl font-black font-mono text-blue-700">
              {(summary?.expensesByCurrency?.['USD'] || 0).toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">USD</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-1">خصم معتمد من خزائن العملات الصعبة</span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <span className="text-xs font-bold text-slate-500 block mb-1">إجمالي العمليات المعتمدة</span>
            <div className="text-xl sm:text-2xl font-black font-mono text-slate-900">
              {summary?.approvedCount || 0}{' '}
              <span className="text-xs font-normal text-slate-400">عملية</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-1">
              {summary?.cancelledCount || 0} عملية ملغاة بقيد عكسي
            </span>
          </div>
        </div>

        {/* Currency Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
          {currenciesList.map((cur) => (
            <button
              key={cur}
              onClick={() => setSelectedCurrency(cur)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[40px] ${
                selectedCurrency === cur
                  ? 'bg-rose-600 text-white shadow-sm shadow-rose-500/20'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {cur === 'ALL' ? 'جميع العملات' : cur}
            </button>
          ))}
        </div>

        {/* Search & Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="بحث بالرقم أو الوصف أو المسؤول..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 min-h-[44px]"
              />
            </div>

            <div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 min-h-[44px]"
              >
                <option value="ALL">جميع التصنيفات</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 min-h-[44px]"
              >
                <option value="ALL">جميع الحالات</option>
                <option value="approved">معتمد ومخصوم</option>
                <option value="cancelled">ملغي ومسترد</option>
              </select>
            </div>
          </div>
        </div>

        {/* Expenses List */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">سجل المصروفات التشغيلية</h3>
            <span className="text-xs text-slate-400 font-mono font-bold">{filteredExpenses.length} عملية</span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-400 text-xs">جاري تحميل المصروفات...</div>
          ) : filteredExpenses.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">لا توجد مصروفات تطابق شروط البحث</div>
          ) : (
            <>
              {/* Mobile Cards (< sm) */}
              <div className="sm:hidden divide-y divide-slate-100 -mx-4">
                {filteredExpenses.map((exp) => {
                  const isApproved = exp.status === 'approved';
                  return (
                    <div key={exp.id} className="p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                          {exp.expenseNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {isApproved ? 'معتمد ومخصوم' : 'ملغي ومسترد'}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between">
                        <span className="font-bold text-sm text-slate-900">{exp.category?.name}</span>
                        <span
                          className={`font-mono font-black text-lg ${
                            isApproved ? 'text-rose-600' : 'text-slate-400 line-through'
                          }`}
                        >
                          {exp.amount.toLocaleString()}{' '}
                          <span className="text-xs font-normal text-slate-500">{exp.currency}</span>
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 flex items-center justify-between">
                        <span>الصندوق: {exp.account?.name || 'الخزينة النقدية'}</span>
                        <span className="font-mono">{exp.expenseDate}</span>
                      </div>

                      {exp.description && (
                        <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100">
                          {exp.description}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                        <button
                          onClick={() => {
                            setSelectedExpenseForLedger(exp);
                            setLedgerModalOpen(true);
                          }}
                          className="text-[11px] text-blue-600 font-bold hover:underline flex items-center gap-1"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>عرض القيد المحاسبي</span>
                        </button>

                        {isApproved && (
                          <button
                            onClick={() => {
                              setExpenseToCancel(exp);
                              setCancelReason('');
                              setCancelModalOpen(true);
                            }}
                            className="text-[11px] text-rose-600 font-bold hover:underline flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>إلغاء وعكس</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (sm+) */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">رقم المصروف</th>
                      <th className="p-3">التصنيف</th>
                      <th className="p-3">المبلغ والعملة</th>
                      <th className="p-3">الصندوق المدفوع منه</th>
                      <th className="p-3">البيان / الوصف</th>
                      <th className="p-3">التاريخ</th>
                      <th className="p-3">المسؤول</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredExpenses.map((exp) => {
                      const isApproved = exp.status === 'approved';
                      return (
                        <tr key={exp.id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono font-bold text-slate-900">{exp.expenseNumber}</td>
                          <td className="p-3 font-bold text-slate-900">{exp.category?.name}</td>
                          <td
                            className={`p-3 font-mono font-black text-sm ${
                              isApproved ? 'text-rose-600' : 'text-slate-400 line-through'
                            }`}
                          >
                            {exp.amount.toLocaleString()} {exp.currency}
                          </td>
                          <td className="p-3 text-slate-600">{exp.account?.name || 'الخزينة النقدية'}</td>
                          <td className="p-3 text-slate-600 max-w-xs truncate">{exp.description}</td>
                          <td className="p-3 font-mono text-slate-500">{exp.expenseDate}</td>
                          <td className="p-3 text-slate-600">{exp.createdBy}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {isApproved ? 'معتمد ومخصوم' : 'ملغي ومسترد'}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => {
                                  setSelectedExpenseForLedger(exp);
                                  setLedgerModalOpen(true);
                                }}
                                title="عرض القيد المحاسبي"
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 border border-blue-200 transition-all"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                              {isApproved && (
                                <button
                                  onClick={() => {
                                    setExpenseToCancel(exp);
                                    setCancelReason('');
                                    setCancelModalOpen(true);
                                  }}
                                  title="إلغاء وعكس المصروف"
                                  className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 transition-all"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* BOTTOM SHEET / MODAL: REGISTER EXPENSE */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                  <Plus className="w-5 h-5 text-rose-600" />
                  <span>تسجيل مصروف تشغيلي جديد</span>
                </h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {formError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleCreateExpense} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تصنيف المصروف</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[44px]"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الصندوق / الحساب المالي المخصوم منه
                  </label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[44px]"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — الرصيد المتاح: {Number(a.currentBalance).toLocaleString()} {a.currency}
                      </option>
                    ))}
                  </select>
                  {selectedSafe && (
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      سيتم إصدار القيد المحاسبي: مدين المصروفات (5010{safeCurrency === 'EGP' ? '' : `-${safeCurrency}`}) | دائن {selectedSafe.name}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      المبلغ ({safeCurrency})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      max={safeAvailableBalance}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                      placeholder={`أقصى حد: ${safeAvailableBalance.toLocaleString()}`}
                      className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الصرف</label>
                    <input
                      type="date"
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      required
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">البيان أو الوصف التفصيلي</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="مثال: فاتورة إيجار المقر لشهر نوفمبر"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[44px]"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-6 py-2.5 bg-rose-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-rose-700 shadow-md shadow-rose-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {submitting ? 'جاري الصرف والترحيل...' : 'تأكيد وصرف المصروف'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: CANCEL / REVERSE EXPENSE */}
        {cancelModalOpen && expenseToCancel && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-rose-700 text-base flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-rose-600" />
                  <span>إلغاء وعكس قيد المصروف</span>
                </h3>
                <button
                  onClick={() => setCancelModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-2xl mb-4 text-xs text-rose-900 space-y-1.5">
                <p className="font-bold">تنبيه محاسبي رقابي:</p>
                <p>
                  سيتم إنشاء قيد محاسبي عكسي آلياً، يتم بموجبه <strong>رد مبلغ {expenseToCancel.amount.toLocaleString()} {expenseToCancel.currency}</strong> إلى حساب الصندوق وتخفيض حساب المصروفات. القيد الأصلي سيبقى محفوظاً في السجل التاريخي دون حذف.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سبب الإلغاء (إلزامي للتدقيق)</label>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    required
                    placeholder="مثال: تسجيل مكرر أو تراجع في الفاتورة"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500 min-h-[44px]"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCancelModalOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    تراجع
                  </button>
                  <button
                    type="button"
                    disabled={cancelling || !cancelReason.trim()}
                    onClick={handleCancelExpense}
                    className="w-full sm:w-auto px-6 py-2.5 bg-rose-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-rose-700 shadow-md shadow-rose-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {cancelling ? 'جاري العكس...' : 'تأكيد الإلغاء ورد المبلغ'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: VIEW ACCOUNTING LEDGER ENTRY */}
        {ledgerModalOpen && selectedExpenseForLedger && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span>القيود المحاسبية للمصروف: {selectedExpenseForLedger.expenseNumber}</span>
                </h3>
                <button
                  onClick={() => setLedgerModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {selectedExpenseForLedger.ledgerEntries?.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs">
                    لا يوجد قيد محاسبي مفصل مرتبط بهذا المصروف
                  </div>
                ) : (
                  selectedExpenseForLedger.ledgerEntries.map((entry: any) => (
                    <div key={entry.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-3">
                      <div className="flex items-center justify-between text-xs border-b border-slate-200 pb-2">
                        <span className="font-mono font-bold text-slate-900">{entry.entryNumber}</span>
                        <span className="font-bold text-slate-500">{entry.entryType}</span>
                        <span className="font-mono text-slate-400">{entry.entryDate}</span>
                      </div>

                      <div className="space-y-2">
                        {entry.lines?.map((line: any) => (
                          <div
                            key={line.id}
                            className="flex items-center justify-between text-xs bg-white p-2.5 rounded-xl border border-slate-100"
                          >
                            <div>
                              <span className="font-bold block text-slate-800">{line.description}</span>
                              <span className="text-[10px] text-slate-400 font-mono">حساب: {line.accountId}</span>
                            </div>
                            <div className="text-left font-mono">
                              {Number(line.debit) > 0 && (
                                <span className="font-bold text-blue-600 block">
                                  مدين: {Number(line.debit).toLocaleString()} {line.currency}
                                </span>
                              )}
                              {Number(line.credit) > 0 && (
                                <span className="font-bold text-emerald-600 block">
                                  دائن: {Number(line.credit).toLocaleString()} {line.currency}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setLedgerModalOpen(false)}
                    className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 min-h-[44px]"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
