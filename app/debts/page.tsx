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
} from 'lucide-react';

export default function DebtsPage() {
  const [debts, setDebts] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Debt Modal
  const [newDebtOpen, setNewDebtOpen] = useState(false);
  const [debtorType, setDebtorType] = useState('customer');
  const [debtorName, setDebtorName] = useState('');
  const [currency, setCurrency] = useState('SDG');
  const [originalAmount, setOriginalAmount] = useState<number | string>(1000000);
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [savingDebt, setSavingDebt] = useState(false);

  // Pay Debt Modal
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [activeDebt, setActiveDebt] = useState<any>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [payAmount, setPayAmount] = useState<number | string>(300000);
  const [paying, setPaying] = useState(false);

  const fetchDebts = () => {
    setLoading(true);
    fetch('/api/v1/debts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setDebts(data.data || []);
      })
      .finally(() => setLoading(false));

    fetch('/api/v1/accounts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const cashAccs = data.data?.filter((a: any) => ['cash_safe', 'bank', 'bankak'].includes(a.accountType));
          setAccounts(cashAccs || []);
          if (cashAccs?.length > 0) setPayAccountId(cashAccs[0].id);
        }
      });
  };

  useEffect(() => {
    fetchDebts();
  }, []);

  const handleCreateDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDebt(true);
    try {
      const res = await fetch('/api/v1/debts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtorType,
          debtorId: debtorName,
          currency,
          originalAmount: Number(originalAmount),
          dueDate: dueDate || null,
          description,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل الدين');
      }

      setNewDebtOpen(false);
      setDebtorName('');
      setDescription('');
      fetchDebts();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingDebt(false);
    }
  };

  const handlePayDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDebt) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/v1/debts/${activeDebt.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: payAccountId,
          amount: Number(payAmount),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل سداد الدين');
      }

      setPayModalOpen(false);
      setActiveDebt(null);
      fetchDebts();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">إدارة الديون والالتزامات (Debt Management)</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              متابعة مديونيات العملاء والموردين، تسجيل دفعات السداد الجزئي، والاحتفاظ بسجل السداد الكامل
            </p>
          </div>
          <button
            onClick={() => setNewDebtOpen(true)}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل مديونية جديدة</span>
          </button>
        </div>

        {/* Debts Section */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">سجل الديون والمديونيات</h3>
            <span className="text-xs text-slate-400 font-mono font-bold">{debts.length} قيد</span>
          </div>

          {/* Mobile Cards (< lg) */}
          <div className="lg:hidden divide-y divide-slate-100">
            {debts.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">لا توجد ديون أو مديونيات مسجلة</div>
            ) : (
              debts.map((d) => {
                const paidAmount = d.originalAmount - d.remainingAmount;
                return (
                  <div key={d.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                          {d.debtNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          {d.debtorType === 'customer' ? 'عميل' : d.debtorType === 'supplier' ? 'مورد' : 'موظف'}
                        </span>
                      </div>
                      <div>
                        {d.status === 'paid' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            مسدد بالكامل
                          </span>
                        )}
                        {d.status === 'partially_paid' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            مدفوع جزئياً
                          </span>
                        )}
                        {d.status === 'outstanding' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            مستحق
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <span className="font-bold text-base text-slate-900">{d.debtorId}</span>
                      <span className="text-[11px] font-mono text-slate-400">{d.debtDate}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-xs text-center">
                      <div>
                        <span className="text-[10px] text-slate-400 block">المبلغ الأصلي</span>
                        <span className="font-mono font-bold text-slate-700">
                          {d.originalAmount.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">المسدد</span>
                        <span className="font-mono font-bold text-emerald-600">
                          {paidAmount.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">المتبقي</span>
                        <span className="font-mono font-black text-rose-600">
                          {d.remainingAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {d.status !== 'paid' && (
                      <button
                        onClick={() => {
                          setActiveDebt(d);
                          setPayAmount(d.remainingAmount);
                          setPayModalOpen(true);
                        }}
                        className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl text-xs sm:text-sm min-h-[44px] flex items-center justify-center transition-colors"
                      >
                        تسجيل دفعة سداد
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table (hidden on mobile, visible on lg) */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">رقم المديونية</th>
                  <th className="p-3">نوع الطرف</th>
                  <th className="p-3">صاحب الدين</th>
                  <th className="p-3">المبلغ الأصلي</th>
                  <th className="p-3">المسدد حتى الآن</th>
                  <th className="p-3">المتبقي للسداد</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3 text-center">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {debts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-slate-400">
                      لا توجد ديون أو مديونيات مسجلة
                    </td>
                  </tr>
                ) : (
                  debts.map((d) => {
                    const paidAmount = d.originalAmount - d.remainingAmount;
                    return (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="p-3 font-mono font-bold text-slate-900">{d.debtNumber}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {d.debtorType === 'customer' ? 'عميل' : d.debtorType === 'supplier' ? 'مورد' : 'موظف'}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-slate-900">{d.debtorId}</td>
                        <td className="p-3 font-mono font-bold text-slate-900">
                          {d.originalAmount.toLocaleString()} {d.currency}
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-600">
                          {paidAmount.toLocaleString()} {d.currency}
                        </td>
                        <td className="p-3 font-mono font-black text-rose-600 text-sm">
                          {d.remainingAmount.toLocaleString()} {d.currency}
                        </td>
                        <td className="p-3 font-mono text-slate-500">{d.debtDate}</td>
                        <td className="p-3">
                          {d.status === 'paid' && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              مسدد بالكامل
                            </span>
                          )}
                          {d.status === 'partially_paid' && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              مدفوع جزئياً
                            </span>
                          )}
                          {d.status === 'outstanding' && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                              مستحق
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {d.status !== 'paid' && (
                            <button
                              onClick={() => {
                                setActiveDebt(d);
                                setPayAmount(d.remainingAmount);
                                setPayModalOpen(true);
                              }}
                              className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg text-xs"
                            >
                              تسجيل دفعة سداد
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* PAY DEBT BOTTOM SHEET / MODAL */}
        {payModalOpen && activeDebt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تسجيل دفعة سداد دين</h3>
                <button
                  onClick={() => setPayModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handlePayDebt} className="space-y-4">
                <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
                  <div>المدين: <span className="font-bold">{activeDebt.debtorId}</span></div>
                  <div>المبلغ المتبقي: <span className="font-bold font-mono text-rose-600">{activeDebt.remainingAmount.toLocaleString()} {activeDebt.currency}</span></div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الصندوق / الحساب المستلم للمبلغ</label>
                  <select
                    value={payAccountId}
                    onChange={(e) => setPayAccountId(e.target.value)}
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المسدد ({activeDebt.currency})</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                    max={activeDebt.remainingAmount}
                    className="w-full px-3 py-2.5 font-mono text-sm sm:text-base font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
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
                    disabled={paying}
                    className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-emerald-700 shadow-md shadow-emerald-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {paying ? 'جاري السداد...' : 'تأكيد تسجيل السداد'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* NEW DEBT BOTTOM SHEET / MODAL */}
        {newDebtOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تسجيل مديونية جديدة</h3>
                <button
                  onClick={() => setNewDebtOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateDebt} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">صفة الطرف</label>
                    <select
                      value={debtorType}
                      onChange={(e) => setDebtorType(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                    >
                      <option value="customer">عميل (Customer)</option>
                      <option value="supplier">مورد (Supplier)</option>
                      <option value="employee">موظف (Employee)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">اسم الطرف المدين</label>
                    <input
                      type="text"
                      required
                      value={debtorName}
                      onChange={(e) => setDebtorName(e.target.value)}
                      placeholder="اسم العميل أو المورد"
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      required
                      value={originalAmount}
                      onChange={(e) => setOriginalAmount(e.target.value)}
                      placeholder="1000000"
                      className="w-full px-3 py-2.5 font-mono text-xs sm:text-sm font-bold rounded-xl border border-slate-200 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 font-bold min-h-[44px]"
                    >
                      <option value="SDG">جنيه سوداني (SDG)</option>
                      <option value="EGP">جنيه مصري (EGP)</option>
                      <option value="USD">دولار (USD)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الاستحقاق (اختياري)</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سبب أو بيان الدين</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="مثال: متبقي تحويل غير مكتمل للعميل"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 min-h-[44px]"
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
                    className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-50 min-h-[44px]"
                  >
                    {savingDebt ? 'جاري الحفظ...' : 'حفظ المديونية'}
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
