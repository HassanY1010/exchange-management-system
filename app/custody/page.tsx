'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  UserCheck,
  Plus,
  Send,
  Search,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Wallet,
  History,
  X,
} from 'lucide-react';

export default function CustodyPage() {
  const [custodies, setCustodies] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Custody Modal
  const [newCustodyOpen, setNewCustodyOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [custodyAmount, setCustodyAmount] = useState<number | string>(500000);
  const [submittingCustody, setSubmittingCustody] = useState(false);

  // Deliver Cash Modal
  const [deliverModalOpen, setDeliverModalOpen] = useState(false);
  const [activeCustody, setActiveCustody] = useState<any>(null);
  const [deliverCustomerId, setDeliverCustomerId] = useState('');
  const [deliverSessionId, setDeliverSessionId] = useState('');
  const [deliverAmount, setDeliverAmount] = useState<number | string>(100000);
  const [deliverNotes, setDeliverNotes] = useState('');
  const [delivering, setDelivering] = useState(false);
  const [deliverError, setDeliverError] = useState('');

  const fetchCustodies = () => {
    setLoading(true);
    fetch('/api/v1/custody')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setCustodies(data.data || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCustodies();

    fetch('/api/v1/employees')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setEmployees(data.data || []);
          if (data.data?.length > 0) setSelectedEmpId(data.data[0].id);
        }
      });

    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setCustomers(data.data || []);
          if (data.data?.length > 0) setDeliverCustomerId(data.data[0].id);
        }
      });

    fetch('/api/v1/customer-sessions?status=open')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSessions(data.data || []);
      });
  }, []);

  // Issue Custody
  const handleIssueCustody = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCustody(true);
    try {
      const res = await fetch('/api/v1/custody', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmpId,
          amount: Number(custodyAmount),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسليم العهدة');
      }

      setNewCustodyOpen(false);
      fetchCustodies();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmittingCustody(false);
    }
  };

  // Deliver Cash to Customer
  const handleDeliverCash = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeliverError('');

    const numAmount = Number(deliverAmount);
    if (!activeCustody) return;

    if (numAmount > activeCustody.currentAmount) {
      setDeliverError(
        `تنبيه: المبلغ المطلوب تسليمه (${numAmount.toLocaleString()} EGP) أكبر من رصيد عهدة الموظف المتاح (${activeCustody.currentAmount.toLocaleString()} EGP)`
      );
      return;
    }

    setDelivering(true);
    try {
      const res = await fetch(`/api/v1/custody/${activeCustody.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: deliverCustomerId,
          customerSessionId: deliverSessionId || null,
          amount: numAmount,
          notes: deliverNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسليم الكاش للعميل');
      }

      setDeliverModalOpen(false);
      setActiveCustody(null);
      setDeliverNotes('');
      fetchCustodies();
    } catch (err: any) {
      setDeliverError(err.message);
    } finally {
      setDelivering(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">الموظفون والعهد المالية</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              تسليم العهد النقدية، تسجيل صرف الكاش للعملاء، ومطابقة الرصيد
            </p>
          </div>
          <button
            onClick={() => setNewCustodyOpen(true)}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-indigo-500/20 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>تسليم عهدة جديدة لموظف</span>
          </button>
        </div>

        {/* Custody Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
          {custodies.length === 0 && !loading && (
            <div className="col-span-full bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs sm:text-sm">
              لا توجد عهد نشطة حالياً
            </div>
          )}

          {custodies.map((c) => {
            const totalDelivered = c.openingAmount - c.currentAmount;
            return (
              <div
                key={c.id}
                className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-xs font-bold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg">
                      {c.businessDate}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      c.status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {c.status === 'open' ? 'عهدة مفتوحة' : 'مغلقة ومسواة'}
                    </span>
                  </div>

                  <h3 className="font-black text-base sm:text-lg text-slate-900 mb-0.5 truncate">{c.employee?.name}</h3>
                  <p className="text-xs text-slate-500 mb-3 truncate">{c.employee?.jobTitle}</p>

                  {/* Balance Display */}
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1.5 mb-3 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">العهدة الافتتاحية:</span>
                      <span className="font-mono font-bold text-slate-900">{c.openingAmount.toLocaleString()} EGP</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">تم تسليمه للعملاء:</span>
                      <span className="font-mono font-bold text-rose-600">-{totalDelivered.toLocaleString()} EGP</span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                      <span className="font-bold text-slate-900">الرصيد المتبقي:</span>
                      <span className="font-mono font-black text-sm sm:text-base text-indigo-600">
                        {c.currentAmount.toLocaleString()} EGP
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      setActiveCustody(c);
                      setDeliverModalOpen(true);
                    }}
                    disabled={c.status !== 'open' || c.currentAmount <= 0}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs sm:text-sm flex items-center justify-center space-x-1.5 space-x-reverse shadow-sm transition-colors min-h-[44px] disabled:opacity-50"
                  >
                    <Send className="w-4 h-4 shrink-0" />
                    <span>تسليم كاش مصري من العهدة</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* NEW CUSTODY MODAL / BOTTOM SHEET */}
        {newCustodyOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto touch-scroll rounded-t-3xl sm:rounded-3xl shadow-2xl p-4 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <h3 className="font-black text-slate-900 text-base">تسليم عهدة نقدية لموظف</h3>
                <button
                  onClick={() => setNewCustodyOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleIssueCustody} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الموظف المستلم للعهدة *</label>
                  <select
                    value={selectedEmpId}
                    onChange={(e) => setSelectedEmpId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employeeCode}) - {emp.jobTitle}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">مبلغ العهدة بالجنيه المصري (EGP) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={custodyAmount}
                    onChange={(e) => setCustodyAmount(e.target.value)}
                    required
                    placeholder="500000"
                    className="w-full px-3.5 py-2.5 font-mono text-sm font-bold rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">يتم الصرف مباشرة من الصندوق النقدي المصري الرئيسي (Safe 1010)</p>
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setNewCustodyOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={submittingCustody}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-indigo-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {submittingCustody ? 'جاري التسليم...' : 'تأكيد تسليم العهدة'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* DELIVER CASH TO CUSTOMER MODAL / BOTTOM SHEET */}
        {deliverModalOpen && activeCustody && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto touch-scroll p-4 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">تسليم نقدية لعميل من العهدة</h3>
                  <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                    عهدة: {activeCustody.employee?.name} • المتاح: {activeCustody.currentAmount.toLocaleString()} EGP
                  </p>
                </div>
                <button
                  onClick={() => setDeliverModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {deliverError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2 space-x-reverse">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{deliverError}</span>
                </div>
              )}

              <form onSubmit={handleDeliverCash} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">العميل المستلم *</label>
                  <select
                    value={deliverCustomerId}
                    onChange={(e) => setDeliverCustomerId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.customerCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ربط بالجلسة اليومية للعميل (اختياري)</label>
                  <select
                    value={deliverSessionId}
                    onChange={(e) => setDeliverSessionId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    <option value="">بدون ربط بجلسة محددة</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sessionNumber} - {s.customer?.name} (متبقي: {(s.requestedAmount - s.deliveredAmount).toLocaleString()} EGP)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المراد تسليمه (EGP) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={deliverAmount}
                    onChange={(e) => setDeliverAmount(e.target.value)}
                    required
                    placeholder="100000"
                    max={activeCustody.currentAmount}
                    className="w-full px-3.5 py-2.5 font-mono text-sm font-black rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 mt-1 flex-wrap gap-1">
                    <span>المتاح: {activeCustody.currentAmount.toLocaleString()} EGP</span>
                    <span className="text-blue-600 font-bold">
                      المتبقي بعد الصرف: {(activeCustody.currentAmount - Number(deliverAmount || 0)).toLocaleString()} EGP
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات أو رقم مرجع</label>
                  <input
                    type="text"
                    value={deliverNotes}
                    onChange={(e) => setDeliverNotes(e.target.value)}
                    placeholder="مثال: تسليم دفعة نقدية أولى"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setDeliverModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={delivering}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {delivering ? 'جاري التسليم...' : 'تأكيد التسليم للعميل'}
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
