'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Users,
  Plus,
  Search,
  Phone,
  MessageSquare,
  FileText,
  Printer,
  Calendar,
  Building,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  CreditCard,
  MapPin,
  ExternalLink,
} from 'lucide-react';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Create Customer Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [city, setCity] = useState('القاهرة');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Statement Modal State
  const [activeCustomer, setActiveCustomer] = useState<any>(null);
  const [statementData, setStatementData] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);

  const fetchCustomers = useCallback((searchQuery: string = search) => {
    setLoading(true);
    setError(null);
    let url = '/api/v1/customers';
    if (searchQuery.trim()) {
      url += `?q=${encodeURIComponent(searchQuery.trim())}`;
    }

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`خطأ في استجابة الخادم (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setCustomers(data.data || []);
        } else {
          setError(data.error || 'فشل تحميل بيانات العملاء');
        }
      })
      .catch((err) => {
        setError(err.message || 'تعذر الاتصال بالخادم، يرجى التحقق من اتصالك بالإنترنت');
      })
      .finally(() => setLoading(false));
  }, [search]);

  // Initial fetch
  useEffect(() => {
    fetchCustomers('');
  }, [fetchCustomers]);

  // Debounced search on input change
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    // Validation
    if (!name.trim() || name.trim().length < 3) {
      setFormError('اسم العميل مطلوب ويجب أن يحتوي على 3 أحرف على الأقل');
      setSaving(false);
      return;
    }

    if (!phone.trim() || phone.trim().length < 7) {
      setFormError('رقم الهاتف مطلوب ويجب ألا يقل عن 7 أرقام');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          secondaryPhone: secondaryPhone.trim() || undefined,
          whatsapp: whatsapp.trim() || phone.trim(),
          identityNumber: identityNumber.trim() || undefined,
          city: city.trim() || 'القاهرة',
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إضافة العميل');
      }

      // Reset and close
      setCreateModalOpen(false);
      setName('');
      setPhone('');
      setSecondaryPhone('');
      setWhatsapp('');
      setIdentityNumber('');
      setAddress('');
      setNotes('');
      setFormError(null);
      fetchCustomers('');
    } catch (err: any) {
      setFormError(err.message || 'حدث خطأ أثناء حفظ بيانات العميل');
    } finally {
      setSaving(false);
    }
  };

  const openStatement = async (cust: any) => {
    setActiveCustomer(cust);
    setStatementLoading(true);
    setStatementError(null);
    setStatementData(null);

    try {
      const res = await fetch(`/api/v1/customers/${cust.id}/statement`);
      const data = await res.json();
      if (res.ok && data.success) {
        setStatementData(data.statement);
      } else {
        setStatementError(data.error || 'تعذر استخراج كشف حساب العميل');
      }
    } catch (err: any) {
      setStatementError(err.message || 'حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setStatementLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">سجل وملفات العملاء</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              إدارة بيانات العملاء، الحسابات المستمرة، استخراج كشوف الحسابات الرسمية
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse self-stretch sm:self-auto">
            <button
              onClick={() => fetchCustomers(search)}
              disabled={loading}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 space-x-reverse bg-white border border-slate-200 hover:bg-slate-50 active:bg-slate-100 text-slate-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold shadow-sm transition-all min-h-[44px]"
              title="تحديث القائمة"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">تحديث</span>
            </button>
            <button
              onClick={() => {
                setFormError(null);
                setCreateModalOpen(true);
              }}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>إضافة عميل جديد</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm w-full">
          <div className="relative flex items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث سريع بالاسم، رقم الهاتف، كود العميل، أو الرقم القومي..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px] transition-all"
            />
            {search ? (
              <button
                onClick={() => setSearch('')}
                className="absolute left-3 text-slate-400 hover:text-slate-600 p-1"
                title="مسح البحث"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            )}
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="p-3.5 sm:p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-rose-900 text-xs sm:text-sm">
            <div className="flex items-center space-x-2 space-x-reverse">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => fetchCustomers(search)}
              className="font-bold underline hover:text-rose-950 px-2 py-1"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Customer Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
          {loading && customers.length === 0 ? (
            <div className="col-span-full py-16 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
              <p className="text-xs sm:text-sm font-medium">جاري تحميل سجل العملاء...</p>
            </div>
          ) : customers.length === 0 ? (
            <div className="col-span-full bg-white rounded-2xl border border-dashed border-slate-200 p-8 sm:p-12 text-center text-slate-500">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-sm sm:text-base text-slate-800 mb-1">
                {search ? 'لا توجد نتائج مطابقة لبحثك' : 'لا يوجد عملاء مسجلون بعد'}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
                {search
                  ? `لم نعثر على أي عميل يتطابق مع "${search}". تأكد من صحة رقم الهاتف أو الكود.`
                  : 'ابدأ بإضافة أول عميل إلى المنصة لتنظيم عمليات الحسابات اليومية والتحويلات.'}
              </p>
              {search ? (
                <button
                  onClick={() => setSearch('')}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
                >
                  عرض جميع العملاء
                </button>
              ) : (
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition"
                >
                  إضافة عميل الآن
                </button>
              )}
            </div>
          ) : (
            customers.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <span className="font-mono text-xs font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg border border-blue-100">
                      {c.customerCode}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100 flex items-center space-x-1 space-x-reverse">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>نشط</span>
                    </span>
                  </div>

                  <h3 className="font-black text-base text-slate-900 mb-2 truncate" title={c.name}>
                    {c.name}
                  </h3>

                  <div className="space-y-2 text-xs text-slate-600 mb-3">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <a
                        href={`tel:${c.phone}`}
                        dir="ltr"
                        className="hover:text-blue-600 font-mono font-medium truncate"
                        title="اتصال هاتفي"
                      >
                        {c.phone}
                      </a>
                    </div>

                    {c.whatsapp && (
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <MessageSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <a
                          href={`https://wa.me/${c.whatsapp.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          dir="ltr"
                          className="hover:text-emerald-700 font-mono font-medium text-emerald-600 truncate flex items-center space-x-1 space-x-reverse"
                          title="محادثة واتساب مباشرة"
                        >
                          <span>{c.whatsapp}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    )}

                    {(c.city || c.address) && (
                      <div className="flex items-center space-x-2 space-x-reverse text-slate-500">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          {c.city} {c.address ? `• ${c.address}` : ''}
                        </span>
                      </div>
                    )}

                    {c.identityNumber && (
                      <div className="flex items-center space-x-2 space-x-reverse text-slate-500">
                        <CreditCard className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-mono text-[11px] truncate">هوية: {c.identityNumber}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-400 font-medium">
                    {c._count?.sessions || 0} جلسات • {c._count?.receipts || 0} إيصالات
                  </span>

                  <div className="flex items-center space-x-1.5 space-x-reverse">
                    <Link
                      href={`/customer-sessions?customerId=${c.id}`}
                      className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-800 text-[11px] font-bold rounded-lg transition-colors min-h-[36px] flex items-center"
                      title="فتح جلسة حساب لهذا العميل"
                    >
                      <span>فتح حساب</span>
                    </Link>
                    <button
                      onClick={() => openStatement(c)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 text-[11px] font-bold rounded-lg transition-colors flex items-center space-x-1 space-x-reverse min-h-[36px]"
                      title="عرض وطباعة كشف الحساب"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>كشف حساب</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* CREATE CUSTOMER MODAL / BOTTOM SHEET */}
        {createModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto touch-scroll rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <Users className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">إضافة عميل جديد للنظام</h3>
                </div>
                <button
                  onClick={() => setCreateModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                  aria-label="إغلاق"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {formError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-center space-x-2 space-x-reverse">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleCreateCustomer} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم بالكامل <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: عمر أحمد عبدالله"
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      رقم الهاتف الأساسي <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+249912345678 أو 01012345678"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-left min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم واتساب</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      placeholder="اتركه فارغاً لاعتماد رقم الهاتف"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-left min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم هاتف إضافي (اختياري)</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={secondaryPhone}
                      onChange={(e) => setSecondaryPhone(e.target.value)}
                      placeholder="+201112233445"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-left min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الرقم القومي / جواز السفر</label>
                    <input
                      type="text"
                      value={identityNumber}
                      onChange={(e) => setIdentityNumber(e.target.value)}
                      placeholder="رقم الهوية أو الجواز"
                      className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المدينة / الفرع</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="القاهرة / الخرطوم"
                      className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العنوان التفصيلي</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="المعادي / وسط البلد"
                      className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات العميل</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="أي ملاحظات خاصة بالعميل أو تفضيلاته..."
                    className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 active:bg-blue-800 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px] flex items-center space-x-1.5 space-x-reverse"
                  >
                    {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
                    <span>{saving ? 'جاري الحفظ...' : 'حفظ العميل'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* PRINTABLE ACCOUNT STATEMENT MODAL */}
        {activeCustomer && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-4xl max-h-[94vh] overflow-y-auto touch-scroll p-4 sm:p-8 text-right safe-area-pb">
              {/* Actions Header (Screen only, hidden when printed) */}
              <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-200 mb-4 sm:mb-6 no-print">
                <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                  <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                    كشف حساب: {activeCustomer.name} ({activeCustomer.customerCode})
                  </h3>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse shrink-0">
                  <button
                    onClick={() => window.print()}
                    disabled={statementLoading || !statementData}
                    className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse shadow-md shadow-blue-500/20 min-h-[40px] disabled:opacity-50"
                  >
                    <Printer className="w-4 h-4" />
                    <span className="hidden sm:inline">طباعة / تصدير PDF</span>
                  </button>
                  <button
                    onClick={() => setActiveCustomer(null)}
                    className="p-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 min-w-[40px] min-h-[40px] flex items-center justify-center"
                    aria-label="إغلاق"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {statementLoading ? (
                <div className="py-16 text-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
                  <p className="text-xs sm:text-sm font-medium">جاري استخراج وتدقيق كشف الحساب...</p>
                </div>
              ) : statementError ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs sm:text-sm text-center">
                  <AlertCircle className="w-6 h-6 text-rose-600 mx-auto mb-1" />
                  <p className="font-bold">{statementError}</p>
                </div>
              ) : statementData && (
                <div className="print-area space-y-4 sm:space-y-6">
                  {/* Official Letterhead */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b-2 border-slate-900 pb-3 gap-2">
                    <div>
                      <h2 className="text-base sm:text-xl font-black text-slate-900">
                        {statementData.companyName}
                      </h2>
                      <p className="text-xs text-slate-500">نظام إدارة العملات والتحويلات المركزية</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">سجل تجاري معتمد • القاهرة • هاتف: +201000000001</p>
                    </div>
                    <div className="text-right sm:text-left font-mono text-xs border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                      <div className="font-bold text-slate-900 text-sm">كشف حساب عميل معتمد</div>
                      <div className="text-slate-500">التاريخ: {new Date().toLocaleDateString('ar-EG')}</div>
                      <div className="text-slate-400">الكود: {statementData.customer.code}</div>
                    </div>
                  </div>

                  {/* Customer Information Box */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">اسم العميل:</span>
                      <span className="font-bold text-slate-900 truncate block">{statementData.customer.name}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">رقم الهاتف:</span>
                      <span className="font-bold text-slate-900 font-mono" dir="ltr">{statementData.customer.phone}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">المدينة / العنوان:</span>
                      <span className="font-bold text-slate-900 truncate block">
                        {statementData.customer.city || '—'} {statementData.customer.address ? `• ${statementData.customer.address}` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">الحالة:</span>
                      <span className="font-bold text-emerald-600">نشط ومعتمد</span>
                    </div>
                  </div>

                  {/* Statement Summary KPI Cards */}
                  {statementData.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                      <div className="bg-emerald-50/70 border border-emerald-200 p-2.5 rounded-xl text-center">
                        <span className="text-emerald-700 block text-[10px] font-bold">إجمالي المستلم (SDG)</span>
                        <span className="font-black text-sm text-emerald-900">
                          {statementData.summary.totalReceivedSdg.toLocaleString()} SDG
                        </span>
                      </div>
                      <div className="bg-blue-50/70 border border-blue-200 p-2.5 rounded-xl text-center">
                        <span className="text-blue-700 block text-[10px] font-bold">إجمالي المسلّم (EGP)</span>
                        <span className="font-black text-sm text-blue-900">
                          {statementData.summary.totalDeliveredEgp.toLocaleString()} EGP
                        </span>
                      </div>
                      <div className="bg-amber-50/70 border border-amber-200 p-2.5 rounded-xl text-center">
                        <span className="text-amber-700 block text-[10px] font-bold">المتبقي المطلوب (SDG)</span>
                        <span className="font-black text-sm text-amber-900">
                          {statementData.summary.totalRemainingSdg.toLocaleString()} SDG
                        </span>
                      </div>
                      <div className="bg-purple-50/70 border border-purple-200 p-2.5 rounded-xl text-center">
                        <span className="text-purple-700 block text-[10px] font-bold">الجلسات المكتملة</span>
                        <span className="font-black text-sm text-purple-900">
                          {statementData.summary.completedCount} من {statementData.summary.sessionsCount}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Sessions & Receipts Table */}
                  <div>
                    <h4 className="font-bold text-xs text-slate-900 mb-2">سجل الجلسات والحركات المالية:</h4>
                    <div className="overflow-x-auto touch-scroll border border-slate-200 rounded-xl">
                      <table className="w-full text-right text-xs min-w-[550px]">
                        <thead className="bg-slate-100 text-slate-700 font-bold">
                          <tr>
                            <th className="p-2.5">رقم الجلسة</th>
                            <th className="p-2.5">التاريخ</th>
                            <th className="p-2.5">سعر الصرف</th>
                            <th className="p-2.5">المستلم (بنكك SDG)</th>
                            <th className="p-2.5">المسلّم (كاش EGP)</th>
                            <th className="p-2.5">الحالة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {(!statementData.sessions || statementData.sessions.length === 0) ? (
                            <tr>
                              <td colSpan={6} className="text-center py-6 text-slate-400">
                                لا توجد عمليات أو جلسات مسجلة لهذا العميل حتى الآن
                              </td>
                            </tr>
                          ) : (
                            statementData.sessions.map((s: any) => (
                              <tr key={s.id} className="hover:bg-slate-50/80">
                                <td className="p-2.5 font-mono font-bold text-slate-800">{s.sessionNumber}</td>
                                <td className="p-2.5 font-mono text-slate-600">{s.businessDate}</td>
                                <td className="p-2.5 font-mono text-slate-600">1 = {s.exchangeRate}</td>
                                <td className="p-2.5 font-mono font-bold text-emerald-700">
                                  {Number(s.receivedAmount || 0).toLocaleString()} SDG
                                </td>
                                <td className="p-2.5 font-mono font-bold text-blue-700">
                                  {Number(s.deliveredAmount || 0).toLocaleString()} EGP
                                </td>
                                <td className="p-2.5">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      s.status === 'completed'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : s.status === 'pending_delivery'
                                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {s.status === 'completed'
                                      ? 'مكتمل ومسدد'
                                      : s.status === 'pending_delivery'
                                      ? 'قيد التسليم'
                                      : s.status}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Signatures & Official Approval Footer */}
                  <div className="pt-6 border-t border-slate-200 flex justify-between items-end text-xs text-slate-600 flex-wrap gap-4">
                    <div className="text-center flex-1 min-w-[90px]">
                      <div className="mb-8 text-[11px] font-bold">المحاسب المالي</div>
                      <div className="border-t border-dashed border-slate-400 w-28 mx-auto"></div>
                    </div>
                    <div className="text-center flex-1 min-w-[90px]">
                      <div className="mb-8 text-[11px] font-bold">المدير العام</div>
                      <div className="border-t border-dashed border-slate-400 w-28 mx-auto"></div>
                    </div>
                    <div className="text-center flex-1 min-w-[90px]">
                      <div className="mb-8 text-[11px] font-bold">توقيع واستلام العميل</div>
                      <div className="border-t border-dashed border-slate-400 w-28 mx-auto"></div>
                    </div>
                  </div>

                  <div className="text-center text-[10px] text-slate-400 pt-2 border-t border-slate-100">
                    تم استخراج هذا الكشف آلياً من نظام الصرافة والتحويلات المركزية بواسطة: {statementData.generatedBy}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
