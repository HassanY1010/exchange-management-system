'use client';

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [city, setCity] = useState('القاهرة');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Statement Modal
  const [activeCustomer, setActiveCustomer] = useState<any>(null);
  const [statementData, setStatementData] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const fetchCustomers = () => {
    setLoading(true);
    let url = '/api/v1/customers?';
    if (search) url += `q=${encodeURIComponent(search)}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setCustomers(data.data || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          secondaryPhone,
          whatsapp: whatsapp || phone,
          identityNumber,
          city,
          address,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إضافة العميل');
      }

      setCreateModalOpen(false);
      setName('');
      setPhone('');
      setSecondaryPhone('');
      setWhatsapp('');
      setAddress('');
      setNotes('');
      fetchCustomers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openStatement = async (cust: any) => {
    setActiveCustomer(cust);
    setStatementLoading(true);
    try {
      const res = await fetch(`/api/v1/customers/${cust.id}/statement`);
      const data = await res.json();
      if (data.success) {
        setStatementData(data.statement);
      }
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
              إدارة بيانات العملاء، الحسابات المستمرة، استخراج كشوف الحسابات
            </p>
          </div>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center justify-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة عميل جديد</span>
          </button>
        </div>

        {/* Search */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm w-full sm:max-w-md">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchCustomers()}
              placeholder="بحث بالاسم، الهاتف، أو كود العميل..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
          </div>
        </div>

        {/* Customer Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {customers.length === 0 && !loading && (
            <div className="col-span-full bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              لا يوجد عملاء يطابقون معايير البحث
            </div>
          )}

          {customers.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2 sm:mb-3">
                  <span className="font-mono text-xs font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                    {c.customerCode}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    نشط
                  </span>
                </div>

                <h3 className="font-bold text-base text-slate-900 mb-2 truncate">{c.name}</h3>

                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center space-x-2 space-x-reverse">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <a href={`tel:${c.phone}`} dir="ltr" className="hover:text-blue-600 truncate">{c.phone}</a>
                  </div>
                  {c.whatsapp && (
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <a href={`https://wa.me/${c.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" dir="ltr" className="hover:text-emerald-600 truncate">
                        {c.whatsapp}
                      </a>
                    </div>
                  )}
                  {c.city && <div className="text-slate-500 truncate">{c.city} - {c.address || ''}</div>}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] sm:text-xs text-slate-400 truncate">
                  {c._count?.sessions || 0} جلسات • {c._count?.receipts || 0} إيصالات
                </span>
                <button
                  onClick={() => openStatement(c)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center space-x-1 space-x-reverse min-h-[38px] shrink-0"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>كشف حساب</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* CREATE CUSTOMER MODAL / BOTTOM SHEET */}
        {createModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto touch-scroll rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <h3 className="font-black text-slate-900 text-base">إضافة عميل جديد للنظام</h3>
                <button
                  onClick={() => setCreateModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateCustomer} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الاسم بالكامل *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: عمر أحمد عبدالله"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف الأساسي *</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+249912345678"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 text-left min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم واتساب</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      placeholder="+249912345678"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 text-left min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الرقم القومي / جواز السفر</label>
                    <input
                      type="text"
                      value={identityNumber}
                      onChange={(e) => setIdentityNumber(e.target.value)}
                      placeholder="رقم الهوية"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المدينة / الفرع</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="القاهرة / الخرطوم"
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="أي ملاحظات إضافية تخص العميل..."
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500"
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
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 active:bg-blue-800 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {saving ? 'جاري الحفظ...' : 'حفظ العميل'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* PRINTABLE ACCOUNT STATEMENT MODAL */}
        {activeCustomer && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-4xl max-h-[92vh] overflow-y-auto touch-scroll p-4 sm:p-8 text-right safe-area-pb">
              {/* Actions Header */}
              <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-200 mb-4 sm:mb-6 no-print">
                <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                  <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                    كشف حساب: {activeCustomer.name}
                  </h3>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse shrink-0">
                  <button
                    onClick={() => window.print()}
                    className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse shadow-md shadow-blue-500/20 min-h-[40px]"
                  >
                    <Printer className="w-4 h-4" />
                    <span className="hidden sm:inline">طباعة / PDF</span>
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

              {/* Printable Document Layout */}
              <div className="print-area space-y-4 sm:space-y-6">
                {/* Official Letterhead */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b-2 border-slate-900 pb-3 gap-2">
                  <div>
                    <h2 className="text-base sm:text-xl font-black text-slate-900">شركة النجم لخدمات الصرافة والتحويلات المالية</h2>
                    <p className="text-xs text-slate-500">نظام إدارة العملات المركزية والمحاسبة</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">القاهرة • المعادي / وسط البلد • هاتف: 01000000001</p>
                  </div>
                  <div className="text-right sm:text-left font-mono text-xs border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                    <div className="font-bold text-slate-900">كشف حساب عميل</div>
                    <div className="text-slate-500">التاريخ: {new Date().toLocaleDateString('ar-EG')}</div>
                    <div className="text-slate-400">الكود: {activeCustomer.customerCode}</div>
                  </div>
                </div>

                {/* Customer Info Box */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px]">اسم العميل:</span>
                    <span className="font-bold text-slate-900 truncate block">{activeCustomer.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">رقم الهاتف:</span>
                    <span className="font-bold text-slate-900" dir="ltr">{activeCustomer.phone}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">المدينة:</span>
                    <span className="font-bold text-slate-900">{activeCustomer.city || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">الحالة:</span>
                    <span className="font-bold text-emerald-600">نشط ومعتمد</span>
                  </div>
                </div>

                {/* Sessions & Receipts Table with Horizontal Scroll Safe wrapper */}
                <div>
                  <h4 className="font-bold text-xs text-slate-900 mb-2">سجل الجلسات والعمليات اليومية:</h4>
                  <div className="overflow-x-auto touch-scroll border border-slate-200 rounded-xl">
                    <table className="w-full text-right text-xs min-w-[500px]">
                      <thead className="bg-slate-100 text-slate-600 font-bold">
                        <tr>
                          <th className="p-2.5">رقم الجلسة</th>
                          <th className="p-2.5">التاريخ</th>
                          <th className="p-2.5">سعر الصرف</th>
                          <th className="p-2.5">المستلم (SDG)</th>
                          <th className="p-2.5">المسلّم (EGP)</th>
                          <th className="p-2.5">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {(!statementData?.sessions || statementData.sessions.length === 0) ? (
                          <tr>
                            <td colSpan={6} className="text-center py-6 text-slate-400">
                              لا توجد عمليات مسجلة للعميل حتى الآن
                            </td>
                          </tr>
                        ) : (
                          statementData.sessions.map((s: any) => (
                            <tr key={s.id}>
                              <td className="p-2.5 font-mono">{s.sessionNumber}</td>
                              <td className="p-2.5 font-mono">{s.businessDate}</td>
                              <td className="p-2.5 font-mono">1 = {s.exchangeRate}</td>
                              <td className="p-2.5 font-mono font-bold text-emerald-700">
                                {s.receivedAmount.toLocaleString()} SDG
                              </td>
                              <td className="p-2.5 font-mono font-bold text-blue-700">
                                {s.deliveredAmount.toLocaleString()} EGP
                              </td>
                              <td className="p-2.5 font-bold">
                                {s.status === 'completed' ? 'مسدد' : s.status}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Signatures & Approval Footer */}
                <div className="pt-6 border-t border-slate-200 flex justify-between items-end text-xs text-slate-600 flex-wrap gap-4">
                  <div className="text-center flex-1 min-w-[90px]">
                    <div className="mb-6 text-[11px]">المحاسب المالي</div>
                    <div className="border-t border-dashed border-slate-400 w-24 mx-auto"></div>
                  </div>
                  <div className="text-center flex-1 min-w-[90px]">
                    <div className="mb-6 text-[11px]">المدير العام</div>
                    <div className="border-t border-dashed border-slate-400 w-24 mx-auto"></div>
                  </div>
                  <div className="text-center flex-1 min-w-[90px]">
                    <div className="mb-6 text-[11px]">توقيع العميل</div>
                    <div className="border-t border-dashed border-slate-400 w-24 mx-auto"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
