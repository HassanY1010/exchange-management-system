'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  CalendarDays,
  Plus,
  Search,
  CheckCircle,
  Clock,
  AlertCircle,
  FileCheck2,
  DollarSign,
  ArrowRight,
  Layers,
  Check,
  X,
  ChevronLeft,
} from 'lucide-react';

export default function CustomerSessionsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // New Session Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [requestedEgp, setRequestedEgp] = useState<number | string>(100000);
  const [exchangeRate, setExchangeRate] = useState<number | string>(200);
  const [saving, setSaving] = useState(false);

  // Detail Modal
  const [activeSession, setActiveSession] = useState<any>(null);

  const fetchSessions = () => {
    setLoading(true);
    let url = '/api/v1/customer-sessions?';
    if (statusFilter) url += `status=${statusFilter}&`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSessions(data.data || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSessions();

    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setCustomers(data.data || []);
          if (data.data?.length > 0) setSelectedCustomerId(data.data[0].id);
        }
      });

    fetch('/api/v1/exchange-rates')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data?.length > 0) {
          const custRate = data.data.find((r: any) => r.rateType === 'customer');
          if (custRate) setExchangeRate(custRate.rate);
        }
      });
  }, [statusFilter]);

  const expectedSdgCalculated = (Number(requestedEgp || 0) * Number(exchangeRate || 1)).toLocaleString();

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/v1/customer-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          requestedAmount: Number(requestedEgp),
          exchangeRate: Number(exchangeRate),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل فتح الجلسة');
      }
      setModalOpen(false);
      fetchSessions();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseSession = async (sessionId: string) => {
    if (!confirm('هل أنت متأكد من إغلاق هذه الجلسة المالية؟')) return;
    try {
      const res = await fetch(`/api/v1/customer-sessions/${sessionId}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setActiveSession(null);
        fetchSessions();
      }
    } catch (err) {
      alert('خطأ في إغلاق الجلسة');
    }
  };

  const filteredSessions = sessions.filter((s) => {
    if (!search) return true;
    return (
      s.sessionNumber.toLowerCase().includes(search.toLowerCase()) ||
      s.customer?.name.toLowerCase().includes(search.toLowerCase())
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">مكتمل ومسدد</span>;
      case 'open':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">مفتوح للتعامل</span>;
      case 'pending_receipts':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">بانتظار الإيصالات</span>;
      case 'pending_delivery':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800">بانتظار تسليم الكاش</span>;
      case 'has_balance':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">يوجد رصيد متبقي</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800">{status}</span>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">الحسابات اليومية للعملاء</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              متابعة استلام دفعات بنكك (SDG) مقابل تسليم النقدية (EGP) يومياً
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-500/20 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>فتح حساب يومي جديد</span>
          </button>
        </div>

        {/* Toolbar & Filter Tabs */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 space-x-reverse w-full md:max-w-md">
            <div className="relative w-full">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الجلسة أو اسم العميل..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            </div>
          </div>

          <div className="flex items-center space-x-1.5 space-x-reverse overflow-x-auto touch-scroll pb-1 sm:pb-0">
            {[
              { id: '', label: 'الكل' },
              { id: 'open', label: 'مفتوحة' },
              { id: 'pending_receipts', label: 'بانتظار الإيصالات' },
              { id: 'pending_delivery', label: 'بانتظار التسليم' },
              { id: 'completed', label: 'مكتملة' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setStatusFilter(btn.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all min-h-[38px] ${
                  statusFilter === btn.id
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* 1. MOBILE VIEW: Responsive Cards (Visible on screens < 1024px) */}
        <div className="lg:hidden space-y-3">
          {filteredSessions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs sm:text-sm">
              {loading ? 'جاري تحميل الجلسات...' : 'لا توجد جلسات حسابية تطابق البحث'}
            </div>
          ) : (
            filteredSessions.map((s) => (
              <div
                key={s.id}
                onClick={() => setActiveSession(s)}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:bg-slate-50 transition-colors flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold bg-slate-100 px-2.5 py-1 rounded-lg text-slate-900">
                    {s.sessionNumber}
                  </span>
                  <div>{getStatusBadge(s.status)}</div>
                </div>

                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="font-bold text-sm sm:text-base text-blue-700 truncate">{s.customer?.name}</h3>
                  <span className="font-mono text-[11px] text-slate-400 shrink-0 mr-2">{s.businessDate}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-50 rounded-xl mb-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">المطلوب مصري:</span>
                    <span className="font-mono font-bold text-slate-900">{s.requestedAmount.toLocaleString()} EGP</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">سعر الصرف:</span>
                    <span className="font-mono font-bold text-slate-800">1 = {s.exchangeRate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-600 block">المستلم الفعلي:</span>
                    <span className="font-mono font-bold text-emerald-700">{s.receivedAmount.toLocaleString()} SDG</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-blue-600 block">المسلّم نقداً:</span>
                    <span className="font-mono font-bold text-blue-700">{s.deliveredAmount.toLocaleString()} EGP</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center space-x-1 space-x-reverse min-h-[40px]"
                >
                  <span>عرض الإيصالات والتفاصيل</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* 2. DESKTOP VIEW: Full Data Table (Visible on screens >= 1024px) */}
        <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">رقم الجلسة</th>
                  <th className="p-3.5">العميل</th>
                  <th className="p-3.5">التاريخ</th>
                  <th className="p-3.5">سعر الصرف</th>
                  <th className="p-3.5">المطلوب مصري (EGP)</th>
                  <th className="p-3.5">المطلوب سوداني (SDG)</th>
                  <th className="p-3.5">المستلم الفعلي (SDG)</th>
                  <th className="p-3.5">المسلّم نقداً (EGP)</th>
                  <th className="p-3.5">الحالة</th>
                  <th className="p-3.5 text-center">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-slate-400">
                      {loading ? 'جاري تحميل الجلسات...' : 'لا توجد جلسات حسابية تطابق البحث'}
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-slate-900">{s.sessionNumber}</td>
                      <td className="p-3.5 font-bold text-blue-700">{s.customer?.name}</td>
                      <td className="p-3.5 font-mono text-slate-500">{s.businessDate}</td>
                      <td className="p-3.5 font-mono font-bold text-slate-800">1 = {s.exchangeRate}</td>
                      <td className="p-3.5 font-mono font-bold text-slate-900">
                        {s.requestedAmount.toLocaleString()} EGP
                      </td>
                      <td className="p-3.5 font-mono font-bold text-indigo-700">
                        {s.expectedAmount.toLocaleString()} SDG
                      </td>
                      <td className="p-3.5 font-mono font-bold text-emerald-600">
                        {s.receivedAmount.toLocaleString()} SDG
                        <span className="block text-[10px] text-slate-400">
                          {s.receipts?.filter((r: any) => r.status === 'approved').length || 0} إيصالات معتمدة
                        </span>
                      </td>
                      <td className="p-3.5 font-mono font-bold text-blue-600">
                        {s.deliveredAmount.toLocaleString()} EGP
                      </td>
                      <td className="p-3.5">{getStatusBadge(s.status)}</td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => setActiveSession(s)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs"
                        >
                          عرض التفاصيل &larr;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* CREATE SESSION MODAL / BOTTOM SHEET */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto touch-scroll rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <h3 className="font-black text-slate-900 text-base">فتح حساب يومي جديد للعميل</h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateSession} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">العميل *</label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.customerCode}) - {c.phone}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المطلوب تسليمه (EGP) *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={requestedEgp}
                      onChange={(e) => setRequestedEgp(e.target.value)}
                      required
                      placeholder="100000"
                      className="w-full px-3.5 py-2.5 font-mono text-sm font-bold rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">سعر الصرف (SDG لكل 1 EGP) *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(e.target.value)}
                      required
                      placeholder="200"
                      className="w-full px-3.5 py-2.5 font-mono text-sm font-bold rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
                    />
                  </div>
                </div>

                {/* Calculation Preview Box */}
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900">
                  <div className="text-xs text-emerald-700 mb-1 font-medium">المطلوب من العميل تحويله عبر بنكك:</div>
                  <div className="text-xl sm:text-2xl font-black font-mono">
                    {expectedSdgCalculated} <span className="text-xs font-medium">SDG</span>
                  </div>
                  <p className="text-[11px] text-emerald-600 mt-1 leading-snug">
                    (يمكن للعميل إرسال المبلغ على دفعات وإيصالات متعددة حتى استيفاء كامل المبلغ)
                  </p>
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-emerald-700 active:bg-emerald-800 shadow-md shadow-emerald-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {saving ? 'جاري الفتح...' : 'تأكيد وفتح الحساب'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ACTIVE SESSION DETAILS MODAL / BOTTOM SHEET */}
        {activeSession && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto touch-scroll p-4 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                    تفاصيل الجلسة • {activeSession.sessionNumber}
                  </h3>
                  <p className="text-xs text-slate-500 truncate">{activeSession.customer?.name} ({activeSession.businessDate})</p>
                </div>
                <button
                  onClick={() => setActiveSession(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Progress Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-5">
                <div className="bg-slate-50 p-3 sm:p-3.5 rounded-xl border border-slate-200">
                  <div className="text-slate-500 text-[11px] mb-0.5">المطلوب سوداني</div>
                  <div className="text-base font-black text-slate-900 font-mono truncate">
                    {activeSession.expectedAmount.toLocaleString()} SDG
                  </div>
                </div>
                <div className="bg-emerald-50 p-3 sm:p-3.5 rounded-xl border border-emerald-200">
                  <div className="text-emerald-700 text-[11px] mb-0.5">المستلم بإيصالات</div>
                  <div className="text-base font-black text-emerald-800 font-mono truncate">
                    {activeSession.receivedAmount.toLocaleString()} SDG
                  </div>
                </div>
                <div className="bg-blue-50 p-3 sm:p-3.5 rounded-xl border border-blue-200">
                  <div className="text-blue-700 text-[11px] mb-0.5">المسلّم كاش مصري</div>
                  <div className="text-base font-black text-blue-800 font-mono truncate">
                    {activeSession.deliveredAmount.toLocaleString()} EGP
                  </div>
                </div>
              </div>

              {/* Attached Receipts */}
              <div className="mb-5">
                <h4 className="font-bold text-xs text-slate-700 mb-2">إيصالات بنكك المرتبطة بهذه الجلسة:</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {(!activeSession.receipts || activeSession.receipts.length === 0) ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      لم يتم ربط إيصالات بهذه الجلسة بعد. يمكنك رفع إيصالات من صفحة الإيصالات.
                    </div>
                  ) : (
                    activeSession.receipts.map((r: any) => (
                      <div key={r.id} className="p-3 flex items-center justify-between text-xs gap-2">
                        <div className="min-w-0">
                          <span className="font-mono font-bold text-slate-900 block truncate">{r.transactionId}</span>
                          <span className="text-slate-400 text-[10px]">{r.transactionDate}</span>
                        </div>
                        <div className="flex items-center space-x-2 space-x-reverse shrink-0">
                          <span className="font-mono font-black text-slate-900">{r.amount.toLocaleString()} SDG</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {r.status === 'approved' ? 'معتمد' : r.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 gap-2">
                <button
                  onClick={() => handleCloseSession(activeSession.id)}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-xl text-xs font-bold min-h-[44px]"
                >
                  إغلاق الجلسة المالية
                </button>
                <button
                  onClick={() => setActiveSession(null)}
                  className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold min-h-[44px]"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
