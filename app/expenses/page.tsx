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
} from 'lucide-react';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState<number | string>(15000);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchExpenses = () => {
    setLoading(true);
    fetch('/api/v1/expenses')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setExpenses(data.data || []);
      })
      .finally(() => setLoading(false));

    fetch('/api/v1/expenses/categories')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setCategories(data.data || []);
          if (data.data?.length > 0) setCategoryId(data.data[0].id);
        }
      });

    fetch('/api/v1/accounts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const cashAccs = data.data?.filter((a: any) => ['cash_safe', 'bank'].includes(a.accountType));
          setAccounts(cashAccs || []);
          if (cashAccs?.length > 0) setAccountId(cashAccs[0].id);
        }
      });
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          accountId,
          amount: Number(amount),
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
      fetchExpenses();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">إدارة المصروفات التشغيلية (Expenses)</h1>
            <p className="text-sm text-slate-500">
              تسجيل وتبويب المصروفات حسب التصنيف، الخصم من الصناديق وإصدار القيود اليومية
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center space-x-2 space-x-reverse bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-rose-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل مصروف جديد</span>
          </button>
        </div>

        {/* Expenses Summary Card */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500 block mb-1">إجمالي المصروفات التشغيلية المسجلة</span>
            <div className="text-3xl font-black font-mono text-rose-700">
              {totalExpenses.toLocaleString()} <span className="text-sm font-normal text-slate-400">EGP</span>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            {expenses.length} عملية مصروف مسجلة ومرحلة
          </div>
        </div>

        {/* Expenses Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">رقم المصروف</th>
                  <th className="p-3">التصنيف</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">البيان / الوصف</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">المسؤول</th>
                  <th className="p-3">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400">
                      لا توجد مصروفات مسجلة حتى الآن
                    </td>
                  </tr>
                ) : (
                  expenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-slate-900">{exp.expenseNumber}</td>
                      <td className="p-3 font-bold text-slate-900">{exp.category?.name}</td>
                      <td className="p-3 font-mono font-black text-rose-600 text-sm">
                        {exp.amount.toLocaleString()} {exp.currency}
                      </td>
                      <td className="p-3 text-slate-600">{exp.description}</td>
                      <td className="p-3 font-mono text-slate-500">{exp.expenseDate}</td>
                      <td className="p-3 text-slate-600">{exp.createdBy}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          معتمد ومخصوم
                        </span>
                      </td>
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
                <h3 className="font-black text-slate-900 text-base">تسجيل مصروف تشغيلي جديد</h3>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateExpense} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تصنيف المصروف</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الصندوق / الحساب المخصوم منه</label>
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ (EGP)</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                      placeholder="15000"
                      className="w-full px-3 py-2 font-mono text-sm font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الصرف</label>
                    <input
                      type="date"
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الوصف أو البيان</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="مثال: فاتورة إيجار المقر لشهر نوفمبر"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500"
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
                    className="px-6 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 shadow-md shadow-rose-500/20 disabled:opacity-50"
                  >
                    {submitting ? 'جاري الصرف...' : 'تأكيد وصرف المصروف'}
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
