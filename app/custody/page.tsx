'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  Users,
  Plus,
  Send,
  Search,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Wallet,
  History,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  FileText,
  Edit2,
  UserCheck,
  UserX,
  Scale,
} from 'lucide-react';

export default function CustodyPage() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'custodies' | 'employees' | 'transactions'>('custodies');
  const [custodies, setCustodies] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [newCustodyOpen, setNewCustodyOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [custodyAmount, setCustodyAmount] = useState<number | string>(500000);
  const [custodyCurrency, setCustodyCurrency] = useState('EGP');
  const [custodyNotes, setCustodyNotes] = useState('');
  const [custodyModalError, setCustodyModalError] = useState('');
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

  // Return to Safe Modal
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnAmount, setReturnAmount] = useState<number | string>('');
  const [returnNotes, setReturnNotes] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState('');

  // Settle & Close Modal
  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState('');

  // History Modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyCustody, setHistoryCustody] = useState<any>(null);

  // Employee Modal
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empJobTitle, setEmpJobTitle] = useState('');
  const [empIdentity, setEmpIdentity] = useState('');
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [empError, setEmpError] = useState('');

  // Toast / Status Message
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchCustodies = async () => {
    try {
      const res = await fetch('/api/v1/custody');
      const data = await res.json();
      if (data.success) {
        setCustodies(data.data || []);
        if (data.summary) setSummary(data.summary);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/v1/employees');
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data || []);
        if (data.data?.length > 0 && !selectedEmpId) {
          const activeFirst = data.data.find((e: any) => e.status === 'active');
          if (activeFirst) setSelectedEmpId(activeFirst.id);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([
      fetchCustodies(),
      fetchEmployees(),
      fetch('/api/v1/customers')
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            setCustomers(d.data || []);
            if (d.data?.length > 0) setDeliverCustomerId(d.data[0].id);
          }
        }),
      fetch('/api/v1/customer-sessions?status=open')
        .then((r) => r.json())
        .then((d) => {
          if (d.success) setSessions(d.data || []);
        }),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    setMounted(true);
    loadAll();
  }, []);

  // Filtered Custodies
  const filteredCustodies = useMemo(() => {
    return custodies.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const empNameMatch = c.employee?.name?.toLowerCase().includes(q);
        const empCodeMatch = c.employee?.employeeCode?.toLowerCase().includes(q);
        const dateMatch = c.businessDate?.includes(q);
        return empNameMatch || empCodeMatch || dateMatch;
      }
      return true;
    });
  }, [custodies, statusFilter, searchQuery]);

  // All Custody Transactions for Log Tab
  const allTransactions = useMemo(() => {
    const list: any[] = [];
    for (const c of custodies) {
      for (const t of c.transactions || []) {
        list.push({
          ...t,
          employeeName: c.employee?.name,
          employeeCode: c.employee?.employeeCode,
          custodyBusinessDate: c.businessDate,
        });
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [custodies]);

  // Issue Custody
  const handleIssueCustody = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCustody(true);
    setErrorMessage('');
    setCustodyModalError('');
    setStatusMessage('');

    try {
      const numAmount = Number(custodyAmount);
      if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
        throw new Error('يرجى إدخال مبلغ صحيح للعهدة أكبر من صفر');
      }
      if (!selectedEmpId) {
        throw new Error('يرجى اختيار الموظف المستلم للعهدة');
      }

      const res = await fetch('/api/v1/custody', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmpId,
          amount: numAmount,
          currency: custodyCurrency,
          notes: custodyNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسليم العهدة');
      }

      setNewCustodyOpen(false);
      setCustodyNotes('');
      setCustodyModalError('');
      setStatusMessage('تم تسليم العهدة النقدية بنجاح وخصمها من الخزينة');
      await Promise.all([fetchCustodies(), fetchEmployees()]);
    } catch (err: any) {
      setCustodyModalError(err.message || 'فشل تسليم العهدة');
      setErrorMessage(err.message);
    } finally {
      setSubmittingCustody(false);
    }
  };

  // Deliver Cash to Customer
  const handleDeliverCash = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeliverError('');
    if (!activeCustody) return;

    const numAmount = Number(deliverAmount);
    if (numAmount > Number(activeCustody.currentAmount)) {
      setDeliverError(
        `تنبيه: المبلغ المطلوب تسليمه (${numAmount.toLocaleString()} ${activeCustody.currency}) أكبر من رصيد العهدة المتاح (${Number(activeCustody.currentAmount).toLocaleString()} ${activeCustody.currency})`
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
      setStatusMessage('تم صرف النقدية للعميل وتحديث رصيد العهدة والقيد المحاسبي بنجاح');
      await Promise.all([fetchCustodies(), fetchEmployees()]);
    } catch (err: any) {
      setDeliverError(err.message);
    } finally {
      setDelivering(false);
    }
  };

  // Return to Safe
  const handleReturnToSafe = async (e: React.FormEvent) => {
    e.preventDefault();
    setReturnError('');
    if (!activeCustody) return;

    const numAmount = Number(returnAmount);
    if (numAmount > Number(activeCustody.currentAmount)) {
      setReturnError(
        `تنبيه: المبلغ المراد استرجاعه (${numAmount.toLocaleString()}) أكبر من رصيد العهدة المتبقي (${Number(activeCustody.currentAmount).toLocaleString()})`
      );
      return;
    }

    setReturning(true);
    try {
      const res = await fetch(`/api/v1/custody/${activeCustody.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numAmount,
          notes: returnNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل استرجاع المبلغ للخزينة');
      }

      setReturnModalOpen(false);
      setActiveCustody(null);
      setReturnNotes('');
      setStatusMessage(data.message || 'تم استرجاع المبلغ للخزينة بنجاح');
      await Promise.all([fetchCustodies(), fetchEmployees()]);
    } catch (err: any) {
      setReturnError(err.message);
    } finally {
      setReturning(false);
    }
  };

  // Settle & Close Custody
  const handleSettleCustody = async () => {
    if (!activeCustody) return;
    setSettling(true);
    setSettleError('');

    try {
      const res = await fetch(`/api/v1/custody/${activeCustody.id}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRemainingToSafe: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسوية وإغلاق العهدة');
      }

      setSettleModalOpen(false);
      setActiveCustody(null);
      setStatusMessage(data.message || 'تمت تسوية وإغلاق العهدة بنجاح');
      await Promise.all([fetchCustodies(), fetchEmployees()]);
    } catch (err: any) {
      setSettleError(err.message);
    } finally {
      setSettling(false);
    }
  };

  // Save / Edit Employee
  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmployee(true);
    setEmpError('');

    try {
      const url = editingEmployee ? `/api/v1/employees/${editingEmployee.id}` : '/api/v1/employees';
      const method = editingEmployee ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: empName,
          phone: empPhone,
          jobTitle: empJobTitle,
          identityNumber: empIdentity,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل حفظ بيانات الموظف');
      }

      setEmployeeModalOpen(false);
      setEditingEmployee(null);
      setEmpName('');
      setEmpPhone('');
      setEmpJobTitle('');
      setEmpIdentity('');
      setStatusMessage(editingEmployee ? 'تم تعديل بيانات الموظف بنجاح' : 'تمت إضافة الموظف الجديد بنجاح');
      await fetchEmployees();
    } catch (err: any) {
      setEmpError(err.message);
    } finally {
      setSavingEmployee(false);
    }
  };

  // Toggle Employee Status
  const handleToggleEmployeeStatus = async (emp: any) => {
    const newStatus = emp.status === 'active' ? 'inactive' : 'active';
    const actionText = newStatus === 'active' ? 'تنشيط' : 'إيقاف';
    if (!confirm(`هل أنت متأكد من ${actionText} الموظف ${emp.name}؟`)) return;

    try {
      const res = await fetch(`/api/v1/employees/${emp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تعديل حالة الموظف');
      }
      setStatusMessage(`تم ${actionText} الموظف ${emp.name} بنجاح`);
      await fetchEmployees();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>عهدة مفتوحة</span>
          </span>
        );
      case 'partially_settled':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
            <Scale className="w-3 h-3 text-amber-600" />
            <span>مسواة جزئياً</span>
          </span>
        );
      case 'closed':
      case 'settled':
      default:
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
            <Lock className="w-3 h-3 text-slate-500" />
            <span>مغلقة ومسواة</span>
          </span>
        );
    }
  };

  const getTxnTypeLabel = (type: string) => {
    switch (type) {
      case 'delivery_to_customer':
        return { label: 'صرف لعميل', color: 'bg-blue-100 text-blue-800' };
      case 'safe_refill':
        return { label: 'استلام أولى / تغذية', color: 'bg-emerald-100 text-emerald-800' };
      case 'return_to_safe':
        return { label: 'استرجاع للخزينة', color: 'bg-purple-100 text-purple-800' };
      case 'adjustment':
        return { label: 'تسوية رصيد', color: 'bg-amber-100 text-amber-800' };
      default:
        return { label: type, color: 'bg-slate-100 text-slate-800' };
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">الموظفون والعهد المالية</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              إدارة عهد الموظفين النقدية، تسجيل صرف الكاش للعملاء، استرجاع المتبقي، والتسوية المحاسبية
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2">
            <button
              onClick={() => {
                setEditingEmployee(null);
                setEmpName('');
                setEmpPhone('');
                setEmpJobTitle('');
                setEmpIdentity('');
                setEmployeeModalOpen(true);
              }}
              className="flex items-center justify-center space-x-1.5 space-x-reverse bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-sm transition-all min-h-[42px]"
            >
              <Users className="w-4 h-4 text-indigo-600" />
              <span>إضافة موظف</span>
            </button>
            <button
              onClick={() => {
                setCustodyModalError('');
                setNewCustodyOpen(true);
              }}
              className="flex items-center justify-center space-x-2 space-x-reverse bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-indigo-500/20 transition-all min-h-[42px]"
            >
              <Plus className="w-4 h-4" />
              <span>تسليم عهدة جديدة</span>
            </button>
          </div>
        </div>

        {/* Global Notifications */}
        {statusMessage && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-between shadow-sm animate-fade-in">
            <div className="flex items-center space-x-2 space-x-reverse">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage('')} className="p-1 hover:text-emerald-950">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-between shadow-sm animate-fade-in">
            <div className="flex items-center space-x-2 space-x-reverse">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage('')} className="p-1 hover:text-rose-950">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* High-level KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm">
            <span className="text-[11px] text-slate-500 block mb-0.5 font-bold">العهد المفتوحة حالياً</span>
            <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono">
              {summary.openCount ?? 0}
            </span>
            <span className="text-[10px] text-slate-400 block mt-1">من إجمالي {summary.totalCustodies ?? 0} عهدة</span>
          </div>

          <div className="bg-emerald-50/80 p-3.5 sm:p-4 rounded-2xl border border-emerald-200 shadow-sm">
            <span className="text-[11px] text-emerald-800 block mb-0.5 font-bold">رصيد العهد المتاح بالخارج</span>
            <span className="text-lg sm:text-2xl font-black text-emerald-900 font-mono">
              {Number(summary.totalOpenAmountEGP || 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-emerald-700 block mt-1 font-bold">جنيه مصري (EGP)</span>
          </div>

          <div className="bg-blue-50/80 p-3.5 sm:p-4 rounded-2xl border border-blue-200 shadow-sm">
            <span className="text-[11px] text-blue-800 block mb-0.5 font-bold">إجمالي المصروف للعملاء</span>
            <span className="text-lg sm:text-2xl font-black text-blue-900 font-mono">
              {Number(summary.totalDeliveredAmountEGP || 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-blue-700 block mt-1 font-bold">جنيه مصري (EGP)</span>
          </div>

          <div className="bg-purple-50/80 p-3.5 sm:p-4 rounded-2xl border border-purple-200 shadow-sm">
            <span className="text-[11px] text-purple-800 block mb-0.5 font-bold">الموظفون النشطون</span>
            <span className="text-xl sm:text-2xl font-black text-purple-900 font-mono">
              {employees.filter((e) => e.status === 'active').length}
            </span>
            <span className="text-[10px] text-purple-700 block mt-1">من أصل {employees.length} موظف مسجل</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1.5 space-x-reverse border-b border-slate-200 pb-2">
          <button
            onClick={() => setActiveTab('custodies')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[40px] flex items-center space-x-1.5 space-x-reverse ${
              activeTab === 'custodies'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span>العهد النقدية ({custodies.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('employees')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[40px] flex items-center space-x-1.5 space-x-reverse ${
              activeTab === 'employees'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>دليل الموظفين ({employees.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[40px] flex items-center space-x-1.5 space-x-reverse ${
              activeTab === 'transactions'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <History className="w-4 h-4" />
            <span>سجل العمليات العام ({allTransactions.length})</span>
          </button>
        </div>

        {/* ================= TAB 1: CUSTODIES ================= */}
        {activeTab === 'custodies' && (
          <div className="space-y-4">
            {/* Filter Pills & Search */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-1.5 space-x-reverse overflow-x-auto touch-scroll pb-1">
                <button
                  onClick={() => setStatusFilter('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    statusFilter === '' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  الكل ({custodies.length})
                </button>
                <button
                  onClick={() => setStatusFilter('open')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    statusFilter === 'open'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  عهد مفتوحة ({custodies.filter((c) => c.status === 'open').length})
                </button>
                <button
                  onClick={() => setStatusFilter('closed')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    statusFilter === 'closed'
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  مغلقة ومسواة ({custodies.filter((c) => c.status === 'closed' || c.status === 'settled').length})
                </button>
              </div>

              <div className="relative min-w-[200px] sm:w-64">
                <input
                  type="text"
                  placeholder="بحث باسم الموظف أو التاريخ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                />
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
              </div>
            </div>

            {/* Custody Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
              {filteredCustodies.length === 0 && !loading && (
                <div className="col-span-full bg-white rounded-3xl border border-slate-200 p-10 text-center text-slate-400 text-xs sm:text-sm">
                  لا توجد عهد مطابقة لشروط البحث
                </div>
              )}

              {filteredCustodies.map((c) => {
                const totalDelivered = Number(c.openingAmount) - Number(c.currentAmount);
                const isOpen = c.status === 'open';

                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-mono text-xs font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg">
                          {c.businessDate}
                        </span>
                        {getStatusBadge(c.status)}
                      </div>

                      <div className="mb-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-base text-slate-900 truncate">{c.employee?.name}</h3>
                          <span className="text-[11px] font-mono text-slate-400 font-bold">{c.employee?.employeeCode}</span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{c.employee?.jobTitle}</p>
                      </div>

                      {/* Financial Breakdown */}
                      <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1.5 mb-3 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">العهدة الافتتاحية:</span>
                          <span className="font-mono font-bold text-slate-900">
                            {Number(c.openingAmount).toLocaleString()} {c.currency}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">المصروف للعملاء:</span>
                          <span className="font-mono font-bold text-rose-600">
                            -{totalDelivered.toLocaleString()} {c.currency}
                          </span>
                        </div>
                        <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                          <span className="font-bold text-slate-900">الرصيد المتبقي:</span>
                          <span className={`font-mono font-black text-sm sm:text-base ${
                            Number(c.currentAmount) > 0 ? 'text-indigo-600' : 'text-slate-500'
                          }`}>
                            {Number(c.currentAmount).toLocaleString()} {c.currency}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            setActiveCustody(c);
                            setDeliverAmount(Number(c.currentAmount));
                            setDeliverModalOpen(true);
                          }}
                          disabled={!isOpen || Number(c.currentAmount) <= 0}
                          className="py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1 space-x-reverse shadow-sm transition-colors min-h-[40px] disabled:opacity-40"
                        >
                          <Send className="w-3.5 h-3.5 shrink-0" />
                          <span>صرف لعميل</span>
                        </button>

                        <button
                          onClick={() => {
                            setActiveCustody(c);
                            setReturnAmount(Number(c.currentAmount));
                            setReturnModalOpen(true);
                          }}
                          disabled={!isOpen || Number(c.currentAmount) <= 0}
                          className="py-2.5 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1 space-x-reverse shadow-sm transition-colors min-h-[40px] disabled:opacity-40"
                        >
                          <ArrowDownLeft className="w-3.5 h-3.5 shrink-0" />
                          <span>إرجاع للخزينة</span>
                        </button>
                      </div>

                      <div className="flex items-center space-x-2 space-x-reverse">
                        {isOpen && (
                          <button
                            onClick={() => {
                              setActiveCustody(c);
                              setSettleModalOpen(true);
                            }}
                            className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1 space-x-reverse transition-colors min-h-[38px]"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span>تسوية وإغلاق</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setHistoryCustody(c);
                            setHistoryModalOpen(true);
                          }}
                          className={`py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center space-x-1 space-x-reverse transition-colors min-h-[38px] ${
                            !isOpen ? 'w-full' : ''
                          }`}
                        >
                          <History className="w-3.5 h-3.5 text-slate-500" />
                          <span>السجل ({c.transactions?.length || 0})</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= TAB 2: EMPLOYEES ================= */}
        {activeTab === 'employees' && (
          <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-black text-base sm:text-lg text-slate-900">سجل موظفي التسليم والعهد</h3>
                <p className="text-xs text-slate-500">إدارة بيانات الموظفين ومتابعة إجمالي العهد المصروفة والمتبقية</p>
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto touch-scroll">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold bg-slate-50/50">
                    <th className="py-3 px-3">كود الموظف</th>
                    <th className="py-3 px-3">الاسم والوظيفة</th>
                    <th className="py-3 px-3">رقم الهاتف</th>
                    <th className="py-3 px-3">الحالة</th>
                    <th className="py-3 px-3">العهد المفتوحة</th>
                    <th className="py-3 px-3">الرصيد المتاح حالياً</th>
                    <th className="py-3 px-3">إجمالي المسلم للعملاء</th>
                    <th className="py-3 px-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">{emp.employeeCode}</td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{emp.name}</div>
                        <div className="text-[11px] text-slate-400">{emp.jobTitle}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600">{emp.phone}</td>
                      <td className="py-3 px-3">
                        {emp.status === 'active' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            نشط
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            موقوف
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold">
                        {emp.stats?.openCustodiesCount > 0 ? (
                          <span className="text-emerald-600 font-bold">{emp.stats.openCustodiesCount} عهدة</span>
                        ) : (
                          <span className="text-slate-400">لا يوجد</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-indigo-600">
                        {Number(emp.stats?.activeCustodyBalance || 0).toLocaleString()} EGP
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">
                        {Number(emp.stats?.totalDeliveredToCustomers || 0).toLocaleString()} EGP
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center space-x-1 space-x-reverse">
                          <button
                            onClick={() => {
                              setEditingEmployee(emp);
                              setEmpName(emp.name);
                              setEmpPhone(emp.phone);
                              setEmpJobTitle(emp.jobTitle || '');
                              setEmpIdentity(emp.identityNumber || '');
                              setEmployeeModalOpen(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="تعديل"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleEmployeeStatus(emp)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              emp.status === 'active'
                                ? 'text-amber-600 hover:bg-amber-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={emp.status === 'active' ? 'إيقاف الموظف' : 'تنشيط الموظف'}
                          >
                            {emp.status === 'active' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {employees.map((emp) => (
                <div key={emp.id} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{emp.name}</h4>
                      <span className="text-[11px] font-mono text-slate-400 font-bold">{emp.employeeCode}</span>
                    </div>
                    {emp.status === 'active' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        نشط
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                        موقوف
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-200">
                    <div>
                      <span className="text-slate-500 block text-[10px]">الرصيد المتاح:</span>
                      <span className="font-mono font-bold text-indigo-600">
                        {Number(emp.stats?.activeCustodyBalance || 0).toLocaleString()} EGP
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">المسلم للعملاء:</span>
                      <span className="font-mono font-bold text-slate-800">
                        {Number(emp.stats?.totalDeliveredToCustomers || 0).toLocaleString()} EGP
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2 border-t border-slate-200">
                    <button
                      onClick={() => {
                        setEditingEmployee(emp);
                        setEmpName(emp.name);
                        setEmpPhone(emp.phone);
                        setEmpJobTitle(emp.jobTitle || '');
                        setEmpIdentity(emp.identityNumber || '');
                        setEmployeeModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-bold"
                    >
                      تعديل
                    </button>
                    <button
                      onClick={() => handleToggleEmployeeStatus(emp)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                        emp.status === 'active' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {emp.status === 'active' ? 'إيقاف' : 'تنشيط'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= TAB 3: TRANSACTIONS LOG ================= */}
        {activeTab === 'transactions' && (
          <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm">
            <h3 className="font-black text-base sm:text-lg text-slate-900 mb-1">سجل عمليات العهد النقدية</h3>
            <p className="text-xs text-slate-500 mb-4">كشف زمني بجميع حركات الصرف والاسترجاع والتغذية</p>

            <div className="space-y-2.5">
              {allTransactions.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-xs">لا توجد عمليات مسجلة حتى الآن</div>
              )}

              {allTransactions.map((t) => {
                const badge = getTxnTypeLabel(t.transactionType);
                return (
                  <div
                    key={t.id}
                    className="p-3 sm:p-3.5 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center space-x-2.5 space-x-reverse min-w-0">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0 ${badge.color}`}>
                        {badge.label}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">
                          {t.description || 'حركة عهدة نقدية'}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          عهدة: {t.employeeName} • {new Date(t.createdAt).toLocaleString('ar-EG')}
                        </div>
                      </div>
                    </div>

                    <div className="text-left font-mono shrink-0">
                      <span className="font-black text-sm text-slate-900">
                        {Number(t.amount).toLocaleString()} {t.currency}
                      </span>
                      <span className="text-[10px] text-slate-400 block font-sans">بواسطة: {t.createdBy}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= MODAL: ISSUE NEW CUSTODY ================= */}
        {newCustodyOpen && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white w-full sm:max-w-md max-h-[85dvh] sm:max-h-[90dvh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden text-right">
              {/* Header - Fixed */}
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div>
                  <h3 className="font-black text-slate-900 text-base">تسليم عهدة نقدية جديدة</h3>
                  <p className="text-[11px] text-slate-500">صرف عهدة نقدية للموظف من الصندوق</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewCustodyOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Inline Modal Error */}
              {custodyModalError && (
                <div className="mx-4 sm:mx-5 mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{custodyModalError}</span>
                </div>
              )}

              {/* Scrollable Form Body */}
              <form id="new-custody-form" onSubmit={handleIssueCustody} className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الموظف المستلم للعهدة *</label>
                  <select
                    value={selectedEmpId}
                    onChange={(e) => setSelectedEmpId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  >
                    {employees
                      .filter((e) => e.status === 'active')
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.employeeCode}) - {emp.jobTitle}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العملة *</label>
                    <select
                      value={custodyCurrency}
                      onChange={(e) => setCustodyCurrency(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm font-bold rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    >
                      <option value="EGP">جنيه مصري (EGP)</option>
                      <option value="SDG">جنيه سوداني (SDG)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">مبلغ العهدة *</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={custodyAmount}
                      onChange={(e) => setCustodyAmount(e.target.value)}
                      required
                      min={1}
                      placeholder="500000"
                      className="w-full px-3.5 py-2.5 font-mono text-sm font-bold rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات تسليم العهدة</label>
                  <input
                    type="text"
                    value={custodyNotes}
                    onChange={(e) => setCustodyNotes(e.target.value)}
                    placeholder="مثال: تسليم عهدة نقدية لبداية اليوم"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    يتم التحقق من توفر رصيد كافٍ في الخزينة وخصم المبلغ وتوثيق القيد المحاسبي آلياً
                  </p>
                </div>
              </form>

              {/* Action Buttons - Fixed/Pinned at Bottom */}
              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setNewCustodyOpen(false)}
                  disabled={submittingCustody}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  form="new-custody-form"
                  disabled={submittingCustody || !custodyAmount || Number(custodyAmount) <= 0 || !selectedEmpId}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-indigo-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {submittingCustody && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{submittingCustody ? 'جاري التسليم...' : 'تأكيد تسليم العهدة'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ================= MODAL: DELIVER CASH TO CUSTOMER ================= */}
        {deliverModalOpen && activeCustody && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">تسليم نقدية لعميل من العهدة</h3>
                  <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                    عهدة: {activeCustody.employee?.name} • المتاح:{' '}
                    {Number(activeCustody.currentAmount).toLocaleString()} {activeCustody.currency}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeliverModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {deliverError && (
                <div className="mx-4 sm:mx-5 mt-3 p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2 space-x-reverse shrink-0">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{deliverError}</span>
                </div>
              )}

              <form id="deliver-cash-form" onSubmit={handleDeliverCash} className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
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
                        {s.sessionNumber} - {s.customer?.name} (متبقي:{' '}
                        {(Number(s.requestedAmount) - Number(s.deliveredAmount)).toLocaleString()} EGP)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المراد صرفه ({activeCustody.currency}) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={deliverAmount}
                    onChange={(e) => setDeliverAmount(e.target.value)}
                    required
                    min={1}
                    placeholder="100000"
                    max={Number(activeCustody.currentAmount)}
                    className="w-full px-3.5 py-2.5 font-mono text-sm font-black rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 mt-1 flex-wrap gap-1">
                    <span>المتاح: {Number(activeCustody.currentAmount).toLocaleString()} {activeCustody.currency}</span>
                    <span className="text-blue-600 font-bold">
                      المتبقي بعد الصرف:{' '}
                      {(Number(activeCustody.currentAmount) - Number(deliverAmount || 0)).toLocaleString()}{' '}
                      {activeCustody.currency}
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
              </form>

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setDeliverModalOpen(false)}
                  disabled={delivering}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  form="deliver-cash-form"
                  disabled={delivering || !deliverAmount || Number(deliverAmount) <= 0 || !deliverCustomerId}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {delivering && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{delivering ? 'جاري التسليم...' : 'تأكيد التسليم للعميل'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ================= MODAL: RETURN CASH TO SAFE ================= */}
        {returnModalOpen && activeCustody && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 text-base truncate">استرجاع نقدية إلى الخزينة</h3>
                  <p className="text-xs text-slate-500">
                    عهدة: {activeCustody.employee?.name} • المتبقي:{' '}
                    {Number(activeCustody.currentAmount).toLocaleString()} {activeCustody.currency}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReturnModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {returnError && (
                <div className="mx-4 sm:mx-5 mt-3 p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2 space-x-reverse shrink-0">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{returnError}</span>
                </div>
              )}

              <form id="return-cash-form" onSubmit={handleReturnToSafe} className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المراد استرجاعه للخزينة *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={returnAmount}
                    onChange={(e) => setReturnAmount(e.target.value)}
                    required
                    min={1}
                    max={Number(activeCustody.currentAmount)}
                    placeholder="مبلغ الاسترجاع"
                    className="w-full px-3.5 py-2.5 font-mono text-sm font-black rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 min-h-[44px]"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                    <span>المتبقي في العهدة: {Number(activeCustody.currentAmount).toLocaleString()} {activeCustody.currency}</span>
                    <button
                      type="button"
                      onClick={() => setReturnAmount(Number(activeCustody.currentAmount))}
                      className="text-purple-600 font-bold hover:underline"
                    >
                      استرجاع كامل الرصيد
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الاسترجاع</label>
                  <input
                    type="text"
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="مثال: توريد متبقي عهدة نهاية اليوم"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 min-h-[44px]"
                  />
                </div>

              </form>

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setReturnModalOpen(false)}
                  disabled={returning}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  form="return-cash-form"
                  disabled={returning || !returnAmount || Number(returnAmount) <= 0}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-purple-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {returning && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{returning ? 'جاري الاسترجاع...' : 'تأكيد الاسترجاع للخزينة'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ================= MODAL: SETTLE & CLOSE CUSTODY ================= */}
        {settleModalOpen && activeCustody && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <h3 className="font-black text-slate-900 text-base">تسوية وإغلاق العهدة النقدية</h3>
                <button
                  type="button"
                  onClick={() => setSettleModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {settleError && (
                <div className="mx-4 sm:mx-5 mt-3 p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2 space-x-reverse shrink-0">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{settleError}</span>
                </div>
              )}

              <div className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">الموظف المسؤول:</span>
                    <span className="font-bold text-slate-900">{activeCustody.employee?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">تاريخ العهدة:</span>
                    <span className="font-mono font-bold text-slate-800">{activeCustody.businessDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">العهدة الافتتاحية:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {Number(activeCustody.openingAmount).toLocaleString()} {activeCustody.currency}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">إجمالي المصروف للعملاء:</span>
                    <span className="font-mono font-bold text-rose-600">
                      {(Number(activeCustody.openingAmount) - Number(activeCustody.currentAmount)).toLocaleString()}{' '}
                      {activeCustody.currency}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between">
                    <span className="font-black text-slate-900">الرصيد المتبقي للاسترجاع:</span>
                    <span className="font-mono font-black text-indigo-600 text-sm">
                      {Number(activeCustody.currentAmount).toLocaleString()} {activeCustody.currency}
                    </span>
                  </div>
                </div>

                {Number(activeCustody.currentAmount) > 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                    سيتم تلقائياً استرجاع الرصيد المتبقي (
                    {Number(activeCustody.currentAmount).toLocaleString()} {activeCustody.currency}) إلى الخزينة
                    الرئيسية وتسجيل قيد الاسترجاع الدفتري، ثم إغلاق العهدة نهائياً.
                  </p>
                ) : (
                  <p className="text-xs text-emerald-700 bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                    رصيد العهدة مطابق تماماً ومستوفى بالكامل (0 {activeCustody.currency}). سيتم إغلاق العهدة وتوثيق التسوية.
                  </p>
                )}
              </div>

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setSettleModalOpen(false)}
                  disabled={settling}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSettleCustody}
                  disabled={settling}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {settling && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{settling ? 'جاري التسوية...' : 'تأكيد التسوية والإغلاق'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ================= MODAL: CUSTODY HISTORY ================= */}
        {historyModalOpen && historyCustody && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <div>
                  <h3 className="font-black text-slate-900 text-base">سجل حركات العهدة التفصيلي</h3>
                  <p className="text-xs text-slate-500">
                    عهدة: {historyCustody.employee?.name} ({historyCustody.businessDate})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-2.5">
                {(historyCustody.transactions || []).length === 0 && (
                  <div className="p-6 text-center text-slate-400 text-xs">لا توجد حركات مسجلة لهذه العهدة</div>
                )}

                {(historyCustody.transactions || []).map((t: any) => {
                  const badge = getTxnTypeLabel(t.transactionType);
                  return (
                    <div
                      key={t.id}
                      className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5 space-x-reverse mb-0.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badge.color}`}>
                            {badge.label}
                          </span>
                          <span className="font-bold text-slate-900 truncate">{t.description}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {new Date(t.createdAt).toLocaleString('ar-EG')} • بواسطة: {t.createdBy}
                        </div>
                      </div>
                      <div className="font-mono font-black text-slate-900 text-sm shrink-0 mr-2">
                        {Number(t.amount).toLocaleString()} {t.currency}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex justify-end shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setHistoryModalOpen(false)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs sm:text-sm min-h-[44px]"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ================= MODAL: ADD / EDIT EMPLOYEE ================= */}
        {employeeModalOpen && mounted && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden text-right">
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                <h3 className="font-black text-slate-900 text-base">
                  {editingEmployee ? 'تعديل بيانات الموظف' : 'إضافة موظف تسليم جديد'}
                </h3>
                <button
                  type="button"
                  onClick={() => setEmployeeModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {empError && (
                <div className="mx-4 sm:mx-5 mt-3 p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2 space-x-reverse shrink-0">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{empError}</span>
                </div>
              )}

              <form id="employee-form" onSubmit={handleSaveEmployee} className="p-4 sm:p-5 overflow-y-auto touch-scroll flex-1 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم الموظف بالكامل *</label>
                  <input
                    type="text"
                    required
                    value={empName}
                    onChange={(e) => setEmpName(e.target.value)}
                    placeholder="مثال: أحمد عبد الله حسن"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف *</label>
                  <input
                    type="tel"
                    required
                    value={empPhone}
                    onChange={(e) => setEmpPhone(e.target.value)}
                    placeholder="مثال: +201000000000"
                    className="w-full px-3.5 py-2.5 font-mono text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
                  <input
                    type="text"
                    value={empJobTitle}
                    onChange={(e) => setEmpJobTitle(e.target.value)}
                    placeholder="مثال: مسؤول تسليم النقدية والخزينة"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الرقم القومي / إثبات الهوية</label>
                  <input
                    type="text"
                    value={empIdentity}
                    onChange={(e) => setEmpIdentity(e.target.value)}
                    placeholder="مثال: 29001011234567"
                    className="w-full px-3.5 py-2.5 font-mono text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 min-h-[44px]"
                  />
                </div>
              </form>

              <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setEmployeeModalOpen(false)}
                  disabled={savingEmployee}
                  className="flex-1 sm:flex-initial px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  form="employee-form"
                  disabled={savingEmployee || !empName.trim() || !empPhone.trim()}
                  className="flex-1 sm:flex-initial px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-indigo-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                >
                  {savingEmployee && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>{savingEmployee ? 'جاري الحفظ...' : editingEmployee ? 'حفظ التعديلات' : 'إضافة الموظف'}</span>
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
