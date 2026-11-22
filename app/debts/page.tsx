'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Scale,
  Plus,
  DollarSign,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  FileText,
  Building,
  User,
  Users,
} from 'lucide-react';

export default function DebtsPage() {
  const [debts, setDebts] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    receivablesByCurrency: {},
    payablesByCurrency: {},
    netBalanceByCurrency: {},
  });
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedCurrency, setSelectedCurrency] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL'); // 'ALL' | 'receivable' | 'payable'
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // New Debt Modal
  const [newDebtOpen, setNewDebtOpen] = useState(false);
  const [debtType, setDebtType] = useState<'receivable' | 'payable'>('receivable');
  const [partyType, setPartyType] = useState('customer');
  const [partyName, setPartyName] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [originalAmount, setOriginalAmount] = useState<string>('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [fundingAccountId, setFundingAccountId] = useState('');
  const [savingDebt, setSavingDebt] = useState(false);
  const [formError, setFormError] = useState('');

  // Pay Debt Modal
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [activeDebt, setActiveDebt] = useState<any>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [payAmount, setPayAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [payReference, setPayReference] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  // View Details & Ledger Modal
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedDebtDetails, setSelectedDebtDetails] = useState<any | null>(null);

  const fetchDebts = () => {
    setLoading(true);
    fetch('/api/v1/debts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setDebts(data.data || []);
          if (data.summary) setSummary(data.summary);
        }
      })
      .catch((err) => console.error('Failed to fetch debts:', err))
      .finally(() => setLoading(false));

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
        }
      })
      .catch((err) => console.error('Failed to fetch accounts:', err));

    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setCustomers(data.data || []);
      })
      .catch(() => {});

    fetch('/api/v1/suppliers')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSuppliers(data.data || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchDebts();
  }, []);

  // Filtered debts
  const filteredDebts = debts.filter((d) => {
    if (selectedCurrency !== 'ALL' && d.currency !== selectedCurrency) return false;
    if (selectedType === 'receivable' && !d.isReceivable) return false;
    if (selectedType === 'payable' && !d.isPayable) return false;
    if (selectedStatus !== 'ALL') {
      if (selectedStatus === 'overdue' && !d.isOverdue) return false;
      if (selectedStatus !== 'overdue' && d.status !== selectedStatus) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNum = d.debtNumber?.toLowerCase().includes(q);
      const matchParty = d.partyName?.toLowerCase().includes(q);
      const matchDesc = d.description?.toLowerCase().includes(q);
      if (!matchNum && !matchParty && !matchDesc) return false;
    }
    return true;
  });

  const handleCreateDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const numAmt = Number(originalAmount);
    if (!numAmt || numAmt <= 0) {
      setFormError('يرجى إدخال مبلغ صحيح أكبر من الصفر');
      return;
    }

    if (!partyName.trim()) {
      setFormError('يرجى تحديد أو إدخال اسم الطرف المعني بالدين');
      return;
    }

    setSavingDebt(true);
    try {
      const res = await fetch('/api/v1/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtType,
          partyType,
          partyName: partyName.trim(),
          currency,
          originalAmount: numAmt,
          dueDate: dueDate || null,
          description,
          fundingAccountId: fundingAccountId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل الدين');
      }

      setNewDebtOpen(false);
      setPartyName('');
      setOriginalAmount('');
      setDescription('');
      setDueDate('');
      setFundingAccountId('');
      fetchDebts();
    } catch (err: any) {
      setFormError(err.message || 'خطأ أثناء تسجيل الدين');
    } finally {
      setSavingDebt(false);
    }
  };

  const handleOpenPayModal = (debt: any) => {
    setActiveDebt(debt);
    setPayError('');
    setPayAmount(debt.remainingAmount.toString());

    // Auto-select first matching safe by currency
    const matchingSafes = accounts.filter((a) => a.currency === debt.currency);
    if (matchingSafes.length > 0) {
      setPayAccountId(matchingSafes[0].id);
    } else {
      setPayAccountId('');
    }
    setPayModalOpen(true);
  };

  const handlePayDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDebt) return;
    setPayError('');

    const numAmt = Number(payAmount);
    if (!numAmt || numAmt <= 0) {
      setPayError('يرجى إدخال مبلغ سداد صحيح أكبر من الصفر');
      return;
    }

    if (numAmt > activeDebt.remainingAmount) {
      setPayError(`مبلغ السداد لا يمكن أن يتجاوز المتبقي (${activeDebt.remainingAmount.toLocaleString()} ${activeDebt.currency})`);
      return;
    }

    if (!payAccountId) {
      setPayError(`يرجى اختيار خزينة أو حساب بنكي بعملة (${activeDebt.currency})`);
      return;
    }

    setPaying(true);
    try {
      const res = await fetch(`/api/v1/debts/${activeDebt.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: payAccountId,
          amount: numAmt,
          paymentDate,
          reference: payReference,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل سداد الدين');
      }

      setPayModalOpen(false);
      setActiveDebt(null);
      setPayAmount('');
      setPayReference('');
      fetchDebts();
    } catch (err: any) {
      setPayError(err.message || 'خطأ أثناء تسجيل السداد');
    } finally {
      setPaying(false);
    }
  };

  const handleCancelDebt = async (debtId: string) => {
    const reason = prompt('يرجى إدخال سبب إلغاء الدين:');
    if (reason === null) return;

    try {
      const res = await fetch(`/api/v1/debts/${debtId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إلغاء الدين');
      }

      alert('تم إلغاء سجل الدين بنجاح');
      fetchDebts();
    } catch (err: any) {
      alert(err.message || 'خطأ أثناء إلغاء الدين');
    }
  };

  const handleViewDetails = async (debt: any) => {
    try {
      const res = await fetch(`/api/v1/debts/${debt.id}`);
      const data = await res.json();
      if (data.success) {
        setSelectedDebtDetails(data.data);
        setViewModalOpen(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const currenciesList = ['ALL', 'EGP', 'SDG', 'USD', 'SAR'];
  const matchingSafesForPay = activeDebt ? accounts.filter((a) => a.currency === activeDebt.currency) : [];
  const selectedSafeForPay = accounts.find((a) => a.id === payAccountId);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
              <Scale className="w-6 h-6 text-indigo-600" />
              <span>إدارة الديون والالتزامات (Receivables & Payables)</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              متابعة الذمم المدينة المستحقة للشركة، والالتزامات المستحقة علينا، وإدارة السداد المزدوج المتوازن
            </p>
          </div>
          <button
            onClick={() => {
              setFormError('');
              setNewDebtOpen(true);
            }}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4 ml-1" />
            <span>تسجيل مديونية / التزام جديد</span>
          </button>
        </div>

        {/* Currency-Isolated Financial Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Receivables Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                <span>الذمم المدينة المستحقة لنا (Receivables)</span>
              </span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                أصل متداول
              </span>
            </div>
            <div className="space-y-1.5 pt-1">
              {['EGP', 'SDG', 'USD'].map((cur) => {
                const amt = summary?.receivablesByCurrency?.[cur] || 0;
                return (
                  <div key={cur} className="flex items-baseline justify-between">
                    <span className="text-xs font-bold text-slate-400 font-mono">{cur}</span>
                    <span className="text-lg sm:text-xl font-black font-mono text-emerald-700">
                      {amt.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-400">{cur}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payables Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <ArrowUpRight className="w-4 h-4 text-rose-600" />
                <span>الالتزامات والديون علينا (Payables)</span>
              </span>
              <span className="text-[10px] bg-rose-50 text-rose-700 font-bold px-2 py-0.5 rounded-full">
                خصم متداول
              </span>
            </div>
            <div className="space-y-1.5 pt-1">
              {['EGP', 'SDG', 'USD'].map((cur) => {
                const amt = summary?.payablesByCurrency?.[cur] || 0;
                return (
                  <div key={cur} className="flex items-baseline justify-between">
                    <span className="text-xs font-bold text-slate-400 font-mono">{cur}</span>
                    <span className="text-lg sm:text-xl font-black font-mono text-rose-700">
                      {amt.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-400">{cur}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Net Balance Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <Scale className="w-4 h-4 text-indigo-600" />
                <span>صافي موقف الديون (Net Balance)</span>
              </span>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
                مدين - دائن
              </span>
            </div>
            <div className="space-y-1.5 pt-1">
              {['EGP', 'SDG', 'USD'].map((cur) => {
                const net = summary?.netBalanceByCurrency?.[cur] || 0;
                const isPositive = net >= 0;
                return (
                  <div key={cur} className="flex items-baseline justify-between">
                    <span className="text-xs font-bold text-slate-400 font-mono">{cur}</span>
                    <span
                      className={`text-lg sm:text-xl font-black font-mono ${
                        isPositive ? 'text-indigo-700' : 'text-amber-700'
                      }`}
                    >
                      {net.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-400">{cur}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Currency Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
          {currenciesList.map((cur) => (
            <button
              key={cur}
              onClick={() => setSelectedCurrency(cur)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[40px] ${
                selectedCurrency === cur
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {cur === 'ALL' ? 'جميع العملات' : cur}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="بحث برقم الدين، اسم الطرف..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
              />
            </div>

            <div>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
              >
                <option value="ALL">جميع الأنواع (لنا وعلينا)</option>
                <option value="receivable">ديون مستحقة لنا (Receivables)</option>
                <option value="payable">التزامات مستحقة علينا (Payables)</option>
              </select>
            </div>

            <div>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
              >
                <option value="ALL">جميع الحالات</option>
                <option value="outstanding">مستحق بالكامل</option>
                <option value="partially_paid">مدفوع جزئياً</option>
                <option value="paid">مسدد بالكامل</option>
                <option value="overdue">متأخر عن موعد الاستحقاق</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>

            <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
              <span className="text-slate-500">النتائج المطابقة:</span>
              <span className="font-mono font-bold text-slate-800">{filteredDebts.length} دين</span>
            </div>
          </div>
        </div>

        {/* Debts Table & Cards */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">سجل الديون والالتزامات</h3>
            <span className="text-xs text-slate-400 font-mono font-bold">{filteredDebts.length} قيد</span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-400 text-xs">جاري تحميل سجلات الديون...</div>
          ) : filteredDebts.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">لا توجد ديون مطابقة لشروط البحث</div>
          ) : (
            <>
              {/* Mobile Cards (< lg) */}
              <div className="lg:hidden divide-y divide-slate-100 -mx-4">
                {filteredDebts.map((d) => {
                  const isRec = d.isReceivable;
                  const isPaid = d.status === 'paid';
                  const isCancelled = d.status === 'cancelled';

                  return (
                    <div key={d.id} className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                            {d.debtNumber}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isRec ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {isRec ? 'دين لنا' : 'التزام علينا'}
                          </span>
                        </div>

                        <div>
                          {isCancelled ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                              ملغي
                            </span>
                          ) : isPaid ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              مسدد بالكامل
                            </span>
                          ) : d.status === 'partially_paid' ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              مدفوع جزئياً
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                              مستحق
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between">
                        <div>
                          <span className="font-bold text-sm text-slate-900 block">{d.partyName}</span>
                          <span className="text-[11px] text-slate-400">النوع: {d.partyType}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">{d.debtDate}</span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-xs text-center border border-slate-100">
                        <div>
                          <span className="text-[10px] text-slate-400 block">المبلغ الأصلي</span>
                          <span className="font-mono font-bold text-slate-700">
                            {d.originalAmount.toLocaleString()} {d.currency}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">المسدد</span>
                          <span className="font-mono font-bold text-emerald-600">
                            {d.paidAmount.toLocaleString()} {d.currency}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">المتبقي</span>
                          <span
                            className={`font-mono font-black ${
                              isCancelled ? 'text-slate-400 line-through' : 'text-rose-600'
                            }`}
                          >
                            {d.remainingAmount.toLocaleString()} {d.currency}
                          </span>
                        </div>
                      </div>

                      {d.isOverdue && !isPaid && !isCancelled && (
                        <div className="text-[11px] text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg flex items-center gap-1 font-bold">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>متأخر عن موعد الاستحقاق ({d.dueDate})</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <button
                          onClick={() => handleViewDetails(d)}
                          className="text-[11px] text-blue-600 font-bold hover:underline flex items-center gap-1"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>التفاصيل والقيود</span>
                        </button>

                        {!isPaid && !isCancelled && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleOpenPayModal(d)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm ${
                                isRec ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                              }`}
                            >
                              {isRec ? 'تحصيل دفعة' : 'سداد دفعة'}
                            </button>
                            {d.paidAmount === 0 && (
                              <button
                                onClick={() => handleCancelDebt(d.id)}
                                className="text-[11px] text-slate-400 hover:text-rose-600"
                              >
                                إلغاء
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (lg+) */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">رقم الدين</th>
                      <th className="p-3">طبيعة الدين</th>
                      <th className="p-3">الطرف المعني</th>
                      <th className="p-3">العملة والمبلغ الأصلي</th>
                      <th className="p-3">المسدد</th>
                      <th className="p-3">المتبقي</th>
                      <th className="p-3">التاريخ</th>
                      <th className="p-3">الاستحقاق</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredDebts.map((d) => {
                      const isRec = d.isReceivable;
                      const isPaid = d.status === 'paid';
                      const isCancelled = d.status === 'cancelled';

                      return (
                        <tr key={d.id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono font-bold text-slate-900">{d.debtNumber}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isRec ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {isRec ? 'دين مستحق لنا' : 'التزام علينا'}
                            </span>
                          </td>
                          <td className="p-3 font-bold text-slate-900">{d.partyName}</td>
                          <td className="p-3 font-mono font-bold text-slate-900">
                            {d.originalAmount.toLocaleString()} {d.currency}
                          </td>
                          <td className="p-3 font-mono font-bold text-emerald-600">
                            {d.paidAmount.toLocaleString()} {d.currency}
                          </td>
                          <td
                            className={`p-3 font-mono font-black text-sm ${
                              isCancelled ? 'text-slate-400 line-through' : 'text-rose-600'
                            }`}
                          >
                            {d.remainingAmount.toLocaleString()} {d.currency}
                          </td>
                          <td className="p-3 font-mono text-slate-500">{d.debtDate}</td>
                          <td className="p-3 font-mono text-slate-500">
                            {d.dueDate || '—'}
                            {d.isOverdue && !isPaid && !isCancelled && (
                              <span className="text-[10px] text-amber-600 font-bold block">متأخر</span>
                            )}
                          </td>
                          <td className="p-3">
                            {isCancelled ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                                ملغي
                              </span>
                            ) : isPaid ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                مسدد بالكامل
                              </span>
                            ) : d.status === 'partially_paid' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                مدفوع جزئياً
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                مستحق
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleViewDetails(d)}
                                title="عرض التفاصيل والقيود"
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 border border-blue-200 transition-all"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>

                              {!isPaid && !isCancelled && (
                                <button
                                  onClick={() => handleOpenPayModal(d)}
                                  className={`px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm transition-all ${
                                    isRec
                                      ? 'bg-emerald-600 hover:bg-emerald-700'
                                      : 'bg-rose-600 hover:bg-rose-700'
                                  }`}
                                >
                                  {isRec ? 'تحصيل' : 'سداد'}
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

        {/* MODAL: REGISTER NEW DEBT */}
        {newDebtOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                  <Plus className="w-5 h-5 text-indigo-600" />
                  <span>تسجيل مديونية أو التزام جديد</span>
                </h3>
                <button
                  onClick={() => setNewDebtOpen(false)}
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

              <form onSubmit={handleCreateDebt} className="space-y-4">
                {/* Debt Type Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">طبيعة المعاملة المحاسبية</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDebtType('receivable')}
                      className={`p-3 rounded-xl border text-xs font-bold transition-all text-center ${
                        debtType === 'receivable'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <ArrowDownLeft className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
                      <span>دين مستحق لنا (Receivable)</span>
                      <span className="block text-[10px] text-slate-400 font-normal mt-0.5">أموال يلتزم بها الطرف لصالحنا</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDebtType('payable')}
                      className={`p-3 rounded-xl border text-xs font-bold transition-all text-center ${
                        debtType === 'payable'
                          ? 'border-rose-600 bg-rose-50 text-rose-900 ring-2 ring-rose-500'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <ArrowUpRight className="w-4 h-4 mx-auto mb-1 text-rose-600" />
                      <span>التزام مستحق علينا (Payable)</span>
                      <span className="block text-[10px] text-slate-400 font-normal mt-0.5">أموال نلتزم بها لصالح الطرف</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">نوع الطرف المعني</label>
                    <select
                      value={partyType}
                      onChange={(e) => {
                        setPartyType(e.target.value);
                        setPartyName('');
                      }}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    >
                      <option value="customer">عميل (Customer)</option>
                      <option value="supplier">مورد (Supplier)</option>
                      <option value="employee">موظف (Employee)</option>
                      <option value="other">طرف آخر (Other)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الطرف المعني</label>
                    {partyType === 'customer' && customers.length > 0 ? (
                      <select
                        value={partyName}
                        onChange={(e) => setPartyName(e.target.value)}
                        className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                      >
                        <option value="">اختر العميل...</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name} ({c.phone || c.customerCode})
                          </option>
                        ))}
                      </select>
                    ) : partyType === 'supplier' && suppliers.length > 0 ? (
                      <select
                        value={partyName}
                        onChange={(e) => setPartyName(e.target.value)}
                        className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                      >
                        <option value="">اختر المورد...</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name} ({s.supplierCode})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="اسم الطرف المعني بالدين..."
                        value={partyName}
                        onChange={(e) => setPartyName(e.target.value)}
                        required
                        className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    >
                      <option value="EGP">جنيه مصري (EGP)</option>
                      <option value="SDG">جنيه سوداني (SDG)</option>
                      <option value="USD">دولار أمريكي (USD)</option>
                      <option value="SAR">ريال سعودي (SAR)</option>
                      <option value="AED">درهم إماراتي (AED)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ ({currency})</label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={originalAmount}
                      onChange={(e) => setOriginalAmount(e.target.value)}
                      required
                      placeholder="10000"
                      className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الاستحقاق (اختياري)</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">البيان أو الوصف</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="مثال: دين تجاري مقابل توريد مؤجل"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setNewDebtOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={savingDebt}
                    className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-indigo-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {savingDebt ? 'جاري التسجيل...' : 'تأكيد وحفظ الدين'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: PAY / COLLECT DEBT */}
        {payModalOpen && activeDebt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                  {activeDebt.isReceivable ? (
                    <>
                      <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
                      <span>تحصيل دفعة دين مستحق لنا</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-5 h-5 text-rose-600" />
                      <span>سداد دفعة التزام مستحق علينا</span>
                    </>
                  )}
                </h3>
                <button
                  onClick={() => setPayModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {payError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{payError}</span>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl mb-4 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">الطرف:</span>
                  <span className="font-bold text-slate-800">{activeDebt.partyName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">المبلغ الأصلي:</span>
                  <span className="font-mono font-bold text-slate-700">
                    {activeDebt.originalAmount.toLocaleString()} {activeDebt.currency}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1">
                  <span className="text-slate-500">المتبقي المطلوب:</span>
                  <span className="font-mono font-black text-rose-600">
                    {activeDebt.remainingAmount.toLocaleString()} {activeDebt.currency}
                  </span>
                </div>
              </div>

              <form onSubmit={handlePayDebt} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {activeDebt.isReceivable ? 'الخزينة المستلم فيها (إيداع)' : 'الخزينة المخصوم منها (صرف)'}
                  </label>
                  {matchingSafesForPay.length === 0 ? (
                    <div className="p-3 bg-amber-50 text-amber-800 text-xs rounded-xl border border-amber-200 font-bold">
                      لا توجد خزينة نشطة بعملة ({activeDebt.currency}) لتنفيذ حركة السداد
                    </div>
                  ) : (
                    <select
                      value={payAccountId}
                      onChange={(e) => setPayAccountId(e.target.value)}
                      required
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    >
                      {matchingSafesForPay.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — الرصيد: {Number(a.currentBalance).toLocaleString()} {a.currency}
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedSafeForPay && (
                    <span className="text-[11px] text-slate-400 block mt-1">
                      {activeDebt.isReceivable
                        ? `سيتم إيداع الكاش في: ${selectedSafeForPay.name}`
                        : `سيتم الخصم من: ${selectedSafeForPay.name} (المتاح: ${Number(selectedSafeForPay.currentBalance).toLocaleString()} ${selectedSafeForPay.currency})`}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      مبلغ الدفعة ({activeDebt.currency})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      max={activeDebt.remainingAmount}
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      required
                      className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ السداد</label>
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      required
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الإيصال / المرجع (اختياري)</label>
                  <input
                    type="text"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    placeholder="مثال: إيصال رقم 5542 أو تحويل بنكي"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPayModalOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={paying || matchingSafesForPay.length === 0}
                    className={`w-full sm:w-auto px-6 py-2.5 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md disabled:opacity-50 min-h-[44px] ${
                      activeDebt.isReceivable
                        ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                        : 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20'
                    }`}
                  >
                    {paying ? 'جاري ترحيل السداد...' : activeDebt.isReceivable ? 'تأكيد التحصيل والإيداع' : 'تأكيد السداد والخصم'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: VIEW DETAILS & PAYMENT HISTORY & LEDGER */}
        {viewModalOpen && selectedDebtDetails && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  <span>تفاصيل وسجل سداد: {selectedDebtDetails.debtNumber}</span>
                </h3>
                <button
                  onClick={() => setViewModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* Overview */}
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">طبيعة الدين:</span>
                    <span className="font-bold text-slate-900">
                      {selectedDebtDetails.isReceivable ? 'دين مستحق لنا (Receivable)' : 'التزام مستحق علينا (Payable)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">الطرف المعني:</span>
                    <span className="font-bold text-slate-900">{selectedDebtDetails.partyName} ({selectedDebtDetails.partyType})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">المبلغ الأصلي:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {selectedDebtDetails.originalAmount.toLocaleString()} {selectedDebtDetails.currency}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">إجمالي المسدد:</span>
                    <span className="font-mono font-bold text-emerald-600">
                      {selectedDebtDetails.paidAmount.toLocaleString()} {selectedDebtDetails.currency}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1 font-bold">
                    <span className="text-slate-700">المتبقي:</span>
                    <span className="font-mono text-rose-600">
                      {selectedDebtDetails.remainingAmount.toLocaleString()} {selectedDebtDetails.currency}
                    </span>
                  </div>
                </div>

                {/* Payment History */}
                <div>
                  <h4 className="font-bold text-xs text-slate-900 mb-2">سجل الدفعات المسددة ({selectedDebtDetails.payments?.length || 0})</h4>
                  {selectedDebtDetails.payments?.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-xs bg-slate-50 rounded-xl">
                      لم يتم تسجيل أي دفعات سداد لهذا الدين حتى الآن
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedDebtDetails.payments.map((p: any) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold block text-slate-900">
                              {p.amount.toLocaleString()} {p.currency}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {p.paymentDate} — {p.account?.name || 'الخزينة'}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-500">{p.reference || 'سداد معتمد'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Accounting Ledger Entries */}
                <div>
                  <h4 className="font-bold text-xs text-slate-900 mb-2">القيود المحاسبية المرحلة في الأستاذ العام</h4>
                  {selectedDebtDetails.ledgerEntries?.length === 0 ? (
                    <div className="text-center py-4 text-slate-400 text-xs bg-slate-50 rounded-xl">
                      لا توجد قيود يومية منشأة مع هذا الدين (دين تجاري مسجل سابقاً أو دين دفتري)
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedDebtDetails.ledgerEntries.map((entry: any) => (
                        <div key={entry.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                          <div className="flex justify-between font-mono font-bold border-b border-slate-200 pb-1">
                            <span>{entry.entryNumber}</span>
                            <span className="text-slate-500">{entry.entryType}</span>
                          </div>
                          <div className="space-y-1">
                            {entry.lines?.map((l: any) => (
                              <div key={l.id} className="flex justify-between text-[11px] bg-white p-1.5 rounded-lg border border-slate-100">
                                <span className="text-slate-700">{l.description}</span>
                                <span className="font-mono font-bold">
                                  {Number(l.debit) > 0 && <span className="text-blue-600">مدين: {Number(l.debit).toLocaleString()} {l.currency}</span>}
                                  {Number(l.credit) > 0 && <span className="text-emerald-600">دائن: {Number(l.credit).toLocaleString()} {l.currency}</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setViewModalOpen(false)}
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
