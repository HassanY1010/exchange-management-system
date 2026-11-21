'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Wallet,
  Plus,
  ArrowLeftRight,
  Search,
  DollarSign,
  Building,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Account Modal
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState('cash_safe');
  const [accCurrency, setAccCurrency] = useState('EGP');
  const [openingBalance, setOpeningBalance] = useState<number | string>(0);
  const [savingAccount, setSavingAccount] = useState(false);

  // Transfer Modal
  const [transferOpen, setTransferOpen] = useState(false);
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [transferAmount, setTransferAmount] = useState<number | string>(50000);
  const [transferDesc, setTransferDesc] = useState('');
  const [transferring, setTransferring] = useState(false);

  const fetchAccounts = () => {
    setLoading(true);
    fetch('/api/v1/accounts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setAccounts(data.data || []);
          if (data.data?.length > 1) {
            setFromAccountId(data.data[0].id);
            setToAccountId(data.data[1].id);
          }
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccount(true);
    try {
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: accName,
          accountType: accType,
          currency: accCurrency,
          openingBalance: Number(openingBalance),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إنشاء الحساب');
      }
      setNewAccountOpen(false);
      setAccName('');
      fetchAccounts();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingAccount(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferring(true);
    try {
      const res = await fetch('/api/v1/accounts/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAccountId,
          toAccountId,
          amount: Number(transferAmount),
          description: transferDesc,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل التحويل المالي');
      }
      setTransferOpen(false);
      setTransferDesc('');
      fetchAccounts();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setTransferring(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">الصناديق ودليل الحسابات المالية (Chart of Accounts)</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              إدارة الخزائن النقدية، حسابات بنكك، التحويلات البينية، ومتابعة الأرصدة اللحظية
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              onClick={() => setTransferOpen(true)}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>تحويل بين الصناديق</span>
            </button>
            <button
              onClick={() => setNewAccountOpen(true)}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صندوق / حساب مالي</span>
            </button>
          </div>
        </div>

        {/* Accounts List Section */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">قائمة الصناديق والحسابات المالية</h3>
            <span className="text-xs text-slate-400 font-mono font-bold">{accounts.length} حساب</span>
          </div>

          {/* Mobile Cards (< lg) */}
          <div className="lg:hidden divide-y divide-slate-100">
            {accounts.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">
                لا توجد حسابات مالية مسجلة
              </div>
            ) : (
              accounts.map((a) => (
                <div key={a.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      {a.accountCode}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      نشط
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-base text-slate-900">{a.name}</h4>
                      <span className="text-xs text-slate-500 mt-0.5 block">{a.accountType}</span>
                    </div>
                    <span className="font-mono font-black text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                      {a.currency}
                    </span>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">الرصيد الفعلي الحالي</span>
                      <span className="font-mono font-black text-base sm:text-lg text-slate-900">
                        {a.currentBalance?.toLocaleString() || 0}
                      </span>
                      <span className="text-xs text-slate-500 mr-1">{a.currency}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-[10px] text-slate-400 block">الرصيد الافتتاحي</span>
                      <span className="font-mono text-xs text-slate-600">
                        {a.openingBalance?.toLocaleString() || 0} {a.currency}
                      </span>
                    </div>
                  </div>

                  <div className="pt-1 flex items-center justify-end">
                    <button
                      onClick={() => {
                        setFromAccountId(a.id);
                        setTransferOpen(true);
                      }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 min-h-[36px]"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      <span>تحويل من هذا الصندوق</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Table (hidden on mobile, visible on lg) */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">كود الحساب</th>
                  <th className="p-3.5">اسم الصندوق / الحساب</th>
                  <th className="p-3.5">نوع الحساب</th>
                  <th className="p-3.5">العملة</th>
                  <th className="p-3.5">الرصيد الافتتاحي</th>
                  <th className="p-3.5">الرصيد الفعلي الحالي</th>
                  <th className="p-3.5">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 font-mono font-bold text-slate-900">{a.accountCode}</td>
                    <td className="p-3.5 font-bold text-slate-900">{a.name}</td>
                    <td className="p-3.5 text-slate-500">{a.accountType}</td>
                    <td className="p-3.5 font-mono font-bold text-blue-600">{a.currency}</td>
                    <td className="p-3.5 font-mono">{a.openingBalance.toLocaleString()}</td>
                    <td className="p-3.5 font-mono font-black text-slate-900 text-sm">
                      {a.currentBalance.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">{a.currency}</span>
                    </td>
                    <td className="p-3.5">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        نشط
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* TRANSFER BOTTOM SHEET / MODAL */}
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

              <form onSubmit={handleTransfer} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">من الحساب (المحول منه)</label>
                  <select
                    value={fromAccountId}
                    onChange={(e) => setFromAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currentBalance.toLocaleString()} {a.currency})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">إلى الحساب (المحول إليه)</label>
                  <select
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currentBalance.toLocaleString()} {a.currency})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المراد تحويله</label>
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

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سبب التحويل أو الوصف</label>
                  <input
                    type="text"
                    value={transferDesc}
                    onChange={(e) => setTransferDesc(e.target.value)}
                    placeholder="مثال: تغذية الخزينة الفرعية أو تحويل للبنك"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

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
                    disabled={transferring}
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {transferring ? 'جاري التحويل...' : 'تأكيد التحويل المالي'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* NEW ACCOUNT BOTTOM SHEET / MODAL */}
        {newAccountOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إضافة صندوق أو حساب جديد</h3>
                <button
                  onClick={() => setNewAccountOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم الصندوق / الحساب *</label>
                  <input
                    type="text"
                    required
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    placeholder="مثال: خزينة فرع المعادي"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">نوع الحساب</label>
                    <select
                      value={accType}
                      onChange={(e) => setAccType(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                    >
                      <option value="cash_safe">صندوق نقدي (Cash Safe)</option>
                      <option value="bank">حساب بنكي (Bank Account)</option>
                      <option value="bankak">حساب بنكك (Bankak BOK)</option>
                      <option value="capital">رأس مال (Capital)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة</label>
                    <select
                      value={accCurrency}
                      onChange={(e) => setAccCurrency(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 font-bold min-h-[44px]"
                    >
                      <option value="EGP">جنيه مصري (EGP)</option>
                      <option value="SDG">جنيه سوداني (SDG)</option>
                      <option value="USD">دولار أمريكي (USD)</option>
                      <option value="SAR">ريال سعودي (SAR)</option>
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
                    {savingAccount ? 'جاري الحفظ...' : 'حفظ الحساب'}
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
