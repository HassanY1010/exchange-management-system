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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">إدارة رأس المال وحقوق الشركاء (Capital Management)</h1>
            <p className="text-sm text-slate-500">
              تسجيل رأس المال الافتتاحي، المساهمات الإضافية، المسحوبات وتحديث القيود المحاسبية
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center space-x-2 space-x-reverse bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-amber-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل إضافة / سحب رأس مال</span>
          </button>
        </div>

        {/* Current Capital Card */}
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-4 space-x-reverse">
            <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Landmark className="w-8 h-8" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-500 block mb-1">إجمالي رأس المال المستثمر الفعلي</span>
              <div className="text-3xl font-black font-mono text-slate-900">
                {currentCapital.toLocaleString()} <span className="text-sm font-normal text-slate-400">EGP</span>
              </div>
            </div>
          </div>
          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 max-w-md">
            <span className="font-bold block mb-1">قاعدة محاسبية هامة:</span>
            رأس المال يمثل حقوق الملكية ويتم تسجيله في حسابات منفصلة في الدليل المحاسبي ولا يتم احتساب إضافات رأس المال كأرباح أبداً.
          </div>
        </div>

        {/* Transactions Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6">
          <h3 className="font-bold text-sm text-slate-900 mb-4">سجل حركات رأس المال</h3>
          <div className="overflow-x-auto">
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

        {/* MODAL */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-100 text-right">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تسجيل حركة رأس مال</h3>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
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
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
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
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
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
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200"
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    placeholder="500000"
                    className="w-full px-3 py-2 font-mono text-sm font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">وصف أو سبب الحركة</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="مثال: مساهمة الشريك عمر في رأس المال"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 shadow-md shadow-amber-500/20 disabled:opacity-50"
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
