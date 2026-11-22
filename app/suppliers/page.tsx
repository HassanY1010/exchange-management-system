'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Scale,
  ShieldCheck,
  Coins,
  History,
  FileText,
  UserCheck,
  UserX,
} from 'lucide-react';

export default function SuppliersPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'suppliers' | 'inventory' | 'transactions'>('overview');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [inventories, setInventories] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({});
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierStatusFilter, setSupplierStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [txTypeFilter, setTxTypeFilter] = useState<string>('all');
  const [txSupplierFilter, setTxSupplierFilter] = useState<string>('all');

  // New Supplier Modal
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Edit Supplier Modal
  const [editSupplierOpen, setEditSupplierOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWhatsapp, setEditWhatsapp] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [updatingSupplier, setUpdatingSupplier] = useState(false);

  // Trade Modal (Buy / Sell currency with supplier)
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [tradeType, setTradeType] = useState<'BUY_SDG_PAY_EGP' | 'SELL_SDG_GET_EGP'>('BUY_SDG_PAY_EGP');
  const [sdgAmount, setSdgAmount] = useState<number | string>(10000000);
  const [rate, setRate] = useState<number | string>(200);
  const [tradeNotes, setTradeNotes] = useState('');
  const [trading, setTrading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const [supRes, txRes] = await Promise.all([
        fetch('/api/v1/suppliers'),
        fetch('/api/v1/supplier-transactions'),
      ]);

      const [supData, txData] = await Promise.all([supRes.json(), txRes.json()]);

      if (supData.success) {
        setSuppliers(supData.data || []);
        if (supData.data?.length > 0 && !selectedSupplierId) {
          const firstActive = supData.data.find((s: any) => s.status === 'active') || supData.data[0];
          setSelectedSupplierId(firstActive.id);
        }
      }

      if (txData.success) {
        setTransactions(txData.data || []);
        setInventories(txData.inventories || []);
        setKpis(txData.kpis || {});
      }
    } catch (err: any) {
      console.error('Error fetching suppliers and transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
    fetch('/api/v1/exchange-rates')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data?.length > 0) {
          const suppRate = data.data.find((r: any) => r.rateType === 'supplier');
          if (suppRate && suppRate.rate > 0) setRate(Number(suppRate.rate));
        }
      })
      .catch(() => {});
  }, []);

  // SDG Inventory summary
  const sdgInventory = useMemo(() => {
    return inventories.find((i) => i.currency === 'SDG') || null;
  }, [inventories]);

  // Calculated EGP based on SDG amount and exchange rate
  const egpCalculated = useMemo(() => {
    const numSdg = Number(sdgAmount || 0);
    const numRate = Number(rate || 0);
    if (numRate <= 0) return 0;
    return (numSdg / numRate).toFixed(2);
  }, [sdgAmount, rate]);

  // Estimated COGS & Profit for Sell trade
  const sellTradeEstimates = useMemo(() => {
    if (tradeType !== 'SELL_SDG_GET_EGP') return null;
    const numSdg = Number(sdgAmount || 0);
    const numEgp = Number(egpCalculated);
    const currentWac = sdgInventory ? Number(sdgInventory.weightedAverageCost) : 0;
    const estimatedCogs = numSdg * currentWac;
    const estimatedProfit = numEgp - estimatedCogs;
    const availableStock = sdgInventory ? Number(sdgInventory.currentQuantity) : 0;
    const isExceedingStock = numSdg > availableStock;

    return {
      estimatedCogs: estimatedCogs.toFixed(2),
      estimatedProfit: estimatedProfit.toFixed(2),
      availableStock,
      isExceedingStock,
    };
  }, [tradeType, sdgAmount, egpCalculated, sdgInventory]);

  // Filtered Suppliers
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (supplierStatusFilter !== 'all' && s.status !== supplierStatusFilter) return false;
      if (supplierSearch.trim()) {
        const q = supplierSearch.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.supplierCode.toLowerCase().includes(q) ||
          s.phone.includes(q)
        );
      }
      return true;
    });
  }, [suppliers, supplierStatusFilter, supplierSearch]);

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (txTypeFilter !== 'all' && t.transactionType !== txTypeFilter) return false;
      if (txSupplierFilter !== 'all' && t.supplierId !== txSupplierFilter) return false;
      return true;
    });
  }, [transactions, txTypeFilter, txSupplierFilter]);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSupplier(true);
    setActionError(null);
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
      setWhatsapp('');
      setAddress('');
      setNotes('');
      await fetchSuppliers();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleOpenEdit = (sup: any) => {
    setEditingSupplier(sup);
    setEditName(sup.name);
    setEditPhone(sup.phone);
    setEditWhatsapp(sup.whatsapp || '');
    setEditAddress(sup.address || '');
    setEditNotes(sup.notes || '');
    setEditStatus(sup.status || 'active');
    setActionError(null);
    setEditSupplierOpen(true);
  };

  const handleUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;
    setUpdatingSupplier(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/suppliers/${editingSupplier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          phone: editPhone,
          whatsapp: editWhatsapp,
          address: editAddress,
          notes: editNotes,
          status: editStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تعديل بيانات المورد');
      }
      setEditSupplierOpen(false);
      await fetchSuppliers();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setUpdatingSupplier(false);
    }
  };

  const handleToggleStatus = async (sup: any) => {
    const newStatus = sup.status === 'active' ? 'inactive' : 'active';
    const confirmMsg =
      newStatus === 'inactive'
        ? `هل أنت متأكد من تعطيل المورد "${sup.name}"؟ لن تتمكن من اختيار هذا المورد في العمليات الجديدة حتى تعيد تفعيله.`
        : `هل أنت متأكد من إعادة تفعيل المورد "${sup.name}"؟`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/v1/suppliers/${sup.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تحديث حالة المورد');
      }
      await fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteSupplier = async (sup: any) => {
    const confirmMsg = `هل أنت متأكد من حذف المورد "${sup.name}"؟\nملاحظة: إذا كان للمورد أي عمليات تاريخية فسيتم رفض الحذف لمنع اختلال القيود المحاسبية.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/v1/suppliers/${sup.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل حذف المورد');
      }
      alert('تم حذف المورد بنجاح');
      await fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExecuteTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    if (sellTradeEstimates && sellTradeEstimates.isExceedingStock) {
      setActionError(`لا يمكن تنفيذ البيع: الرصيد المتوفر في مخزون السوداني هو ${Number(sellTradeEstimates.availableStock).toLocaleString()} SDG فقط.`);
      return;
    }

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
          notes: tradeNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تنفيذ عملية تداول العملات');
      }

      setTradeModalOpen(false);
      setTradeNotes('');
      await fetchSuppliers();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setTrading(false);
    }
  };

  const openNewTradeModal = (type: 'BUY_SDG_PAY_EGP' | 'SELL_SDG_GET_EGP', supId?: string) => {
    setTradeType(type);
    if (supId) {
      setSelectedSupplierId(supId);
    } else {
      const firstActive = suppliers.find((s) => s.status === 'active');
      if (firstActive) setSelectedSupplierId(firstActive.id);
    }
    setActionError(null);
    setTradeModalOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-amber-500/10 text-amber-600 rounded-xl">
                <Coins className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900">
                  الموردون ومخزون العملات (Suppliers & Currency Inventory)
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  إدارة مشتريات ومبيعات النقد الأجنبي بالجملة، متوسط التكلفة المرجح (WAC)، وأرباح فروق العملة
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => openNewTradeModal('BUY_SDG_PAY_EGP')}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/20 transition-all min-h-[44px]"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>شراء سوداني</span>
            </button>
            <button
              onClick={() => openNewTradeModal('SELL_SDG_GET_EGP')}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/20 transition-all min-h-[44px]"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>بيع سوداني</span>
            </button>
            <button
              onClick={() => {
                setActionError(null);
                setNewSupplierOpen(true);
              }}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مورد</span>
            </button>
            <button
              onClick={fetchSuppliers}
              disabled={loading}
              title="تحديث البيانات"
              className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-slate-200 overflow-x-auto no-scrollbar gap-1 text-xs sm:text-sm font-bold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'overview'
                ? 'border-amber-600 text-amber-600 bg-amber-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>نظرة عامة وتداول سريع</span>
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'inventory'
                ? 'border-amber-600 text-amber-600 bg-amber-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>مخزون العملات ومتوسط التكلفة WAC</span>
          </button>
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'suppliers'
                ? 'border-amber-600 text-amber-600 bg-amber-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>دليل الموردين ({suppliers.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 whitespace-nowrap transition-all min-h-[44px] ${
              activeTab === 'transactions'
                ? 'border-amber-600 text-amber-600 bg-amber-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-4 h-4" />
            <span>سجل الصفقات والعمليات ({transactions.length})</span>
          </button>
        </div>

        {/* TAB 1: OVERVIEW & LIVE METRICS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* SDG Inventory Quantity */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-bold">مخزون الجنيه السوداني</span>
                  <span className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Coins className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-slate-900 font-mono">
                  {sdgInventory ? Number(sdgInventory.currentQuantity).toLocaleString() : 0}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  SDG متاح في المخزون المركزي
                </div>
              </div>

              {/* Total Cost Base */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-bold">تكلفة المخزون الكلية</span>
                  <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                    <DollarSign className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-slate-900 font-mono">
                  {sdgInventory ? Number(sdgInventory.totalCostBase).toLocaleString() : 0}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  EGP تكلفة الشراء الإجمالية
                </div>
              </div>

              {/* WAC Metric */}
              <div className="bg-white rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/50 to-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-amber-800 mb-2">
                  <span className="text-xs font-bold">متوسط التكلفة المرجح (WAC)</span>
                  <span className="p-1.5 bg-amber-100 text-amber-700 rounded-lg">
                    <Scale className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-amber-900 font-mono">
                  {sdgInventory ? Number(sdgInventory.costPerMillion).toLocaleString() : 0}
                </div>
                <div className="text-xs text-amber-700 mt-1 font-mono">
                  EGP لكل مليون سوداني (معدل: 1 EGP = {sdgInventory?.effectiveRateSdgPerEgp || 0} SDG)
                </div>
              </div>

              {/* Total Realized Profit */}
              <div className="bg-white rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white p-5 shadow-sm">
                <div className="flex items-center justify-between text-emerald-800 mb-2">
                  <span className="text-xs font-bold">إجمالي الأرباح المحققة</span>
                  <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
                    <TrendingUp className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-emerald-700 font-mono">
                  {kpis.totalRealizedProfit ? Number(kpis.totalRealizedProfit).toLocaleString() : 0}
                </div>
                <div className="text-xs text-emerald-700 mt-1 font-mono">
                  EGP أرباح مبيعات العملة (حساب 4010)
                </div>
              </div>
            </div>

            {/* Trading Action Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-amber-950 rounded-3xl p-6 text-white shadow-xl">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-2 max-w-xl">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>محرك WAC المحاسبي الذري مفعّل</span>
                  </span>
                  <h2 className="text-lg sm:text-xl font-black">
                    تنفيذ صفقات شراء وبيع العملات بالجملة مع الموردين
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    يتم احتساب متوسط التكلفة المرجح (WAC) تلقائياً عند كل عملية شراء جديدة، ويتم تثبيت التكلفة واحتساب الأرباح الفعلية تلقائياً عند البيع وترحيلها مباشرة إلى شجرة الحسابات (حساب أرباح الصرافة 4010).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                  <button
                    onClick={() => openNewTradeModal('BUY_SDG_PAY_EGP')}
                    className="flex-1 md:flex-initial flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-emerald-900/40 min-h-[44px]"
                  >
                    <ArrowDownLeft className="w-5 h-5" />
                    <span>شراء سوداني (دفع مصري)</span>
                  </button>
                  <button
                    onClick={() => openNewTradeModal('SELL_SDG_GET_EGP')}
                    className="flex-1 md:flex-initial flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-blue-900/40 min-h-[44px]"
                  >
                    <ArrowUpRight className="w-5 h-5" />
                    <span>بيع سوداني (استلام مصري)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Summary Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Suppliers */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-amber-600" />
                    <span>أبرز الموردين النشطين</span>
                  </h3>
                  <button
                    onClick={() => setActiveTab('suppliers')}
                    className="text-xs font-bold text-amber-600 hover:text-amber-700"
                  >
                    عرض الكل &larr;
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {suppliers.slice(0, 4).map((sup) => (
                    <div key={sup.id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                            {sup.supplierCode}
                          </span>
                          <span className="font-bold text-slate-900">{sup.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5" dir="ltr">
                          {sup.phone}
                        </div>
                      </div>
                      <div className="text-left">
                        <span className="font-mono font-bold text-slate-800 block">
                          {sup.totalBoughtSdg ? Number(sup.totalBoughtSdg).toLocaleString() : 0} SDG
                        </span>
                        <button
                          onClick={() => openNewTradeModal('BUY_SDG_PAY_EGP', sup.id)}
                          className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold"
                        >
                          تداول الآن
                        </button>
                      </div>
                    </div>
                  ))}
                  {suppliers.length === 0 && (
                    <div className="text-center py-6 text-slate-400 text-xs">لا يوجد موردون مسجلون</div>
                  )}
                </div>
              </div>

              {/* Recent Trades */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                    <History className="w-4 h-4 text-blue-600" />
                    <span>آخر صفقات التداول</span>
                  </h3>
                  <button
                    onClick={() => setActiveTab('transactions')}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700"
                  >
                    عرض السجل &larr;
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {transactions.slice(0, 4).map((tx) => (
                    <div key={tx.id} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          {tx.transactionType === 'BUY_SDG_PAY_EGP' ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">
                              شراء
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700">
                              بيع
                            </span>
                          )}
                          <span className="font-bold text-slate-800">{tx.supplier?.name}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {new Date(tx.createdAt).toLocaleDateString('ar-EG')} - 1 EGP = {tx.exchangeRate} SDG
                        </div>
                      </div>
                      <div className="text-left font-mono">
                        <span className="font-black text-slate-900 block">
                          {(tx.transactionType === 'BUY_SDG_PAY_EGP' ? tx.fromAmount : tx.toAmount).toLocaleString()} SDG
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {(tx.transactionType === 'BUY_SDG_PAY_EGP' ? tx.toAmount : tx.fromAmount).toLocaleString()} EGP
                        </span>
                      </div>
                    </div>
                  ))}
                  {transactions.length === 0 && (
                    <div className="text-center py-6 text-slate-400 text-xs">لا توجد صفقات منفذة بعد</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CURRENCY INVENTORY & WAC DETAILS */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            {/* Explanation Alert */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-amber-950 text-sm">
                <Scale className="w-4 h-4 text-amber-600" />
                <span>كيف يعمل محرك متوسط التكلفة المرجح (WAC - Weighted Average Cost)؟</span>
              </div>
              <p>
                <strong>عند الشراء:</strong> يُعاد احتساب متوسط التكلفة وفق المعادلة المحاسبية المعتمدة:
                <br />
                <code className="bg-amber-100 px-2 py-0.5 rounded font-mono font-bold text-amber-950 mt-1 inline-block" dir="ltr">
                  New WAC = (Old Total Cost + Purchase Value EGP) / (Old Quantity + Purchased Quantity SDG)
                </code>
              </p>
              <p>
                <strong>عند البيع:</strong> يبقى سعر التكلفة للوحدة ثابتاً لا يتغير (Invariant)، وتُخصم تكلفة البضاعة المباعة (COGS) بمقدار <code className="bg-amber-100 px-1 font-mono">Sold Qty * WAC</code>، والفارق بين سعر البيع الفعلي وتكلفة البضاعة المباعة يُسجل فورياً كربح محقق في حساب أرباح فروق العملة (4010).
              </p>
            </div>

            {/* Currency Inventories Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-sm sm:text-base text-slate-900">سجل مخزون العملات الأجنبية والمحلية</h3>
                <span className="text-xs text-slate-400 font-mono font-bold">{inventories.length} عملة مسجلة</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">العملة</th>
                      <th className="p-3.5">عملة الأساس</th>
                      <th className="p-3.5">الكمية الحالية المتوفرة</th>
                      <th className="p-3.5">إجمالي تكلفة المخزون</th>
                      <th className="p-3.5">متوسط التكلفة للوحدة (WAC)</th>
                      <th className="p-3.5">التكلفة لكل مليون</th>
                      <th className="p-3.5">سعر آخر شراء</th>
                      <th className="p-3.5">الأرباح المحققة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {inventories.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-bold font-mono text-slate-900 flex items-center gap-1.5">
                          <Coins className="w-4 h-4 text-amber-500" />
                          <span>{inv.currency}</span>
                        </td>
                        <td className="p-3.5 font-mono text-slate-600">{inv.baseCurrency}</td>
                        <td className="p-3.5 font-mono font-black text-slate-900">
                          {Number(inv.currentQuantity).toLocaleString()} {inv.currency}
                        </td>
                        <td className="p-3.5 font-mono font-bold text-slate-900">
                          {Number(inv.totalCostBase).toLocaleString()} {inv.baseCurrency}
                        </td>
                        <td className="p-3.5 font-mono font-bold text-amber-800" dir="ltr">
                          {Number(inv.weightedAverageCost).toFixed(8)} {inv.baseCurrency}
                        </td>
                        <td className="p-3.5 font-mono font-bold text-slate-900">
                          {Number(inv.costPerMillion).toLocaleString()} {inv.baseCurrency}
                        </td>
                        <td className="p-3.5 font-mono text-slate-600">
                          {inv.lastPurchaseRate ? `1 EGP = ${inv.lastPurchaseRate} SDG` : '-'}
                        </td>
                        <td className="p-3.5 font-mono font-black text-emerald-600">
                          {Number(inv.totalRealizedProfit).toLocaleString()} {inv.baseCurrency}
                        </td>
                      </tr>
                    ))}
                    {inventories.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-10 text-slate-400">
                          لا يوجد مخزون مسجل حتى الآن
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SUPPLIERS DIRECTORY */}
        {activeTab === 'suppliers' && (
          <div className="space-y-4">
            {/* Search and Filters Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="ابحث باسم المورد، الكود، أو رقم الهاتف..."
                  className="w-full pl-3 pr-9 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={supplierStatusFilter}
                  onChange={(e: any) => setSupplierStatusFilter(e.target.value)}
                  className="px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                >
                  <option value="all">جميع الحالات</option>
                  <option value="active">النشطون فقط</option>
                  <option value="inactive">المعطلون فقط</option>
                </select>
                <button
                  onClick={() => {
                    setActionError(null);
                    setNewSupplierOpen(true);
                  }}
                  className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 transition min-h-[44px]"
                >
                  <Plus className="w-4 h-4" />
                  <span>مورد جديد</span>
                </button>
              </div>
            </div>

            {/* Suppliers Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSuppliers.map((sup) => (
                <div
                  key={sup.id}
                  className={`bg-white rounded-2xl border p-5 shadow-sm transition-all flex flex-col justify-between ${
                    sup.status === 'active' ? 'border-slate-200' : 'border-rose-200 bg-rose-50/20 opacity-75'
                  }`}
                >
                  <div>
                    {/* Top row: Code + Status Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-mono text-xs font-bold bg-amber-50 text-amber-700 px-2 py-0.5 rounded">
                        {sup.supplierCode}
                      </span>
                      {sup.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>نشط</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3 h-3" />
                          <span>معطل</span>
                        </span>
                      )}
                    </div>

                    {/* Name */}
                    <h3 className="font-black text-base text-slate-900 mb-1">{sup.name}</h3>

                    {/* Contact Info */}
                    <div className="text-xs text-slate-600 space-y-1.5 mb-4">
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <a href={`tel:${sup.phone}`} dir="ltr" className="hover:text-amber-600 font-mono font-bold">
                          {sup.phone}
                        </a>
                      </div>
                      {sup.whatsapp && (
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <a
                            href={`https://wa.me/${sup.whatsapp.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            dir="ltr"
                            className="hover:text-emerald-600 font-mono text-[11px]"
                          >
                            {sup.whatsapp}
                          </a>
                        </div>
                      )}
                      {sup.address && <div className="text-slate-500 text-[11px]">{sup.address}</div>}
                    </div>

                    {/* Financial Stats Breakdown */}
                    <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-xs border border-slate-100 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">إجمالي المشتريات منه:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {Number(sup.totalBoughtSdg || 0).toLocaleString()} SDG
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">إجمالي المبيعات له:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {Number(sup.totalSoldSdg || 0).toLocaleString()} SDG
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-1.5 border-t border-slate-200">
                        <span className="text-slate-600 font-bold">الأرباح الناتجة من صفقاته:</span>
                        <span className="font-mono font-black text-emerald-600">
                          {Number(sup.totalProfitGenerated || 0).toLocaleString()} EGP
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEdit(sup)}
                        title="تعديل المورد"
                        className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(sup)}
                        title={sup.status === 'active' ? 'تعطيل المورد' : 'تفعيل المورد'}
                        className={`p-2 rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center ${
                          sup.status === 'active'
                            ? 'text-rose-500 hover:bg-rose-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        {sup.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDeleteSupplier(sup)}
                        title="حذف المورد"
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {sup.status === 'active' ? (
                      <button
                        onClick={() => openNewTradeModal('BUY_SDG_PAY_EGP', sup.id)}
                        className="text-amber-600 hover:text-amber-700 font-bold px-2 py-1 rounded hover:bg-amber-50"
                      >
                        تداول الآن &larr;
                      </button>
                    ) : (
                      <span className="text-slate-400 text-[11px]">مورد معطل</span>
                    )}
                  </div>
                </div>
              ))}
              {filteredSuppliers.length === 0 && (
                <div className="col-span-full text-center py-12 text-slate-400 text-sm">
                  لا يوجد موردون يطابقون معايير البحث
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: TRADING TRANSACTIONS LOG */}
        {activeTab === 'transactions' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-600">تصفية حسب:</span>
                <select
                  value={txTypeFilter}
                  onChange={(e) => setTxTypeFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                >
                  <option value="all">جميع أنواع العمليات</option>
                  <option value="BUY_SDG_PAY_EGP">شراء سوداني (دفع مصري)</option>
                  <option value="SELL_SDG_GET_EGP">بيع سوداني (استلام مصري)</option>
                </select>

                <select
                  value={txSupplierFilter}
                  onChange={(e) => setTxSupplierFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                >
                  <option value="all">جميع الموردين</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="font-mono text-slate-400 font-bold">
                إجمالي المعروض: {filteredTransactions.length} عملية
              </div>
            </div>

            {/* Transactions Card/Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Mobile Cards */}
              <div className="lg:hidden divide-y divide-slate-100">
                {filteredTransactions.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-sm">لا توجد عمليات مسجلة</div>
                ) : (
                  filteredTransactions.map((tx) => (
                    <div key={tx.id} className="p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                          {tx.transactionNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          مكتملة ومرحلة
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-900">{tx.supplier?.name}</span>
                        <span className="font-mono text-[11px] text-slate-400">
                          {new Date(tx.createdAt).toLocaleDateString('ar-EG')}
                        </span>
                      </div>

                      <div>
                        {tx.transactionType === 'BUY_SDG_PAY_EGP' ? (
                          <span className="text-emerald-700 font-bold text-xs inline-flex items-center gap-1">
                            <ArrowDownLeft className="w-3.5 h-3.5 shrink-0" />
                            <span>شراء سوداني (دفع مصري)</span>
                          </span>
                        ) : (
                          <span className="text-blue-700 font-bold text-xs inline-flex items-center gap-1">
                            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                            <span>بيع سوداني (استلام مصري)</span>
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl text-xs">
                        <div>
                          <span className="text-slate-400 block text-[10px]">مبلغ السوداني</span>
                          <span className="font-mono font-bold text-slate-900">
                            {(tx.transactionType === 'BUY_SDG_PAY_EGP' ? tx.fromAmount : tx.toAmount).toLocaleString()} SDG
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">مبلغ المصري</span>
                          <span className="font-mono font-bold text-slate-900">
                            {(tx.transactionType === 'BUY_SDG_PAY_EGP' ? tx.toAmount : tx.fromAmount).toLocaleString()} EGP
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span>سعر الصرف:</span>
                        <span className="font-mono font-bold text-slate-800">1 EGP = {tx.exchangeRate} SDG</span>
                      </div>

                      {tx.profitAmount && Number(tx.profitAmount) > 0 && (
                        <div className="flex items-center justify-between text-[11px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
                          <span>الربح المحقق:</span>
                          <span className="font-mono font-black">{Number(tx.profitAmount).toLocaleString()} EGP</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3.5">رقم العملية</th>
                      <th className="p-3.5">المورد</th>
                      <th className="p-3.5">نوع العملية</th>
                      <th className="p-3.5">سعر الصرف</th>
                      <th className="p-3.5">كمية السوداني</th>
                      <th className="p-3.5">المقابل بالمصري</th>
                      <th className="p-3.5">متوسط التكلفة WAC</th>
                      <th className="p-3.5">الربح المحقق</th>
                      <th className="p-3.5">التاريخ والوقت</th>
                      <th className="p-3.5">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-mono font-bold text-slate-900">{tx.transactionNumber}</td>
                        <td className="p-3.5 font-bold text-slate-900">{tx.supplier?.name}</td>
                        <td className="p-3.5">
                          {tx.transactionType === 'BUY_SDG_PAY_EGP' ? (
                            <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                              <span>شراء سوداني</span>
                            </span>
                          ) : (
                            <span className="text-blue-700 font-bold inline-flex items-center gap-1">
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              <span>بيع سوداني</span>
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
                        <td className="p-3.5 font-mono text-slate-500" dir="ltr">
                          {tx.wacRate ? Number(tx.wacRate).toFixed(6) : '-'}
                        </td>
                        <td className="p-3.5 font-mono font-bold">
                          {tx.profitAmount && Number(tx.profitAmount) > 0 ? (
                            <span className="text-emerald-600 font-black">
                              +{Number(tx.profitAmount).toLocaleString()} EGP
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
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
                    ))}
                    {filteredTransactions.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center py-10 text-slate-400">
                          لا توجد عمليات مسجلة
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TRADE BOTTOM SHEET / MODAL */}
        {tradeModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-lg p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <div className="flex items-center gap-2">
                  <span className={`p-1.5 rounded-xl ${tradeType === 'BUY_SDG_PAY_EGP' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                    {tradeType === 'BUY_SDG_PAY_EGP' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                  </span>
                  <h3 className="font-black text-slate-900 text-base">
                    {tradeType === 'BUY_SDG_PAY_EGP' ? 'صفقة شراء سوداني بالجملة' : 'صفقة بيع سوداني بالجملة'}
                  </h3>
                </div>
                <button
                  onClick={() => setTradeModalOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {actionError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <form onSubmit={handleExecuteTrade} className="space-y-4">
                {/* Trade Type Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع العملية</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTradeType('BUY_SDG_PAY_EGP')}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all min-h-[44px] flex items-center justify-center text-center ${
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
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all min-h-[44px] flex items-center justify-center text-center ${
                        tradeType === 'SELL_SDG_GET_EGP'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      بيع سوداني (استلام مصري)
                    </button>
                  </div>
                </div>

                {/* Supplier Picker */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المورد *</label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                  >
                    {suppliers
                      .filter((s) => s.status === 'active')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.supplierCode})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Amounts and Rate */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ بالسوداني (SDG) *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={sdgAmount}
                      onChange={(e) => setSdgAmount(e.target.value)}
                      required
                      placeholder="10000000"
                      className="w-full px-3 py-2.5 font-mono text-xs sm:text-sm font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">سعر المورد (SDG لكل 1 EGP) *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      required
                      placeholder="200"
                      className="w-full px-3 py-2.5 font-mono text-xs sm:text-sm font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                    />
                  </div>
                </div>

                {/* Calculated summary and accounting impact */}
                <div
                  className={`p-4 rounded-2xl text-xs space-y-2 border ${
                    tradeType === 'BUY_SDG_PAY_EGP'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                      : 'bg-blue-50 border-blue-200 text-blue-950'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold">المبلغ المقابل بالجنيه المصري:</span>
                    <span className="font-mono font-black text-base">
                      {Number(egpCalculated).toLocaleString()} EGP
                    </span>
                  </div>

                  {tradeType === 'SELL_SDG_GET_EGP' && sellTradeEstimates && (
                    <div className="pt-2 border-t border-blue-200 space-y-1.5 font-mono">
                      <div className="flex justify-between">
                        <span className="text-slate-600">المخزون المتوفر:</span>
                        <span className={sellTradeEstimates.isExceedingStock ? 'text-rose-600 font-bold' : 'text-slate-800'}>
                          {Number(sellTradeEstimates.availableStock).toLocaleString()} SDG
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">تكلفة البضاعة المباعة (COGS):</span>
                        <span className="text-slate-800">{Number(sellTradeEstimates.estimatedCogs).toLocaleString()} EGP</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span className="text-emerald-800">الربح التقديري المحقق:</span>
                        <span className="text-emerald-700 font-black">
                          +{Number(sellTradeEstimates.estimatedProfit).toLocaleString()} EGP
                        </span>
                      </div>
                      {sellTradeEstimates.isExceedingStock && (
                        <div className="text-rose-600 font-bold text-[11px] pt-1">
                          تحذير: الكمية المطلوبة تتجاوز المخزون الفعلي المتاح! لا يمكن تنفيذ الصفقة.
                        </div>
                      )}
                    </div>
                  )}

                  {tradeType === 'BUY_SDG_PAY_EGP' && (
                    <div className="text-[11px] text-emerald-800 pt-1 border-t border-emerald-200">
                      يتم تحديث متوسط التكلفة المرجح (WAC) تلقائياً، وإضافة السوداني إلى المخزون المركزي وخصم الجنيه من خزينة النقدية الرئيسية.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الصفقة</label>
                  <input
                    type="text"
                    value={tradeNotes}
                    onChange={(e) => setTradeNotes(e.target.value)}
                    placeholder="ملاحظات اختيارية عن الصفقة أو رقم الحوالة..."
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500 min-h-[44px]"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setTradeModalOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={trading || (sellTradeEstimates?.isExceedingStock ?? false)}
                    className={`w-full sm:w-auto px-6 py-2.5 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md disabled:opacity-50 min-h-[44px] ${
                      tradeType === 'BUY_SDG_PAY_EGP'
                        ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                        : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
                    }`}
                  >
                    {trading ? 'جاري التنفيذ والتسجيل المحاسبي...' : 'تنفيذ وترحيل العملية'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* NEW SUPPLIER MODAL */}
        {newSupplierOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">إضافة مورد جديد</h3>
                <button
                  onClick={() => setNewSupplierOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {actionError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <form onSubmit={handleCreateSupplier} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم المورد أو الشركة *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: شركة النور لتجارة العملات"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف *</label>
                  <input
                    type="text"
                    inputMode="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+201200000000"
                    dir="ltr"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 text-left min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الواتساب</label>
                  <input
                    type="text"
                    inputMode="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+201200000000"
                    dir="ltr"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 text-left min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">العنوان / المقر</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="وسط البلد - القاهرة"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات إضافية</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="شروط التعامل أو أرقام حسابات بنكية..."
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setNewSupplierOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={savingSupplier}
                    className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-50 min-h-[44px]"
                  >
                    {savingSupplier ? 'جاري الحفظ...' : 'حفظ المورد'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* EDIT SUPPLIER MODAL */}
        {editSupplierOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-6 border border-slate-100 text-right max-h-[92vh] overflow-y-auto safe-area-pb">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="font-black text-slate-900 text-base">تعديل بيانات المورد</h3>
                <button
                  onClick={() => setEditSupplierOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 text-sm font-bold min-h-[44px] min-w-[44px]"
                >
                  ✕
                </button>
              </div>

              {actionError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <form onSubmit={handleUpdateSupplier} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم المورد *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف *</label>
                  <input
                    type="text"
                    inputMode="tel"
                    required
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 text-left min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الواتساب</label>
                  <input
                    type="text"
                    inputMode="tel"
                    value={editWhatsapp}
                    onChange={(e) => setEditWhatsapp(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 text-left min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">العنوان / المقر</label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الحالة</label>
                  <select
                    value={editStatus}
                    onChange={(e: any) => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  >
                    <option value="active">نشط</option>
                    <option value="inactive">معطل</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات إضافية</label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditSupplierOpen(false)}
                    className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={updatingSupplier}
                    className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 disabled:opacity-50 min-h-[44px]"
                  >
                    {updatingSupplier ? 'جاري التعديل...' : 'تحديث البيانات'}
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
