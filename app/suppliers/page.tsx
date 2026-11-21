'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Building2,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  Search,
  Phone,
  MessageSquare,
  DollarSign,
  Layers,
} from 'lucide-react';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Supplier Modal
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Trade Modal (Buy / Sell currency with supplier)
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [tradeType, setTradeType] = useState<'BUY_SDG_PAY_EGP' | 'SELL_SDG_GET_EGP'>('BUY_SDG_PAY_EGP');
  const [sdgAmount, setSdgAmount] = useState<number | string>(10000000);
  const [rate, setRate] = useState<number | string>(200);
  const [trading, setTrading] = useState(false);

  const fetchSuppliers = () => {
    setLoading(true);
    fetch('/api/v1/suppliers')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSuppliers(data.data || []);
          if (data.data?.length > 0) setSelectedSupplierId(data.data[0].id);
        }
      })
      .finally(() => setLoading(false));

    fetch('/api/v1/supplier-transactions')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setTransactions(data.data || []);
      });
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const egpCalculated = Number(rate) > 0 ? (Number(sdgAmount || 0) / Number(rate)).toFixed(2) : 0;

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSupplier(true);
    try {
      const res = await fetch('/api/v1/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, whatsapp, address, notes }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إضافة المورد');
      }
      setNewSupplierOpen(false);
      setName('');
      setPhone('');
      fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleExecuteTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrading(true);
    try {
      const fromAmount = Number(sdgAmount);
      const toAmount = Number(egpCalculated);

      const res = await fetch('/api/v1/supplier-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: selectedSupplierId,
          transactionType: tradeType,
          fromAmount: tradeType === 'BUY_SDG_PAY_EGP' ? fromAmount : toAmount,
          toAmount: tradeType === 'BUY_SDG_PAY_EGP' ? toAmount : fromAmount,
          exchangeRate: Number(rate),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تنفيذ عملية المورد');
      }

      setTradeModalOpen(false);
      fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setTrading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">الموردون ومخزون العملات (Suppliers & Trading)</h1>
            <p className="text-sm text-slate-500">
              عمليات شراء وبيع العملات بالجملة، إدارة تكلفة العملة ومتوسط التكلفة المرجح (WAC)
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <button
              onClick={() => setTradeModalOpen(true)}
              className="flex items-center space-x-1.5 space-x-reverse bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-amber-500/20 transition-all"
            >
              <TrendingUp className="w-4 h-4" />
              <span>تنفيذ عملية شراء / بيع عملة</span>
            </button>
            <button
              onClick={() => setNewSupplierOpen(true)}
              className="flex items-center space-x-1.5 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مورد جديد</span>
            </button>
          </div>
        </div>

        {/* Suppliers List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {suppliers.map((sup) => (
            <div key={sup.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs font-bold bg-amber-50 text-amber-700 px-2 py-0.5 rounded">
                  {sup.supplierCode}
                </span>
                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  نشط
                </span>
              </div>
              <h3 className="font-bold text-base text-slate-900 mb-2">{sup.name}</h3>
              <div className="text-xs text-slate-600 space-y-1">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span dir="ltr">{sup.phone}</span>
                </div>
                {sup.address && <div>{sup.address}</div>}
              </div>
              <div className="pt-3 border-t border-slate-100 mt-4 text-xs text-slate-400">
                {sup._count?.transactions || 0} عمليات مسجلة
              </div>
            </div>
          ))}
        </div>

        {/* Supplier Transactions Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">سجل عمليات تداول العملات مع الموردين</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">رقم العملية</th>
                  <th className="p-3.5">المورد</th>
                  <th className="p-3.5">نوع العملية</th>
                  <th className="p-3.5">سعر الصرف</th>
                  <th className="p-3.5">مبلغ السوداني (SDG)</th>
                  <th className="p-3.5">مبلغ المصري (EGP)</th>
                  <th className="p-3.5">التاريخ والوقت</th>
                  <th className="p-3.5">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-slate-400">
                      لا توجد عمليات مسجلة مع الموردين حتى الآن
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-mono font-bold text-slate-900">{tx.transactionNumber}</td>
                      <td className="p-3.5 font-bold text-blue-700">{tx.supplier?.name}</td>
                      <td className="p-3.5">
                        {tx.transactionType === 'BUY_SDG_PAY_EGP' ? (
                          <span className="text-emerald-700 font-bold flex items-center space-x-1 space-x-reverse">
                            <ArrowDownLeft className="w-3.5 h-3.5" />
                            <span>شراء سوداني (دفع مصري)</span>
                          </span>
                        ) : (
                          <span className="text-blue-700 font-bold flex items-center space-x-1 space-x-reverse">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            <span>بيع سوداني (استلام مصري)</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono font-bold">1 EGP = {tx.exchangeRate} SDG</td>
                      <td className="p-3.5 font-mono font-black text-slate-900">
                        {(tx.transactionType === 'BUY_SDG_PAY_EGP' ? tx.fromAmount : tx.toAmount).toLocaleString()} SDG
                      </td>
                      <td className="p-3.5 font-mono font-bold text-slate-900">
                        {(tx.transactionType === 'BUY_SDG_PAY_EGP' ? tx.toAmount : tx.fromAmount).toLocaleString()} EGP
                      </td>
                      <td className="p-3.5 font-mono text-[11px] text-slate-500">
                        {new Date(tx.createdAt).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          مكتملة ومرحلة
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TRADE MODAL */}
        {tradeModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 border border-slate-100 text-right">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تنفيذ عملية تداول عملات مع مورد</h3>
                <button onClick={() => setTradeModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
                  ✕
                </button>
              </div>

              <form onSubmit={handleExecuteTrade} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المورد</label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.supplierCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع العملية</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTradeType('BUY_SDG_PAY_EGP')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                        tradeType === 'BUY_SDG_PAY_EGP'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      شراء سوداني (دفع مصري)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTradeType('SELL_SDG_GET_EGP')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                        tradeType === 'SELL_SDG_GET_EGP'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      بيع سوداني (استلام مصري)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ بالسوداني (SDG)</label>
                    <input
                      type="number"
                      value={sdgAmount}
                      onChange={(e) => setSdgAmount(e.target.value)}
                      required
                      placeholder="10000000"
                      className="w-full px-3 py-2 font-mono text-xs font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">سعر المورد (SDG لكل 1 EGP)</label>
                    <input
                      type="number"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      required
                      placeholder="200"
                      className="w-full px-3 py-2 font-mono text-xs font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                {/* Calculated summary */}
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span>المبلغ المقابل بالجنيه المصري:</span>
                    <span className="font-mono font-black text-base text-amber-900">
                      {Number(egpCalculated).toLocaleString()} EGP
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-700 mt-1">
                    يتم ترحيل القيد فورياً إلى سجل اليومية المركزي وتحديث رصيد الصندوقين تلقائياً.
                  </p>
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setTradeModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={trading}
                    className="px-6 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 shadow-md shadow-amber-500/20 disabled:opacity-50"
                  >
                    {trading ? 'جاري التنفيذ والتسجيل...' : 'تنفيذ وترحيل العملية'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* NEW SUPPLIER MODAL */}
        {newSupplierOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-100 text-right">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إضافة مورد جديد</h3>
                <button onClick={() => setNewSupplierOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateSupplier} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم المورد أو الشركة *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: شركة النور للتحويلات"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف *</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+201200000000"
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 text-left"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">العنوان / المقر</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="وسط البلد - القاهرة"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setNewSupplierOpen(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={savingSupplier}
                    className="px-6 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingSupplier ? 'جاري الحفظ...' : 'حفظ المورد'}
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
