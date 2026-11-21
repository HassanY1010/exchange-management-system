'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Landmark,
  Plus,
  Minus,
  TrendingUp,
  Wallet,
  Clock,
  ShieldCheck,
} from 'lucide-react';

export default function CapitalPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [currentCapital, setCurrentCapital] = useState<number>(0);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [transType, setTransType] = useState<'addition' | 'withdrawal'>('addition');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState<number | string>(500000);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCapital = () => {
    setLoading(true);
    fetch('/api/v1/capital')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setTransactions(data.data || []);
          setCurrentCapital(data.currentCapital || 0);
        }
      })
      .finally(() => setLoading(false));

    fetch('/api/v1/accounts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const cashAccounts = data.data?.filter((a: any) =>
            ['cash_safe', 'bank'].includes(a.accountType)
          );
          setAccounts(cashAccounts || []);
          if (cashAccounts?.length > 0) setAccountId(cashAccounts[0].id);
        }
      });
  };

  useEffect(() => {
    fetchCapital();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/capital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionType: transType,
          accountId,
          amount: Number(amount),
          description,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل حركة رأس المال');
      }
      setModalOpen(false);
      setDescription('');
      fetchCapital();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">إدارة رأس المال وحقوق الشركاء (Capital Management)</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              تسجيل رأس المال الافتتاحي، المساهمات الإضافية، المسحوبات وتحديث القيود المحاسبية
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-amber-500/20 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل إضافة / سحب رأس مال</span>
          </button>
        </div>

        {/* Current Capital Card */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-5 sm:p-8 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center space-x-4 space-x-reverse">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Landmark className="w-6 h-6 sm:w-8 sm:h-8" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">إجمالي رأس المال المستثمر الفعلي</span>
              <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900">
                {currentCapital.toLocaleString()} <span className="text-xs sm:text-sm font-normal text-slate-400">EGP</span>
              </div>
            </div>
          </div>
          <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 max-w-md">
            <span className="font-bold block mb-1">قاعدة محاسبية هامة:</span>
            رأس المال يمثل حقوق الملكية ويتم تسجيله في حسابات منفصلة في الدليل المحاسبي ولا يتم احتساب إضافات رأس المال كأرباح أبداً.
          </div>
        </div>

        {/* Transactions Section */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">سجل حركات رأس المال</h3>
            <span className="text-xs text-slate-400 font-mono font-bold">{transactions.length} حركة</span>
          </div>

          {/* Mobile Cards (< sm) */}
          <div className="sm:hidden divide-y divide-slate-100 -mx-4">
            {transactions.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">لا توجد حركات مسجلة لرأس المال حتى الآن</div>
            ) : (
              transactions.map((tx) => (
                <div key={tx.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      {tx.transactionType === 'addition' || tx.transactionType === 'initial_capital' ? (
                        <span className="text-emerald-700 font-bold text-xs inline-flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <Plus className="w-3.5 h-3.5" />
                          <span>إضافة رأس مال</span>
                        </span>
                      ) : (
                        <span className="text-rose-700 font-bold text-xs inline-flex items-center gap-1 bg-rose-50 px-2 py-0.5 rounded-full">
                          <Minus className="w-3.5 h-3.5" />
                          <span>سحب رأس مال</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">{tx.transactionDate}</span>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="font-mono font-black text-lg text-slate-900">
                      {tx.amount.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{tx.currency}</span>
                    </span>
                    <span className="text-xs text-slate-500">بواسطة: {tx.createdBy}</span>
                  </div>

                  {tx.description && (
                    <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-xl">
                      {tx.description}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Desktop Table (hidden on mobile, visible on sm+) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">نوع الحركة</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">العملة</th>
                  <th className="p-3">الوصف</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">المستخدم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-400">
                      لا توجد حركات مسجلة لرأس المال حتى الآن
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold">
                        {tx.transactionType === 'addition' || tx.transactionType === 'initial_capital' ? (
                          <span className="text-emerald-700 flex items-center space-x-1 space-x-reverse">
                            <Plus className="w-3.5 h-3.5" />
                            <span>إضافة رأس مال</span>
                          </span>
                        ) : (
                          <span className="text-rose-700 flex items-center space-x-1 space-x-reverse">
                            <Minus className="w-3.5 h-3.5" />
                            <span>سحب رأس مال</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono font-black text-slate-900 text-sm">
                        {tx.amount.toLocaleString()}
                      </td>
                      <td className="p-3 font-mono font-bold text-blue-600">{tx.currency}</td>
                      <td className="p-3 text-slate-600">{tx.description}</td>
                      <td className="p-3 font-mono text-slate-500">{tx.transactionDate}</td>
                      <td className="p-3 text-slate-600">{tx.createdBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* BOTTOM SHEET / MODAL */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تسجيل حركة رأس مال</h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع الحركة</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTransType('addition')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all min-h-[44px] flex items-center justify-center ${
                        transType === 'addition'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      إضافة رأس مال (+)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransType('withdrawal')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all min-h-[44px] flex items-center justify-center ${
                        transType === 'withdrawal'
                          ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      سحب رأس مال (-)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {transType === 'addition' ? 'الصندوق / الحساب المستلم للمبلغ' : 'الصندوق / الحساب المخصوم منه'}
                  </label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currentBalance.toLocaleString()} {a.currency})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    placeholder="500000"
                    className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">وصف أو سبب الحركة</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="مثال: مساهمة الشريك عمر في رأس المال"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
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
                    className="w-full sm:w-auto px-6 py-2.5 bg-amber-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-amber-700 shadow-md shadow-amber-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {submitting ? 'جاري التسجيل...' : 'تأكيد التسجيل'}
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
