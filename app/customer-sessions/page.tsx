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
  Printer,
  ShieldCheck,
  Coins,
  Send,
} from 'lucide-react';

export default function CustomerSessionsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
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

  // Payout Modal State
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [payoutSession, setPayoutSession] = useState<any>(null);
  const [payoutAmountEgp, setPayoutAmountEgp] = useState<number | string>('');
  const [payoutAccountId, setPayoutAccountId] = useState('');
  const [payoutRecipient, setPayoutRecipient] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [payoutError, setPayoutError] = useState('');

  // Voucher Modal State
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);
  const [activeVoucher, setActiveVoucher] = useState<any>(null);

  // Overpayment Settlement Modal State
  const [overpaymentModalOpen, setOverpaymentModalOpen] = useState(false);
  const [overpaymentSession, setOverpaymentSession] = useState<any>(null);
  const [overpaymentAction, setOverpaymentAction] = useState('credit_balance');
  const [settlingOverpayment, setSettlingOverpayment] = useState(false);

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

    fetch('/api/v1/accounts')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const cashAccounts = (data.data || []).filter(
            (a: any) => a.accountType === 'cash_safe' || a.accountType === 'employee_custody'
          );
          setAccounts(cashAccounts);
          if (cashAccounts.length > 0) setPayoutAccountId(cashAccounts[0].id);
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

  // Payout Handlers
  const openPayoutModal = (session: any) => {
    setPayoutSession(session);
    const rem = Number(session.requestedAmount) - Number(session.deliveredAmount);
    setPayoutAmountEgp(rem > 0 ? rem : Number(session.requestedAmount));
    setPayoutRecipient(session.customer?.name || '');
    setPayoutNotes('');
    setPayoutError('');
    setPayoutModalOpen(true);
  };

  const handleExecutePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutSession) return;
    setPaying(true);
    setPayoutError('');

    try {
      const res = await fetch(`/api/v1/customer-sessions/${payoutSession.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountEgp: Number(payoutAmountEgp),
          accountId: payoutAccountId || undefined,
          recipientName: payoutRecipient,
          notes: payoutNotes,
          idempotencyKey: `payout-${payoutSession.id}-${Date.now()}`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تنفيذ عملية صرف النقدية');
      }

      setPayoutModalOpen(false);
      fetchSessions();
      if (activeSession && activeSession.id === payoutSession.id) {
        setActiveSession(data.data.session);
      }
      if (data.data.voucher) {
        setActiveVoucher(data.data.voucher);
        setVoucherModalOpen(true);
      }
    } catch (err: any) {
      setPayoutError(err.message);
    } finally {
      setPaying(false);
    }
  };

  // Overpayment Settle Handlers
  const openOverpaymentModal = (session: any) => {
    setOverpaymentSession(session);
    setOverpaymentAction('credit_balance');
    setOverpaymentModalOpen(true);
  };

  const handleSettleOverpayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overpaymentSession) return;
    setSettlingOverpayment(true);

    try {
      const res = await fetch(`/api/v1/customer-sessions/${overpaymentSession.id}/overpayment/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: overpaymentAction,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسوية فائض السداد');
      }

      setOverpaymentModalOpen(false);
      fetchSessions();
      if (activeSession && activeSession.id === overpaymentSession.id) {
        setActiveSession(data.data);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSettlingOverpayment(false);
    }
  };

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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
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

              {/* Overpayment Alert Card if detected */}
              {Number(activeSession.overpaymentAmount || 0) > 0 && (
                <div className="mb-4 p-3.5 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-950">
                  <div>
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                      <h4 className="font-black text-xs sm:text-sm">
                        يوجد فائض سداد للعميل: {Number(activeSession.overpaymentAmount).toLocaleString()} SDG
                      </h4>
                    </div>
                    <p className="text-[11px] text-amber-800 mt-1">
                      {activeSession.overpaymentSettled
                        ? `تمت تسوية الفائض بإجراء (${activeSession.overpaymentAction === 'cash_refund' ? 'استرداد نقدي' : 'ترحيل إلى رصيد دائن'})`
                        : 'المبلغ الإضافي معلق في وسيط الالتزامات ويتطلب تسوية محاسبية لحفظ حقوق الطرفين'}
                    </p>
                  </div>
                  {!activeSession.overpaymentSettled && (
                    <button
                      onClick={() => openOverpaymentModal(activeSession)}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shrink-0 min-h-[38px]"
                    >
                      تسوية الفائض الآن
                    </button>
                  )}
                </div>
              )}

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
                          <span className="text-slate-400 text-[10px]">{r.transactionDate} {r.transactionTime}</span>
                        </div>
                        <div className="flex items-center space-x-2 space-x-reverse shrink-0">
                          <span className="font-mono font-black text-slate-900">{r.amount.toLocaleString()} SDG</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : r.status === 'verified'
                              ? 'bg-blue-100 text-blue-800'
                              : r.status === 'duplicate'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {r.status === 'approved' ? 'معتمد' : r.status === 'verified' ? 'تم التحقق' : r.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pt-3 border-t border-slate-100 gap-2">
                <div className="flex items-center space-x-2 space-x-reverse">
                  {activeSession.status !== 'completed' && (
                    <button
                      onClick={() => openPayoutModal(activeSession)}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all flex items-center justify-center space-x-1.5 space-x-reverse min-h-[44px]"
                    >
                      <DollarSign className="w-4 h-4" />
                      <span>صرف وتسليم النقدية للعميل (Payout)</span>
                    </button>
                  )}

                  {activeSession.vouchers && activeSession.vouchers.length > 0 && (
                    <button
                      onClick={() => {
                        setActiveVoucher(activeSession.vouchers[0]);
                        setVoucherModalOpen(true);
                      }}
                      className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 space-x-reverse min-h-[44px]"
                    >
                      <Printer className="w-4 h-4" />
                      <span>عرض سند الصرف</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center space-x-2 space-x-reverse">
                  <button
                    onClick={() => handleCloseSession(activeSession.id)}
                    className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold min-h-[44px]"
                  >
                    إغلاق الجلسة
                  </button>
                  <button
                    onClick={() => setActiveSession(null)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PAYOUT CONFIRMATION MODAL */}
        {payoutModalOpen && payoutSession && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto touch-scroll p-5 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">تأكيد صرف النقدية للعميل</h3>
                </div>
                <button
                  onClick={() => setPayoutModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {payoutError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2 space-x-reverse">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{payoutError}</span>
                </div>
              )}

              {/* Session Financial Summary Box */}
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 mb-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">العميل المستلم:</span>
                  <span className="font-bold text-slate-900">{payoutSession.customer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">رقم الجلسة:</span>
                  <span className="font-mono font-bold text-slate-800">{payoutSession.sessionNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">سعر الصرف المعتمد:</span>
                  <span className="font-mono font-bold text-slate-800">1 EGP = {payoutSession.exchangeRate} SDG</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">إجمالي المطلوب سوداني:</span>
                  <span className="font-mono font-bold text-slate-900">{Number(payoutSession.expectedAmount).toLocaleString()} SDG</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">المستلم المعتمد فعلياً:</span>
                  <span className="font-mono font-black text-emerald-700">{Number(payoutSession.receivedAmount).toLocaleString()} SDG</span>
                </div>
              </div>

              <form onSubmit={handleExecutePayout} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المراد صرفه (EGP) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={payoutAmountEgp}
                    onChange={(e) => setPayoutAmountEgp(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 font-mono text-base font-black rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">مصدر النقدية (الصندوق أو العهدة) *</label>
                  <select
                    value={payoutAccountId}
                    onChange={(e) => setPayoutAccountId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.accountCode}) - رصيد: {Number(acc.currentBalance).toLocaleString()} {acc.currency}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستلم الفعلي</label>
                  <input
                    type="text"
                    value={payoutRecipient}
                    onChange={(e) => setPayoutRecipient(e.target.value)}
                    placeholder="اسم العميل أو الوكيل المستلم"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الصرف</label>
                  <input
                    type="text"
                    value={payoutNotes}
                    onChange={(e) => setPayoutNotes(e.target.value)}
                    placeholder="أي ملاحظات إضافية على عملية التسليم"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setPayoutModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={paying}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {paying ? 'جاري تنفيذ الصرف وإصدار السند...' : 'تأكيد الصرف وإصدار السند الرسمي'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CASH PAYOUT VOUCHER PRINTABLE MODAL */}
        {voucherModalOpen && activeVoucher && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-xl max-h-[92vh] overflow-y-auto touch-scroll p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4 sticky top-0 bg-white z-10 print:hidden">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-black text-slate-900 text-base">سند صرف نقدية رسمي (Voucher)</h3>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <button
                    onClick={() => window.print()}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center space-x-1 space-x-reverse"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>طباعة</span>
                  </button>
                  <button
                    onClick={() => setVoucherModalOpen(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Official Voucher Printable Card */}
              <div className="border-2 border-slate-900 rounded-2xl p-6 space-y-4 bg-white text-slate-900">
                <div className="text-center pb-4 border-b-2 border-slate-900">
                  <h2 className="text-lg font-black tracking-tight">شركة الصرافة والتحويلات المالية المعتمدة</h2>
                  <p className="text-xs text-slate-600 mt-0.5">سند صرف وتسليم نقدية لعميل (Cash Payout Voucher)</p>
                  <div className="mt-2 inline-block font-mono font-bold text-xs bg-slate-100 px-3 py-1 rounded-full border border-slate-300">
                    رقم السند: {activeVoucher.voucherNumber}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">اسم العميل:</span>
                    <span className="font-bold text-sm">{activeVoucher.customer?.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">المستلم الفعلي:</span>
                    <span className="font-bold text-sm">{activeVoucher.recipientName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">التاريخ والوقت:</span>
                    <span className="font-mono font-medium">
                      {new Date(activeVoucher.paidAt).toLocaleString('ar-EG')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">المسؤول عن الصرف:</span>
                    <span className="font-medium">{activeVoucher.paidBy}</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <span className="text-xs text-slate-500 block mb-1">المبلغ المسلّم نقداً</span>
                  <div className="text-2xl font-black font-mono text-emerald-700">
                    {Number(activeVoucher.amount).toLocaleString()} {activeVoucher.currency}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    ما يعادله بسعر الصرف ({activeVoucher.exchangeRate}): {Number(activeVoucher.equivalentSdg).toLocaleString()} SDG
                  </div>
                </div>

                <div className="pt-6 border-t border-dashed border-slate-300 grid grid-cols-2 gap-6 text-center text-xs">
                  <div>
                    <span className="text-slate-500 block mb-8">توقيع مسؤول الصندوق / العهدة</span>
                    <div className="border-t border-slate-400 mx-4"></div>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-8">توقيع المستلم (إقرار باستلام المبلغ كاملاً)</span>
                    <div className="border-t border-slate-400 mx-4"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* OVERPAYMENT SETTLEMENT MODAL */}
        {overpaymentModalOpen && overpaymentSession && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto touch-scroll p-5 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <Coins className="w-5 h-5 text-amber-600" />
                  <h3 className="font-black text-slate-900 text-base">تسوية فائض السداد للعميل</h3>
                </div>
                <button
                  onClick={() => setOverpaymentModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl mb-4 text-xs">
                <div className="flex justify-between mb-1">
                  <span className="text-amber-800">العميل:</span>
                  <span className="font-bold text-amber-950">{overpaymentSession.customer?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-800">مبلغ الفائض الإضافي:</span>
                  <span className="font-mono font-black text-amber-950 text-sm">
                    {Number(overpaymentSession.overpaymentAmount).toLocaleString()} SDG
                  </span>
                </div>
              </div>

              <form onSubmit={handleSettleOverpayment} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">اختر إجراء التسوية المحاسبي:</label>
                  <div className="space-y-2">
                    <label className="flex items-start space-x-2.5 space-x-reverse p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="radio"
                        name="settleAction"
                        value="credit_balance"
                        checked={overpaymentAction === 'credit_balance'}
                        onChange={(e) => setOverpaymentAction(e.target.value)}
                        className="mt-1"
                      />
                      <div>
                        <span className="font-bold text-xs text-slate-900 block">ترحيل إلى رصيد العميل الدائم</span>
                        <span className="text-[11px] text-slate-500">
                          يُقيد كالتزام دائن للعميل يمكن استخدامه في جلسات أو معاملات مستقبلية
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start space-x-2.5 space-x-reverse p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="radio"
                        name="settleAction"
                        value="cash_refund"
                        checked={overpaymentAction === 'cash_refund'}
                        onChange={(e) => setOverpaymentAction(e.target.value)}
                        className="mt-1"
                      />
                      <div>
                        <span className="font-bold text-xs text-slate-900 block">استرداد نقدي فوري للعميل</span>
                        <span className="text-[11px] text-slate-500">
                          تسجيل قيد تحويل إرجاع من حساب بنكك للعميل وإلغاء التزام الفائض
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setOverpaymentModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={settlingOverpayment}
                    className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-amber-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {settlingOverpayment ? 'جاري التسوية...' : 'تأكيد التسوية وترحيل القيد'}
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
