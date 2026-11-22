'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Wallet,
  Plus,
  ArrowLeftRight,
  Search,
  DollarSign,
  Building,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Scale,
  ShieldCheck,
  History,
  Layers,
  Edit2,
  Trash2,
  UserCheck,
  UserX,
  Lock,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  FileCheck,
} from 'lucide-react';

export default function AccountsPage() {
  const [activeTab, setActiveTab] = useState<'accounts' | 'transfer' | 'history' | 'reconciliation'>('accounts');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [currencySummary, setCurrencySummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // New Account Modal State
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [accName, setAccName] = useState('');
  const [accCode, setAccCode] = useState('');
  const [accType, setAccType] = useState('cash_safe');
  const [accCurrency, setAccCurrency] = useState('EGP');
  const [accParentId, setAccParentId] = useState('');
  const [accDescription, setAccDescription] = useState('');
  const [openingBalance, setOpeningBalance] = useState<number | string>(0);
  const [savingAccount, setSavingAccount] = useState(false);

  // Edit Account Modal State
  const [editAccountOpen, setEditAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editParentId, setEditParentId] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [updatingAccount, setUpdatingAccount] = useState(false);

  // Transfer Modal State
  const [transferOpen, setTransferOpen] = useState(false);
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [transferAmount, setTransferAmount] = useState<number | string>(50000);
  const [toAmount, setToAmount] = useState<number | string>('');
  const [exchangeRate, setExchangeRate] = useState<number | string>('');
  const [transferDesc, setTransferDesc] = useState('');
  const [transferFee, setTransferFee] = useState<number | string>(0);
  const [transferring, setTransferring] = useState(false);

  // UI Error Banner
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchAccountsAndTransfers = async () => {
    setLoading(true);
    try {
      const [accRes, trfRes] = await Promise.all([
        fetch('/api/v1/accounts'),
        fetch('/api/v1/accounts/transfers'),
      ]);

      const [accData, trfData] = await Promise.all([accRes.json(), trfRes.json()]);

      if (accData.success) {
        setAccounts(accData.data || []);
        setCurrencySummary(accData.summaryByCurrency || []);
        if (accData.data?.length > 1 && !fromAccountId) {
          const firstActive = accData.data.find((a: any) => a.status === 'active') || accData.data[0];
          const secondActive = accData.data.find((a: any) => a.status === 'active' && a.id !== firstActive.id) || accData.data[1];
          setFromAccountId(firstActive?.id || '');
          setToAccountId(secondActive?.id || '');
        }
      }

      if (trfData.success) {
        setTransfers(trfData.data || []);
      }
    } catch (err: any) {
      console.error('Error fetching accounts/transfers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccountsAndTransfers();
  }, []);

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (typeFilter !== 'all' && a.accountType !== typeFilter) return false;
      if (currencyFilter !== 'all' && a.currency !== currencyFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          a.accountCode.toLowerCase().includes(q) ||
          a.currency.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [accounts, typeFilter, currencyFilter, statusFilter, searchQuery]);

  // Selected Accounts for Transfer
  const selectedFromAcc = useMemo(() => accounts.find((a) => a.id === fromAccountId) || null, [accounts, fromAccountId]);
  const selectedToAcc = useMemo(() => accounts.find((a) => a.id === toAccountId) || null, [accounts, toAccountId]);
  const isCrossCurrencyTransfer = useMemo(() => {
    if (!selectedFromAcc || !selectedToAcc) return false;
    return selectedFromAcc.currency !== selectedToAcc.currency;
  }, [selectedFromAcc, selectedToAcc]);

  // Validation on transfer amount
  const transferValidation = useMemo(() => {
    if (!selectedFromAcc) return { isValid: false, message: 'حدد الصندوق المصدر' };
    const numAmt = Number(transferAmount || 0);
    const available = Number(selectedFromAcc.currentBalance || 0);
    if (numAmt <= 0) return { isValid: false, message: 'أدخل مبلغاً أكبر من صفر' };
    if (numAmt > available) return { isValid: false, message: `المبلغ المطلوب يتجاوز الرصيد المتاح (${available.toLocaleString()} ${selectedFromAcc.currency})` };
    if (fromAccountId === toAccountId) return { isValid: false, message: 'لا يمكن التحويل لنفس الصندوق' };
    return { isValid: true, message: null };
  }, [selectedFromAcc, transferAmount, fromAccountId, toAccountId]);

  // Handle Create Account
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccount(true);
    setActionError(null);
    try {
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: accName,
          accountCode: accCode ? accCode.trim() : undefined,
          accountType: accType,
          currency: accCurrency,
          parentAccountId: accParentId || undefined,
          description: accDescription,
          openingBalance: Number(openingBalance || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إنشاء الحساب');
      }
      setNewAccountOpen(false);
      setAccName('');
      setAccCode('');
      setAccDescription('');
      setOpeningBalance(0);
      await fetchAccountsAndTransfers();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSavingAccount(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (acc: any) => {
    setEditingAccount(acc);
    setEditName(acc.name);
    setEditDescription(acc.description || '');
    setEditParentId(acc.parentAccountId || '');
    setEditStatus(acc.status);
    setActionError(null);
    setEditAccountOpen(true);
  };

  // Handle Update Account
  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    setUpdatingAccount(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/accounts/${editingAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          parentAccountId: editParentId || null,
          status: editStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تعديل بيانات الحساب');
      }
      setEditAccountOpen(false);
      await fetchAccountsAndTransfers();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setUpdatingAccount(false);
    }
  };

  // Handle Toggle Status
  const handleToggleStatus = async (acc: any) => {
    const newStatus = acc.status === 'active' ? 'inactive' : 'active';
    const confirmMsg =
      newStatus === 'inactive'
        ? `هل أنت متأكد من تعطيل الحساب "${acc.name}"؟ لن تتمكن من التحويل منه أو إليه حتى تعيد تفعيله.`
        : `هل أنت متأكد من إعادة تفعيل الحساب "${acc.name}"؟`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/v1/accounts/${acc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تغيير حالة الحساب');
      }
      await fetchAccountsAndTransfers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle Delete Account
  const handleDeleteAccount = async (acc: any) => {
    const confirmMsg = `هل أنت متأكد من حذف الحساب "${acc.name}"؟\nملاحظة: إذا كان للحساب أي معاملات مالية مسجلة فسيتم رفض الحذف التزاماً بالمعايير المحاسبية.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/v1/accounts/${acc.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل حذف الحساب');
      }
      alert('تم حذف الحساب بنجاح');
      await fetchAccountsAndTransfers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle Transfer
  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    if (!transferValidation.isValid) {
      setActionError(transferValidation.message);
      return;
    }

    setTransferring(true);
    try {
      const payload: any = {
        fromAccountId,
        toAccountId,
        amount: Number(transferAmount),
        feeAmount: Number(transferFee || 0),
        description: transferDesc,
      };

      if (isCrossCurrencyTransfer) {
        if (toAmount) payload.toAmount = Number(toAmount);
        if (exchangeRate) payload.exchangeRate = Number(exchangeRate);
      }

      const res = await fetch('/api/v1/accounts/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل التحويل المالي');
      }

      setTransferOpen(false);
      setTransferDesc('');
      setToAmount('');
      setExchangeRate('');
      await fetchAccountsAndTransfers();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setTransferring(false);
    }
  };

  const openTransferModalFor = (accId: string) => {
    setFromAccountId(accId);
    const target = accounts.find((a) => a.id !== accId && a.status === 'active');
    if (target) setToAccountId(target.id);
    setActionError(null);
    setTransferOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-blue-500/10 text-blue-600 rounded-xl">
                <Wallet className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                  الصناديق والحسابات المالية (Chart of Accounts & Safes)
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  إدارة دليل الحسابات الموحد، الخزائن النقدية، حسابات بنكك، التحويلات البينية، ومطابقة الأرصدة
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setActionError(null);
                setTransferOpen(true);
              }}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/20 transition-all min-h-[44px]"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>تحويل بين الصناديق</span>
            </button>
            <button
              onClick={() => {
                setActionError(null);
                setNewAccountOpen(true);
              }}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة حساب / صندوق</span>
            </button>
            <button
              onClick={fetchAccountsAndTransfers}
              disabled={loading}
              title="تحديث البيانات"
              className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Global Currency Liquidity KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {currencySummary.map((cur) => (
            <div key={cur.currency} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-bold">السيولة النقدية ({cur.currency})</span>
                <span className="p-1 bg-blue-50 text-blue-600 rounded-md">
                  <Coins className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="text-lg sm:text-xl font-black font-mono text-slate-900">
                {Number(cur.totalLiquidBalance).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                في {cur.accountCount} خزائن وحسابات نشطة
              </div>
            </div>
          ))}
          {currencySummary.length === 0 && (
            <div className="col-span-full text-center py-2 text-slate-400 text-xs">
              جاري احتساب إجمالي السيولة النقدية حسب العملات...
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto no-scrollbar gap-1 text-xs sm:text-sm font-bold">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'accounts'
                ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>دليل الصناديق والحسابات ({accounts.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('transfer')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'transfer'
                ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>التحويل المالي بين الصناديق</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-4 h-4" />
            <span>سجل التحويلات المالية ({transfers.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('reconciliation')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'reconciliation'
                ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>المطابقة المحاسبية مع اليومية (Reconciliation)</span>
          </button>
        </div>

        {/* TAB 1: CHART OF ACCOUNTS & SAFES */}
        {activeTab === 'accounts' && (
          <div className="space-y-4">
            {/* Search and Filters Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm text-xs">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث باسم الصندوق، الكود (1010...)، أو العملة..."
                  className="w-full pl-3 pr-9 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                >
                  <option value="all">جميع الأنواع</option>
                  <option value="cash_safe">صندوق نقدي (Cash Safe)</option>
                  <option value="bank">حساب بنكي (Bank Account)</option>
                  <option value="bankak">حساب بنكك (Bankak)</option>
                  <option value="capital">رأس المال (Capital)</option>
                  <option value="clearing">وسيط تسوية عملات (Clearing)</option>
                  <option value="supplier_liability">التزامات موردين</option>
                  <option value="customer_liability">التزامات عملاء</option>
                  <option value="profit_loss">أرباح وخسائر (Profit/Loss)</option>
                  <option value="expense">مصروفات (Expense)</option>
                </select>

                <select
                  value={currencyFilter}
                  onChange={(e) => setCurrencyFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                >
                  <option value="all">جميع العملات</option>
                  <option value="EGP">EGP (مصري)</option>
                  <option value="SDG">SDG (سوداني)</option>
                  <option value="USD">USD (دولار)</option>
                  <option value="SAR">SAR (سعودي)</option>
                  <option value="AED">AED (إماراتي)</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                >
                  <option value="all">جميع الحالات</option>
                  <option value="active">نشط</option>
                  <option value="inactive">معطل</option>
                </select>
              </div>
            </div>

            {/* Accounts Mobile Cards (< lg) */}
            <div className="lg:hidden space-y-3">
              {filteredAccounts.map((a) => (
                <div
                  key={a.id}
                  className={`bg-white rounded-2xl border p-4 shadow-sm space-y-3 ${
                    a.status === 'active' ? 'border-slate-200' : 'border-rose-200 bg-rose-50/20 opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                        {a.accountCode}
                      </span>
                      {a.isSystem && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                          <Lock className="w-2.5 h-2.5" />
                          <span>نظامي</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {a.isReconciled ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>مطابق</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" />
                          <span>فارق</span>
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          a.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {a.status === 'active' ? 'نشط' : 'معطل'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-black text-base text-slate-900">{a.name}</h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">{a.accountType}</span>
                      <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                        {a.currency}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block">الرصيد الفعلي الحالي</span>
                      <span className="font-mono font-black text-base text-slate-900">
                        {Number(a.currentBalance).toLocaleString()}
                      </span>
                      <span className="text-[10px] text-slate-400 mr-1">{a.currency}</span>
                    </div>
                    <div className="text-left font-mono text-[11px] text-slate-500">
                      <span>افتتاحي: {Number(a.openingBalance).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEdit(a)}
                        title="تعديل الحساب"
                        className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {!a.isSystem && (
                        <button
                          onClick={() => handleToggleStatus(a)}
                          title={a.status === 'active' ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                          className={`p-2 rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center ${
                            a.status === 'active' ? 'text-rose-500 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          {a.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                      )}
                      {!a.isSystem && (
                        <button
                          onClick={() => handleDeleteAccount(a)}
                          title="حذف الحساب"
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 min-h-[36px] min-w-[36px] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {['cash_safe', 'bank', 'bankak'].includes(a.accountType) && a.status === 'active' && (
                      <button
                        onClick={() => openTransferModalFor(a.id)}
                        className="text-blue-600 hover:text-blue-700 font-bold px-2 py-1 rounded hover:bg-blue-50 flex items-center gap-1"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>تحويل منه</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {filteredAccounts.length === 0 && (
                <div className="text-center py-12 text-slate-400 text-sm">لا توجد حسابات مطابقة للبحث</div>
              )}
            </div>

            {/* Desktop Table (hidden on mobile, visible on lg) */}
            <div className="hidden lg:block bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">كود الحساب</th>
                      <th className="p-3.5">اسم الصندوق / الحساب</th>
                      <th className="p-3.5">نوع الحساب</th>
                      <th className="p-3.5">العملة</th>
                      <th className="p-3.5">الرصيد الافتتاحي</th>
                      <th className="p-3.5">إجمالي المدين</th>
                      <th className="p-3.5">إجمالي الدائن</th>
                      <th className="p-3.5">الرصيد الفعلي الحالي</th>
                      <th className="p-3.5">المطابقة</th>
                      <th className="p-3.5">الحالة</th>
                      <th className="p-3.5 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredAccounts.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5 font-mono font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{a.accountCode}</span>
                          {a.isSystem && (
                            <span title="حساب نظامي أساسي" className="text-amber-600">
                              <Lock className="w-3 h-3" />
                            </span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span className="font-bold text-slate-900 block">{a.name}</span>
                          {a.description && <span className="text-[11px] text-slate-400">{a.description}</span>}
                        </td>
                        <td className="p-3.5 text-slate-600">{a.accountType}</td>
                        <td className="p-3.5 font-mono font-bold text-blue-700">{a.currency}</td>
                        <td className="p-3.5 font-mono text-slate-500">{Number(a.openingBalance).toLocaleString()}</td>
                        <td className="p-3.5 font-mono text-emerald-600">{Number(a.totalDebit).toLocaleString()}</td>
                        <td className="p-3.5 font-mono text-rose-600">{Number(a.totalCredit).toLocaleString()}</td>
                        <td className="p-3.5 font-mono font-black text-slate-900 text-sm">
                          {Number(a.currentBalance).toLocaleString()} <span className="text-[10px] text-slate-400">{a.currency}</span>
                        </td>
                        <td className="p-3.5">
                          {a.isReconciled ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>100% مطابق</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
                              <AlertTriangle className="w-3 h-3" />
                              <span>فارق</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                              a.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {a.status === 'active' ? 'نشط' : 'معطل'}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center justify-center gap-1">
                            {['cash_safe', 'bank', 'bankak'].includes(a.accountType) && a.status === 'active' && (
                              <button
                                onClick={() => openTransferModalFor(a.id)}
                                title="تحويل مالي من هذا الصندوق"
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
                              >
                                <ArrowLeftRight className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenEdit(a)}
                              title="تعديل بيانات الحساب"
                              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {!a.isSystem && (
                              <button
                                onClick={() => handleToggleStatus(a)}
                                title={a.status === 'active' ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                                className={`p-1.5 rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center ${
                                  a.status === 'active' ? 'text-rose-500 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50'
                                }`}
                              >
                                {a.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                              </button>
                            )}
                            {!a.isSystem && (
                              <button
                                onClick={() => handleDeleteAccount(a)}
                                title="حذف الحساب"
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredAccounts.length === 0 && (
                      <tr>
                        <td colSpan={11} className="text-center py-10 text-slate-400">
                          لا توجد حسابات مطابقة لمعايير البحث
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FUND TRANSFER WORKBENCH */}
        {activeTab === 'transfer' && (
          <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-slate-200 p-5 sm:p-7 shadow-sm">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-5">
              <span className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
                <ArrowLeftRight className="w-6 h-6" />
              </span>
              <div>
                <h3 className="font-black text-slate-900 text-lg">التحويل المالي بين الصناديق والخزائن</h3>
                <p className="text-xs text-slate-500">
                  تحويل فوري ذري يضمن توازن القيود المحاسبية وتحديث الأرصدة اللحظية
                </p>
              </div>
            </div>

            {actionError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <form onSubmit={handleTransfer} className="space-y-4 text-xs sm:text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Source Account */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">من الصندوق (المحول منه) *</label>
                  <select
                    value={fromAccountId}
                    onChange={(e) => setFromAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {accounts
                      .filter((a) => ['cash_safe', 'bank', 'bankak'].includes(a.accountType) && a.status === 'active')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({Number(a.currentBalance).toLocaleString()} {a.currency})
                        </option>
                      ))}
                  </select>
                  {selectedFromAcc && (
                    <div className="mt-1 text-[11px] text-slate-500 font-mono">
                      الرصيد المتاح: {Number(selectedFromAcc.currentBalance).toLocaleString()} {selectedFromAcc.currency}
                    </div>
                  )}
                </div>

                {/* Destination Account */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">إلى الصندوق (المحول إليه) *</label>
                  <select
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {accounts
                      .filter((a) => a.id !== fromAccountId && a.status === 'active')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({Number(a.currentBalance).toLocaleString()} {a.currency})
                        </option>
                      ))}
                  </select>
                  {selectedToAcc && (
                    <div className="mt-1 text-[11px] text-slate-500 font-mono">
                      الرصيد الحالي: {Number(selectedToAcc.currentBalance).toLocaleString()} {selectedToAcc.currency}
                    </div>
                  )}
                </div>
              </div>

              {/* Amount & Fee */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المبلغ المراد تحويله ({selectedFromAcc?.currency || ''}) *
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    required
                    placeholder="50000"
                    className="w-full px-3 py-2.5 font-mono text-sm font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رسوم التحويل إن وجدت</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={transferFee}
                    onChange={(e) => setTransferFee(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2.5 font-mono text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>
              </div>

              {/* Cross-Currency Inputs (if currencies differ) */}
              {isCrossCurrencyTransfer && (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-3">
                  <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs">
                    <Coins className="w-4 h-4 text-amber-600" />
                    <span>تحويل متعدد العملات ({selectedFromAcc?.currency} &larr; {selectedToAcc?.currency})</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    نظراً لاختلاف عملة الصندوقين، يرجى إدخال سعر الصرف أو المبلغ المقابل الذي سيتم إيداعه في الصندوق المستهدف ليتم إنشاء قيود المقاصة بدقة.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-amber-950 mb-1">المبلغ المقابل المستلم ({selectedToAcc?.currency})</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={toAmount}
                        onChange={(e) => setToAmount(e.target.value)}
                        placeholder="المبلغ المقابل"
                        className="w-full px-3 py-2 font-mono text-xs rounded-xl border border-amber-300 focus:ring-2 focus:ring-amber-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-amber-950 mb-1">سعر التحويل / الصرف</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={exchangeRate}
                        onChange={(e) => setExchangeRate(e.target.value)}
                        placeholder="سعر الصرف"
                        className="w-full px-3 py-2 font-mono text-xs rounded-xl border border-amber-300 focus:ring-2 focus:ring-amber-500 bg-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">سبب التحويل أو الوصف</label>
                <input
                  type="text"
                  value={transferDesc}
                  onChange={(e) => setTransferDesc(e.target.value)}
                  placeholder="مثال: تغذية الخزينة النقدية أو تحويل لتسوية رصيد"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </div>

              {!transferValidation.isValid && (
                <div className="text-rose-600 font-bold text-xs">
                  {transferValidation.message}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={transferring || !transferValidation.isValid}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                >
                  {transferring ? 'جاري التحويل والترحيل...' : 'تأكيد وترحيل التحويل المالي'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: TRANSFER HISTORY LOG */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-sm sm:text-base text-slate-900">سجل التحويلات المالية بين الصناديق</h3>
              <span className="text-xs text-slate-400 font-mono font-bold">{transfers.length} تحويل مسجل</span>
            </div>

            {/* Mobile View */}
            <div className="lg:hidden divide-y divide-slate-100">
              {transfers.map((t) => (
                <div key={t.id} className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                      {t.transferNumber}
                    </span>
                    <span className="font-mono text-slate-400 text-[10px]">
                      {new Date(t.createdAt).toLocaleDateString('ar-EG')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-400 text-[10px] block">من الصندوق</span>
                      <span className="font-bold text-slate-900">{t.fromAccount?.name || 'غير معروف'}</span>
                    </div>
                    <span className="text-slate-400">&larr;</span>
                    <div className="text-left">
                      <span className="text-slate-400 text-[10px] block">إلى الصندوق</span>
                      <span className="font-bold text-blue-700">{t.toAccount?.name || 'غير معروف'}</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-xl flex items-center justify-between font-mono">
                    <div>
                      <span className="text-[10px] text-slate-400 block">المبلغ المحول</span>
                      <span className="font-black text-slate-900">
                        {Number(t.amount).toLocaleString()} {t.currency}
                      </span>
                    </div>
                    {t.toAmount && t.toCurrency !== t.currency && (
                      <div className="text-left">
                        <span className="text-[10px] text-slate-400 block">المقابل المستلم</span>
                        <span className="font-black text-blue-700">
                          {Number(t.toAmount).toLocaleString()} {t.toCurrency}
                        </span>
                      </div>
                    )}
                  </div>

                  {t.description && <div className="text-slate-500 text-[11px]">{t.description}</div>}
                </div>
              ))}
              {transfers.length === 0 && (
                <div className="text-center py-10 text-slate-400 text-sm">لا توجد تحويلات سابقة مسجلة</div>
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">رقم التحويل</th>
                    <th className="p-3.5">من الصندوق</th>
                    <th className="p-3.5">إلى الصندوق</th>
                    <th className="p-3.5">المبلغ المحول</th>
                    <th className="p-3.5">المقابل المستلم</th>
                    <th className="p-3.5">سعر الصرف</th>
                    <th className="p-3.5">المستخدم المنفذ</th>
                    <th className="p-3.5">التاريخ والوقت</th>
                    <th className="p-3.5">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {transfers.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-mono font-bold text-slate-900">{t.transferNumber}</td>
                      <td className="p-3.5 font-bold text-slate-900">{t.fromAccount?.name}</td>
                      <td className="p-3.5 font-bold text-blue-700">{t.toAccount?.name}</td>
                      <td className="p-3.5 font-mono font-black text-slate-900">
                        {Number(t.amount).toLocaleString()} {t.currency}
                      </td>
                      <td className="p-3.5 font-mono">
                        {t.toAmount ? `${Number(t.toAmount).toLocaleString()} ${t.toCurrency}` : '-'}
                      </td>
                      <td className="p-3.5 font-mono text-slate-500">
                        {t.exchangeRate && t.exchangeRate !== 1 ? t.exchangeRate : '-'}
                      </td>
                      <td className="p-3.5 text-slate-600">{t.createdBy}</td>
                      <td className="p-3.5 font-mono text-slate-500">
                        {new Date(t.createdAt).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          مكتمل ومرحل
                        </span>
                      </td>
                    </tr>
                  ))}
                  {transfers.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-10 text-slate-400">
                        لا توجد تحويلات مسجلة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: RECONCILIATION & AUDIT */}
        {activeTab === 'reconciliation' && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs text-emerald-950 flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <h4 className="font-bold text-emerald-900 text-sm">
                  مطابقة دليل الحسابات مع دفتر اليومية المركزي (General Ledger Reconciliation)
                </h4>
                <p className="mt-0.5 text-emerald-800 leading-relaxed">
                  يقوم هذا الفحص باحتساب الرصيد النظري التراكمي لكل حساب بناءً على:
                  <code className="bg-emerald-100 px-1 mx-1 font-mono">الرصيد الافتتاحي + إجمالي المدين - إجمالي الدائن</code>
                  ومقارنته بالرصيد المسجل لحظياً للتأكد من عدم وجود أي فروقات أو تلاعب بالدفاتر.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">كود الحساب</th>
                      <th className="p-3.5">اسم الحساب</th>
                      <th className="p-3.5">العملة</th>
                      <th className="p-3.5">الرصيد الافتتاحي</th>
                      <th className="p-3.5">إجمالي المدين</th>
                      <th className="p-3.5">إجمالي الدائن</th>
                      <th className="p-3.5">الرصيد المحسوب من اليومية</th>
                      <th className="p-3.5">الرصيد الفعلي الحالي</th>
                      <th className="p-3.5">الفارق</th>
                      <th className="p-3.5">حالة المطابقة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {accounts.map((a) => {
                      const diff = Math.abs(Number(a.currentBalance) - Number(a.calculatedLedgerBalance));
                      return (
                        <tr key={a.id} className="hover:bg-slate-50">
                          <td className="p-3.5 font-mono font-bold text-slate-900">{a.accountCode}</td>
                          <td className="p-3.5 font-bold text-slate-900">{a.name}</td>
                          <td className="p-3.5 font-mono font-bold text-blue-700">{a.currency}</td>
                          <td className="p-3.5 font-mono">{Number(a.openingBalance).toLocaleString()}</td>
                          <td className="p-3.5 font-mono text-emerald-600">{Number(a.totalDebit).toLocaleString()}</td>
                          <td className="p-3.5 font-mono text-rose-600">{Number(a.totalCredit).toLocaleString()}</td>
                          <td className="p-3.5 font-mono font-bold text-slate-800">
                            {Number(a.calculatedLedgerBalance).toLocaleString()}
                          </td>
                          <td className="p-3.5 font-mono font-black text-slate-900">
                            {Number(a.currentBalance).toLocaleString()}
                          </td>
                          <td className="p-3.5 font-mono">
                            {diff < 0.01 ? (
                              <span className="text-slate-400">0.00</span>
                            ) : (
                              <span className="text-rose-600 font-bold">{diff.toFixed(2)}</span>
                            )}
                          </td>
                          <td className="p-3.5">
                            {a.isReconciled ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>مطابق 100%</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>يوجد فارق دفتري</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* NEW ACCOUNT MODAL */}
        {newAccountOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إضافة صندوق أو حساب مالي جديد</h3>
                <button
                  onClick={() => setNewAccountOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {actionError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <form onSubmit={handleCreateAccount} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم الصندوق / الحساب *</label>
                  <input
                    type="text"
                    required
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    placeholder="مثال: خزينة فرع المهندسين"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">نوع الحساب *</label>
                    <select
                      value={accType}
                      onChange={(e) => setAccType(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                    >
                      <option value="cash_safe">صندوق نقدي (Cash Safe)</option>
                      <option value="bank">حساب بنكي (Bank Account)</option>
                      <option value="bankak">حساب بنكك (Bankak BOK)</option>
                      <option value="capital">رأس المال (Capital)</option>
                      <option value="expense">مصروفات (Expense)</option>
                      <option value="supplier_liability">التزامات موردين</option>
                      <option value="customer_liability">التزامات عملاء</option>
                      <option value="profit_loss">أرباح وخسائر (Profit/Loss)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة *</label>
                    <select
                      value={accCurrency}
                      onChange={(e) => setAccCurrency(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 font-bold min-h-[44px]"
                    >
                      <option value="EGP">جنيه مصري (EGP)</option>
                      <option value="SDG">جنيه سوداني (SDG)</option>
                      <option value="USD">دولار أمريكي (USD)</option>
                      <option value="SAR">ريال سعودي (SAR)</option>
                      <option value="AED">درهم إماراتي (AED)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      كود الحساب (اختياري - يُولد تلقائياً)
                    </label>
                    <input
                      type="text"
                      value={accCode}
                      onChange={(e) => setAccCode(e.target.value)}
                      placeholder="توليد تلقائي (مثل 1050)"
                      className="w-full px-3 py-2.5 font-mono text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الحساب الأب (Hierarchy)</label>
                    <select
                      value={accParentId}
                      onChange={(e) => setAccParentId(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                    >
                      <option value="">بدون حساب أب (حساب رئيسي)</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.accountCode} - {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الرصيد الافتتاحي</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2.5 font-mono text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                  />
                  {Number(openingBalance) > 0 && (
                    <div className="mt-1 text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg">
                      سيتم تسجيل الرصيد الافتتاحي تلقائياً عبر قيد محاسبي مزدوج ومتوازن مقابل حساب رأس المال (3010) لضمان نزاهة الدفاتر.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الوصف أو ملاحظات</label>
                  <input
                    type="text"
                    value={accDescription}
                    onChange={(e) => setAccDescription(e.target.value)}
                    placeholder="وصف مختصر للغرض من الصندوق أو الحساب..."
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setNewAccountOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={savingAccount}
                    className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-50 min-h-[44px]"
                  >
                    {savingAccount ? 'جاري الحفظ والترحيل...' : 'حفظ وإنشاء الحساب'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* EDIT ACCOUNT MODAL */}
        {editAccountOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تعديل بيانات الحساب المالي</h3>
                <button
                  onClick={() => setEditAccountOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {actionError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <form onSubmit={handleUpdateAccount} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم الحساب *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الحالة</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                  >
                    <option value="active">نشط (Active)</option>
                    <option value="inactive">معطل (Inactive)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الحساب الأب</label>
                  <select
                    value={editParentId}
                    onChange={(e) => setEditParentId(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                  >
                    <option value="">بدون حساب أب</option>
                    {accounts
                      .filter((a) => a.id !== editingAccount?.id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.accountCode} - {a.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الوصف أو ملاحظات</label>
                  <textarea
                    rows={2}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditAccountOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={updatingAccount}
                    className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-50 min-h-[44px]"
                  >
                    {updatingAccount ? 'جاري التعديل...' : 'تحديث البيانات'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* QUICK TRANSFER BOTTOM SHEET / MODAL */}
        {transferOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تحويل مالي بين الصناديق والحسابات</h3>
                <button
                  onClick={() => setTransferOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {actionError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <form onSubmit={handleTransfer} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">من الصندوق (المحول منه) *</label>
                  <select
                    value={fromAccountId}
                    onChange={(e) => setFromAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {accounts
                      .filter((a) => ['cash_safe', 'bank', 'bankak'].includes(a.accountType) && a.status === 'active')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({Number(a.currentBalance).toLocaleString()} {a.currency})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">إلى الصندوق (المحول إليه) *</label>
                  <select
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {accounts
                      .filter((a) => a.id !== fromAccountId && a.status === 'active')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({Number(a.currentBalance).toLocaleString()} {a.currency})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المبلغ المراد تحويله ({selectedFromAcc?.currency || ''}) *
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    required
                    placeholder="50000"
                    className="w-full px-3 py-2.5 font-mono text-xs sm:text-sm font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                {isCrossCurrencyTransfer && (
                  <div className="p-3 bg-amber-50 rounded-xl space-y-2 border border-amber-200 text-xs">
                    <span className="font-bold text-amber-900 block">
                      تحويل عملات ({selectedFromAcc?.currency} &larr; {selectedToAcc?.currency})
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        placeholder="المبلغ المقابل"
                        value={toAmount}
                        onChange={(e) => setToAmount(e.target.value)}
                        className="p-2 border rounded-lg bg-white"
                      />
                      <input
                        type="number"
                        placeholder="سعر الصرف"
                        value={exchangeRate}
                        onChange={(e) => setExchangeRate(e.target.value)}
                        className="p-2 border rounded-lg bg-white"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سبب التحويل أو الوصف</label>
                  <input
                    type="text"
                    value={transferDesc}
                    onChange={(e) => setTransferDesc(e.target.value)}
                    placeholder="مثال: تغذية الخزينة أو تسوية رصيد"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                {!transferValidation.isValid && (
                  <div className="text-rose-600 font-bold text-xs">
                    {transferValidation.message}
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setTransferOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={transferring || !transferValidation.isValid}
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {transferring ? 'جاري التحويل والترحيل...' : 'تأكيد التحويل المالي'}
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
