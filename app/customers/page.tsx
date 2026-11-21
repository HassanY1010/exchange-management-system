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
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">سجل وملفات العملاء (Customers)</h1>
            <p className="text-sm text-slate-500">
              إدارة بيانات العملاء، الحسابات المستمرة، استخراج كشوف الحسابات الرسمية
            </p>
          </div>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة عميل جديد</span>
          </button>
        </div>

        {/* Search */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm max-w-md">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchCustomers()}
              placeholder="بحث بالاسم، رقم الهاتف، أو كود العميل..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
        </div>

        {/* Customer Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-xs font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                    {c.customerCode}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    نشط
                  </span>
                </div>

                <h3 className="font-bold text-base text-slate-900 mb-2">{c.name}</h3>

                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center space-x-2 space-x-reverse">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span dir="ltr">{c.phone}</span>
                  </div>
                  {c.whatsapp && (
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                      <span dir="ltr">{c.whatsapp}</span>
                    </div>
                  )}
                  {c.city && <div className="text-slate-500">{c.city} - {c.address || ''}</div>}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {c._count?.sessions || 0} جلسات • {c._count?.receipts || 0} إيصالات
                </span>
                <button
                  onClick={() => openStatement(c)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center space-x-1 space-x-reverse"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>كشف الحساب</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* CREATE CUSTOMER MODAL */}
        {createModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 border border-slate-100 text-right">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إضافة عميل جديد للنظام</h3>
                <button onClick={() => setCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateCustomer} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الاسم بالكامل *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: عمر أحمد عبدالله"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف الأساسي *</label>
                    <input
                      type="text"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+249912345678"
                      dir="ltr"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم واتساب</label>
                    <input
                      type="text"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      placeholder="+249912345678"
                      dir="ltr"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 text-left"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الرقم القومي / جواز السفر</label>
                    <input
                      type="text"
                      value={identityNumber}
                      onChange={(e) => setIdentityNumber(e.target.value)}
                      placeholder="رقم الهوية"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المدينة / العنوان</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="القاهرة / الخرطوم"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:opacity-50"
                  >
                    {saving ? 'جاري الحفظ...' : 'حفظ العميل'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* PRINTABLE ACCOUNT STATEMENT MODAL (Section 26 & 34) */}
        {activeCustomer && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-8 border border-slate-100 text-right">
              {/* Actions Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-6 no-print">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">
                    كشف حساب العميل الرسمي • {activeCustomer.name}
                  </h3>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse shadow-md shadow-blue-500/20"
                  >
                    <Printer className="w-4 h-4" />
                    <span>طباعة / تصدير PDF</span>
                  </button>
                  <button
                    onClick={() => setActiveCustomer(null)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50"
                  >
                    إغلاق
                  </button>
                </div>
              </div>

              {/* Printable Document Layout */}
              <div className="print-area space-y-6">
                {/* Official Letterhead */}
                <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
                  <div>
                    <h2 className="text-xl font-black text-slate-900">شركة النجم لخدمات الصرافة والتحويلات المالية</h2>
                    <p className="text-xs text-slate-500">نظام إدارة العملات المركزية والمحاسبة</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">القاهرة • المعادي / وسط البلد • هاتف: 01000000001</p>
                  </div>
                  <div className="text-left font-mono text-xs">
                    <div className="font-bold text-slate-900">كشف حساب عميل</div>
                    <div className="text-slate-500">التاريخ: {new Date().toLocaleDateString('ar-EG')}</div>
                    <div className="text-slate-400">الكود: {activeCustomer.customerCode}</div>
                  </div>
                </div>

                {/* Customer Info Box */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-400 block mb-0.5">اسم العميل:</span>
                    <span className="font-bold text-slate-900">{activeCustomer.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">رقم الهاتف:</span>
                    <span className="font-bold text-slate-900" dir="ltr">{activeCustomer.phone}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">المدينة:</span>
                    <span className="font-bold text-slate-900">{activeCustomer.city || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">حالة الحساب:</span>
                    <span className="font-bold text-emerald-600">نشط ومعتمد</span>
                  </div>
                </div>

                {/* Sessions & Receipts Table */}
                <div>
                  <h4 className="font-bold text-xs text-slate-900 mb-2">سجل الجلسات والعمليات اليومية:</h4>
                  <table className="w-full text-right text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead className="bg-slate-100 text-slate-600 font-bold">
                      <tr>
                        <th className="p-2.5">رقم الجلسة</th>
                        <th className="p-2.5">التاريخ</th>
                        <th className="p-2.5">سعر الصرف</th>
                        <th className="p-2.5">المستلم (SDG)</th>
                        <th className="p-2.5">المسلّم نقداً (EGP)</th>
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
                            <td className="p-2.5 font-mono">1 EGP = {s.exchangeRate} SDG</td>
                            <td className="p-2.5 font-mono font-bold text-emerald-700">
                              {s.receivedAmount.toLocaleString()} SDG
                            </td>
                            <td className="p-2.5 font-mono font-bold text-blue-700">
                              {s.deliveredAmount.toLocaleString()} EGP
                            </td>
                            <td className="p-2.5 font-bold">
                              {s.status === 'completed' ? 'مسدد ومكتمل' : s.status}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Signatures & Approval Footer */}
                <div className="pt-8 border-t border-slate-200 flex justify-between items-end text-xs text-slate-600">
                  <div className="text-center">
                    <div className="mb-8">توقيع المحاسب المالي</div>
                    <div className="border-t border-dashed border-slate-400 w-36 mx-auto"></div>
                  </div>
                  <div className="text-center">
                    <div className="mb-8">ختم وتوقيع المدير العام</div>
                    <div className="border-t border-dashed border-slate-400 w-36 mx-auto"></div>
                  </div>
                  <div className="text-center">
                    <div className="mb-8">توقيع العميل المستلم</div>
                    <div className="border-t border-dashed border-slate-400 w-36 mx-auto"></div>
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
