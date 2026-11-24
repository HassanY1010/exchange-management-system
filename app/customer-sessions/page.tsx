'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  CalendarDays,
  Plus,
  Search,
  CheckCircle,
  CheckCircle2,
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
  UserPlus,
  RefreshCw,
} from 'lucide-react';

export default function CustomerSessionsPage() {
  const [mounted, setMounted] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // New Session Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [requestedEgp, setRequestedEgp] = useState<number | string>(100000);
  const [exchangeRate, setExchangeRate] = useState<number | string>(200);
  const [saving, setSaving] = useState(false);
  const [sessionError, setSessionError] = useState('');

  // Quick In-Modal Customer Creation State
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustIdentity, setNewCustIdentity] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustNotes, setNewCustNotes] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustError, setNewCustError] = useState('');
  const [newCustSuccess, setNewCustSuccess] = useState('');

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

  const fetchCustomers = async () => {
    try {
      const res = await fetch('/api/v1/customers');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setCustomers(data.data);
        const active = data.data.filter((c: any) => c.status !== 'closed');
        if (active.length > 0 && !selectedCustomerId) {
          setSelectedCustomerId(active[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchSessions();
    fetchCustomers();

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

    fetch('/api/v1/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.user) {
          setCurrentUserRole(data.user.role || '');
        }
      })
      .catch(() => {});

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

  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewCustError('');
    setNewCustSuccess('');

    const cleanName = newCustName.trim();
    const cleanPhone = newCustPhone.trim();

    if (!cleanName || cleanName.length < 3) {
      setNewCustError('اسم العميل مطلوب ويجب أن يحتوي على 3 أحرف على الأقل');
      return;
    }
    if (!cleanPhone || cleanPhone.length < 7) {
      setNewCustError('رقم الهاتف مطلوب ويجب أن يحتوي على 7 أرقام على الأقل');
      return;
    }

    setCreatingCustomer(true);
    try {
      const res = await fetch('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          phone: cleanPhone,
          identityNumber: newCustIdentity.trim() || undefined,
          address: newCustAddress.trim() || undefined,
          notes: newCustNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إضافة العميل');
      }

      const createdCust = data.data;
      setCustomers((prev) => [createdCust, ...prev]);
      setSelectedCustomerId(createdCust.id);
      setNewCustSuccess(`تم تسجيل العميل "${createdCust.name}" بنجاح واختياره تلقائياً`);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustIdentity('');
      setNewCustAddress('');
      setNewCustNotes('');
      setShowNewCustomerForm(false);
    } catch (err: any) {
      setNewCustError(err.message || 'حدث خطأ أثناء تسجيل العميل');
      // Inputs for requestedEgp and exchangeRate remain intact
    } finally {
      setCreatingCustomer(false);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setSessionError('');
    setNewCustSuccess('');

    const activeList = customers.filter((c) => c.status !== 'closed');
    const targetCust = activeList.find((c) => c.id === selectedCustomerId);
    if (!targetCust) {
      setSessionError('يرجى اختيار عميل نشط أو تسجيل عميل جديد أولاً');
      return;
    }
    if (targetCust.status === 'closed') {
      setSessionError('لا يمكن فتح حساب يومي لعميل حسابه مقفل في النظام');
      return;
    }

    const numReq = Number(requestedEgp);
    const numRate = Number(exchangeRate);
    if (!numReq || isNaN(numReq) || numReq <= 0) {
      setSessionError('المبلغ المطلوب تسليمه يجب أن يكون رقماً موجباً أكبر من صفر');
      return;
    }
    if (!numRate || isNaN(numRate) || numRate <= 0) {
      setSessionError('سعر الصرف يجب أن يكون رقماً موجباً أكبر من صفر');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/v1/customer-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          requestedAmount: numReq,
          exchangeRate: numRate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل فتح الجلسة');
      }
      setModalOpen(false);
      setSessionError('');
      fetchSessions();
    } catch (err: any) {
      setSessionError(err.message || 'فشل فتح الجلسة');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseSession = async (sessionId: string) => {
    if (!confirm('هل أنت متأكد من رغبتك في إغلاق هذه الجلسة المالية وإكمالها؟')) return;
    try {
      const res = await fetch(`/api/v1/customer-sessions/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActiveSession(null);
        fetchSessions();
      } else {
        alert(data.error || 'تعذر إغلاق الجلسة لعدم استيفاء الشروط المالية');
      }
    } catch (err: any) {
      alert(err.message || 'خطأ في الاتصال بالخادم أثناء إغلاق الجلسة');
    }
  };

  const handleCancelSession = async (sessionId: string) => {
    if (!confirm('هل أنت متأكد من رغبتك في إلغاء هذه الجلسة الحسابية؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    try {
      const res = await fetch(`/api/v1/customer-sessions/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActiveSession(null);
        fetchSessions();
      } else {
        alert(data.error || 'تعذر إلغاء الجلسة');
      }
    } catch (err: any) {
      alert(err.message || 'خطأ في الاتصال بالخادم أثناء إلغاء الجلسة');
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
            onClick={() => {
              setSessionError('');
              setNewCustError('');
              setNewCustSuccess('');
              setShowNewCustomerForm(false);
              fetchCustomers();
              setModalOpen(true);
            }}
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
        {modalOpen && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white w-full sm:max-w-lg max-h-[85dvh] sm:max-h-[90dvh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden text-right">
              {/* Modal Header - Fixed */}
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div>
                  <h3 className="font-black text-slate-900 text-base">فتح حساب يومي جديد للعميل</h3>
                  <p className="text-[11px] text-slate-500">تسجيل جلسة تحويل مالي واستلام دفعات بنكك</p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Feedback Notifications */}
              {newCustSuccess && (
                <div className="mx-4 sm:mx-5 mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{newCustSuccess}</span>
                </div>
              )}

              {sessionError && (
                <div className="mx-4 sm:mx-5 mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{sessionError}</span>
                </div>
              )}

              {/* Form Content - Scrollable */}
              <form id="create-session-form" onSubmit={handleCreateSession} className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
                {/* Customer Section */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700">العميل *</label>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewCustomerForm(!showNewCustomerForm);
                        setNewCustError('');
                      }}
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 py-1 px-2.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{showNewCustomerForm ? 'إلغاء الإضافة والاختيار من القائمة' : '+ إضافة عميل جديد'}</span>
                    </button>
                  </div>

                  {/* Inline New Customer Creation Form */}
                  {showNewCustomerForm ? (
                    <div className="p-3.5 sm:p-4 bg-emerald-50/40 border border-emerald-200 rounded-2xl space-y-3 animate-fade-in">
                      <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                        <div className="flex items-center gap-1.5 text-xs font-black text-emerald-900">
                          <UserPlus className="w-4 h-4 text-emerald-600" />
                          <span>تسجيل بيانات العميل الجديد مباشرة:</span>
                        </div>
                        <span className="text-[10px] text-emerald-700 font-medium">سيتم ربطه واختياره تلقائياً</span>
                      </div>

                      {newCustError && (
                        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>{newCustError}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">اسم العميل بالكامل *</label>
                          <input
                            type="text"
                            value={newCustName}
                            onChange={(e) => setNewCustName(e.target.value)}
                            placeholder="مثال: محمد أحمد علي"
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">رقم الهاتف *</label>
                          <input
                            type="tel"
                            value={newCustPhone}
                            onChange={(e) => setNewCustPhone(e.target.value)}
                            placeholder="مثال: 01012345678"
                            className="w-full px-3 py-2 font-mono rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 bg-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">الرقم القومي / الهوية (اختياري)</label>
                          <input
                            type="text"
                            value={newCustIdentity}
                            onChange={(e) => setNewCustIdentity(e.target.value)}
                            placeholder="رقم الهوية أو جواز السفر"
                            className="w-full px-3 py-2 font-mono rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">العنوان أو المدينة (اختياري)</label>
                          <input
                            type="text"
                            value={newCustAddress}
                            onChange={(e) => setNewCustAddress(e.target.value)}
                            placeholder="مثال: القاهرة / الخرطوم"
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 bg-white"
                          />
                        </div>
                      </div>

                      <div className="text-xs">
                        <label className="block font-bold text-slate-700 mb-1">ملاحظات إضافية (اختياري)</label>
                        <input
                          type="text"
                          value={newCustNotes}
                          onChange={(e) => setNewCustNotes(e.target.value)}
                          placeholder="أي ملاحظات تخص العميل أو طريقة تسليمه..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 bg-white"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-emerald-200/60">
                        <button
                          type="button"
                          onClick={() => setShowNewCustomerForm(false)}
                          disabled={creatingCustomer}
                          className="px-3.5 py-1.5 text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl font-bold min-h-[36px]"
                        >
                          إلغاء
                        </button>
                        <button
                          type="button"
                          onClick={handleQuickCreateCustomer}
                          disabled={creatingCustomer || !newCustName.trim() || !newCustPhone.trim()}
                          className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50 min-h-[36px]"
                        >
                          {creatingCustomer && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                          <span>{creatingCustomer ? 'جاري التسجيل...' : 'حفظ واختيار العميل'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Customer Select Dropdown */
                    <div>
                      {(() => {
                        const activeCustomers = customers.filter((c) => c.status !== 'closed');
                        return (
                          <>
                            <select
                              value={selectedCustomerId}
                              onChange={(e) => {
                                setSelectedCustomerId(e.target.value);
                                setSessionError('');
                              }}
                              required
                              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 min-h-[44px] bg-white"
                            >
                              {activeCustomers.length === 0 ? (
                                <option value="" disabled>
                                  -- لا يوجد عملاء متاحين حالياً (انقر على زر + إضافة عميل جديد أعلاه) --
                                </option>
                              ) : (
                                <>
                                  <option value="">-- اختر العميل من القائمة ({activeCustomers.length} متاح) --</option>
                                  {activeCustomers.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} ({c.customerCode}) - {c.phone}
                                    </option>
                                  ))}
                                </>
                              )}
                            </select>

                            {activeCustomers.length === 0 && (
                              <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-2">
                                <span>لا يوجد عملاء متاحين لفتح حساب لهم حالياً.</span>
                                <button
                                  type="button"
                                  onClick={() => setShowNewCustomerForm(true)}
                                  className="font-bold text-emerald-800 hover:underline px-2.5 py-1 rounded-lg bg-emerald-100 shrink-0"
                                >
                                  + تسجيل عميل جديد الآن
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
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
                      min={1}
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
                      min={0.01}
                      step="any"
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
              </form>

              {/* Action Buttons - Fixed/Pinned at Bottom */}
              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  form="create-session-form"
                  disabled={saving || !selectedCustomerId || !requestedEgp || Number(requestedEgp) <= 0 || !exchangeRate || Number(exchangeRate) <= 0}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-emerald-700 active:bg-emerald-800 shadow-md shadow-emerald-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{saving ? 'جاري الفتح...' : 'تأكيد وفتح الحساب'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ACTIVE SESSION DETAILS MODAL / BOTTOM SHEET */}
        {activeSession && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-3xl max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                    تفاصيل الجلسة • {activeSession.sessionNumber}
                  </h3>
                  <p className="text-xs text-slate-500 truncate">{activeSession.customer?.name} ({activeSession.businessDate})</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSession(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="p-4 sm:p-6 overflow-y-auto touch-scroll flex-1 space-y-4">
                {/* Progress Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
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
                  <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-950">
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
                        type="button"
                        onClick={() => openOverpaymentModal(activeSession)}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shrink-0 min-h-[38px]"
                      >
                        تسوية الفائض الآن
                      </button>
                    )}
                  </div>
                )}

                {/* Attached Receipts */}
                <div>
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
              </div>

              {/* Action Buttons - Fixed at Bottom */}
              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 safe-area-pb">
                <div className="flex items-center space-x-2 space-x-reverse">
                  {activeSession.status !== 'completed' && (
                    currentUserRole === 'accountant' ? (
                      <div className="px-3.5 py-2.5 bg-slate-100 text-slate-500 rounded-xl text-xs font-bold flex items-center space-x-1.5 space-x-reverse border border-slate-200" title="الفصل بين المهام: صلاحية الصرف مقتصرة على مسؤول العهدة">
                        <ShieldCheck className="w-4 h-4 text-slate-400" />
                        <span>صرف النقدية محصور بمسؤول العهدة (مبدأ الفصل بين المهام)</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openPayoutModal(activeSession)}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all flex items-center justify-center space-x-1.5 space-x-reverse min-h-[44px]"
                      >
                        <DollarSign className="w-4 h-4" />
                        <span>صرف وتسليم النقدية للعميل (Payout)</span>
                      </button>
                    )
                  )}

                  {activeSession.vouchers && activeSession.vouchers.length > 0 && (
                    <button
                      type="button"
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
                  {activeSession.status !== 'completed' && activeSession.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() => handleCloseSession(activeSession.id)}
                      className="px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold min-h-[44px]"
                    >
                      إغلاق الجلسة
                    </button>
                  )}

                  {activeSession.status === 'open' &&
                    Number(activeSession.receivedAmount) === 0 &&
                    Number(activeSession.deliveredAmount) === 0 &&
                    ['admin', 'accountant'].includes(currentUserRole) && (
                      <button
                        type="button"
                        onClick={() => handleCancelSession(activeSession.id)}
                        className="px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-xl text-xs font-bold min-h-[44px]"
                      >
                        إلغاء الجلسة
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => setActiveSession(null)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold min-h-[44px]"
                  >
                    إغلاق النافذة
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* PAYOUT CONFIRMATION MODAL */}
        {payoutModalOpen && payoutSession && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">تأكيد صرف النقدية للعميل</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPayoutModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
                {payoutError && (
                  <div className="p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2 space-x-reverse">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{payoutError}</span>
                  </div>
                )}

                {/* Session Financial Summary Box */}
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-2 text-xs">
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

                <form id="payout-form" onSubmit={handleExecutePayout} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المراد صرفه (EGP) *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={payoutAmountEgp}
                      onChange={(e) => setPayoutAmountEgp(e.target.value)}
                      required
                      min={1}
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
                </form>
              </div>

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setPayoutModalOpen(false)}
                  disabled={paying}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  form="payout-form"
                  disabled={paying || !payoutAmountEgp || Number(payoutAmountEgp) <= 0}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {paying && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{paying ? 'جاري تنفيذ الصرف...' : 'تأكيد الصرف وإصدار السند الرسمي'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* CASH PAYOUT VOUCHER PRINTABLE MODAL */}
        {voucherModalOpen && activeVoucher && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-xl max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-white shrink-0 print:hidden">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-black text-slate-900 text-base">سند صرف نقدية رسمي (Voucher)</h3>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center space-x-1 space-x-reverse min-h-[38px]"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>طباعة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoucherModalOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[38px] min-h-[38px] flex items-center justify-center -ml-2"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Scrollable Printable Content */}
              <div className="p-4 sm:p-6 overflow-y-auto touch-scroll flex-1">
                <div className="border-2 border-slate-900 rounded-2xl p-5 sm:p-6 space-y-4 bg-white text-slate-900">
                  <div className="text-center pb-4 border-b-2 border-slate-900">
                    <div className="w-14 h-14 bg-white rounded-xl border border-slate-200 p-1 flex items-center justify-center mx-auto mb-2 shadow-xs overflow-hidden">
                      <img
                        src="/brand/logo.png"
                        alt="أبو جواد للتجارة"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <h2 className="text-lg font-black tracking-tight">أبو جواد للتجارة</h2>
                    <p className="text-[11px] font-bold text-amber-700 tracking-wider font-mono uppercase">ABU JAWAD FOR TRADEING</p>
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

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex justify-end shrink-0 safe-area-pb print:hidden">
                <button
                  type="button"
                  onClick={() => setVoucherModalOpen(false)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs sm:text-sm min-h-[44px]"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* OVERPAYMENT SETTLEMENT MODAL */}
        {overpaymentModalOpen && overpaymentSession && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <Coins className="w-5 h-5 text-amber-600" />
                  <h3 className="font-black text-slate-900 text-base">تسوية فائض السداد للعميل</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setOverpaymentModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs">
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

                <form id="settle-overpayment-form" onSubmit={handleSettleOverpayment} className="space-y-4">
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
                </form>
              </div>

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setOverpaymentModalOpen(false)}
                  disabled={settlingOverpayment}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  form="settle-overpayment-form"
                  disabled={settlingOverpayment}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-amber-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {settlingOverpayment && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{settlingOverpayment ? 'جاري التسوية...' : 'تأكيد التسوية وترحيل القيد'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </DashboardLayout>
  );
}
