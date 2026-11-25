'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import * as XLSX from 'xlsx';
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
  Download,
  Upload,
  Image as ImageIcon,
  DollarSign,
  Receipt,
  FileCheck2,
  Wallet,
  Clock,
  Eye,
  ChevronRight,
  ArrowDownLeft,
  Scale,
  Lock,
  Unlock,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react';

export default function CustomersPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

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
  const [statementCurrency, setStatementCurrency] = useState<'EGP' | 'SDG'>('EGP');
  const [statementFromDate, setStatementFromDate] = useState<string>('');
  const [statementToDate, setStatementToDate] = useState<string>('');
  const [pdfDownloading, setPdfDownloading] = useState<boolean>(false);

  // Full Customer Detail & Operations Modal State
  const [detailCustomer, setDetailCustomer] = useState<any>(null);
  const [customerDetails, setCustomerDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'summary' | 'operations' | 'new_operation' | 'receipts'>('summary');

  // New Operation Form State
  const [opTotalSdg, setOpTotalSdg] = useState<string>('20000000');
  const [opExchangeRate, setOpExchangeRate] = useState<string>('200');
  const [opReceiptCount, setOpReceiptCount] = useState<number>(5);
  const [opNotes, setOpNotes] = useState<string>('');
  const [opFiles, setOpFiles] = useState<{ name: string; dataUrl: string; size: number }[]>([]);
  const [opSaving, setOpSaving] = useState<boolean>(false);
  const [opFeedback, setOpFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New Cash Payout (Delivery) State
  const [payoutModalOpen, setPayoutModalOpen] = useState<boolean>(false);
  const [selectedSessionForPayout, setSelectedSessionForPayout] = useState<any>(null);
  const [payoutAmount, setPayoutAmount] = useState<string>('');
  const [payoutRecipient, setPayoutRecipient] = useState<string>('');
  const [payoutNotes, setPayoutNotes] = useState<string>('');
  const [payoutSaving, setPayoutSaving] = useState<boolean>(false);
  const [payoutFeedback, setPayoutFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Lightbox View Image State
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // User info for RBAC
  const [currentUser, setCurrentUser] = useState<any>(null);
  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setCurrentUser(d.user);
      })
      .catch(() => {});
  }, []);

  // Account Closing & Reopening State
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Calculation for New Operation preview
  const calculatedEgp = useMemo(() => {
    const sdg = parseFloat(opTotalSdg) || 0;
    const rate = parseFloat(opExchangeRate) || 0;
    if (sdg <= 0 || rate <= 0) return 0;
    return Math.floor((sdg / rate) * 10000) / 10000;
  }, [opTotalSdg, opExchangeRate]);

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

    if (!name.trim() || name.trim().length < 3) {
      setFormError('اسم العميل مطلوب ويجب أن يحتوي على 3 أحرف على الأقل');
      setSaving(false);
      return;
    }

    if (!phone.trim()) {
      setFormError('رقم الهاتف الأساسي مطلوب للتواصل');
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

  const fetchCustomerDetails = useCallback(async (customerId: string) => {
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/v1/customers/${customerId}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setCustomerDetails(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch customer details:', err);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const openCustomerProfile = (cust: any, initialTab: 'summary' | 'operations' | 'new_operation' | 'receipts' = 'summary') => {
    setDetailCustomer(cust);
    setDetailTab(initialTab);
    setOpFeedback(null);
    setPayoutFeedback(null);
    setActionError(null);
    fetchCustomerDetails(cust.id);
  };

  const handleCloseAccount = async () => {
    if (!detailCustomer) return;
    setActionSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/customers/${detailCustomer.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: closeReason,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.blockingReasons && data.blockingReasons.length > 0) {
          setActionError(data.blockingReasons.join(' • '));
        } else {
          setActionError(data.error || 'فشل إقفال حساب العميل');
        }
        return;
      }
      setCloseModalOpen(false);
      setCloseReason('');
      fetchCustomerDetails(detailCustomer.id);
      fetchCustomers(search);
    } catch (err: any) {
      setActionError(err.message || 'حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleReopenAccount = async () => {
    if (!detailCustomer) return;
    setActionSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/customers/${detailCustomer.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'فشل إعادة فتح حساب العميل');
        return;
      }
      setReopenModalOpen(false);
      setReopenReason('');
      fetchCustomerDetails(detailCustomer.id);
      fetchCustomers(search);
    } catch (err: any) {
      setActionError(err.message || 'حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setActionSubmitting(false);
    }
  };

  const fetchStatementData = async (
    cust: any,
    currency: 'EGP' | 'SDG' = statementCurrency,
    fromDate: string = statementFromDate,
    toDate: string = statementToDate
  ) => {
    setStatementLoading(true);
    setStatementError(null);

    try {
      const params = new URLSearchParams({ currency });
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      const res = await fetch(`/api/v1/customers/${cust.id}/statement?${params.toString()}`);
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

  const openStatement = async (cust: any, initialCurrency: 'EGP' | 'SDG' = 'EGP') => {
    setActiveCustomer(cust);
    setStatementCurrency(initialCurrency);
    setStatementFromDate('');
    setStatementToDate('');
    setStatementData(null);
    await fetchStatementData(cust, initialCurrency, '', '');
  };

  const downloadStatementPdf = async (
    cust: any = activeCustomer,
    currency: 'EGP' | 'SDG' = statementCurrency,
    fromDate: string = statementFromDate,
    toDate: string = statementToDate
  ) => {
    if (!cust) return;
    setPdfDownloading(true);
    try {
      const params = new URLSearchParams({ currency, disposition: 'attachment' });
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      const res = await fetch(`/api/v1/customers/${cust.id}/statement/pdf?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'فشل إنشاء ملف PDF لكشف الحساب');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (cust.name || 'customer').replace(/[\\/:*?"<>|]/g, '_');
      a.download = `كشف_حساب_${safeName}_${currency}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch (err: any) {
      setStatementError(err.message || 'حدث خطأ أثناء تحميل ملف PDF');
    } finally {
      setPdfDownloading(false);
    }
  };

  // Handle files upload from device
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: { name: string; dataUrl: string; size: number }[] = [];
    const readers: Promise<void>[] = [];

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      const p = new Promise<void>((resolve) => {
        reader.onload = (event) => {
          if (event.target?.result) {
            newFiles.push({
              name: file.name,
              dataUrl: event.target.result as string,
              size: file.size,
            });
          }
          resolve();
        };
        reader.readAsDataURL(file);
      });
      readers.push(p);
    });

    Promise.all(readers).then(() => {
      setOpFiles((prev) => [...prev, ...newFiles]);
      if (newFiles.length > 0 && opReceiptCount < opFiles.length + newFiles.length) {
        setOpReceiptCount(opFiles.length + newFiles.length);
      }
    });
  };

  const removeFile = (index: number) => {
    setOpFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit New Operation with Multi Receipts
  const handleSubmitOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailCustomer) return;

    setOpSaving(true);
    setOpFeedback(null);

    const sdg = parseFloat(opTotalSdg);
    const rate = parseFloat(opExchangeRate);

    if (isNaN(sdg) || sdg <= 0) {
      setOpFeedback({ type: 'error', message: 'يرجى إدخال إجمالي مبلغ سوداني صحيح أكبر من الصفر' });
      setOpSaving(false);
      return;
    }

    if (isNaN(rate) || rate <= 0) {
      setOpFeedback({ type: 'error', message: 'يرجى إدخال سعر صرف صحيح أكبر من الصفر' });
      setOpSaving(false);
      return;
    }

    try {
      const receiptsPayload = opFiles.map((f, idx) => ({
        imageData: f.dataUrl,
        notes: `إيصال مرفوع رقم ${idx + 1} للملف: ${f.name}`,
      }));

      const res = await fetch(`/api/v1/customers/${detailCustomer.id}/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalSdg: sdg,
          exchangeRate: rate,
          receiptCount: Math.max(opReceiptCount, opFiles.length),
          receipts: receiptsPayload,
          notes: opNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل حفظ العملية');
      }

      setOpFeedback({
        type: 'success',
        message: `تم إنشاء العملية ${data.data.session.sessionNumber} بنجاح وقيمتها المقابلة: ${data.data.calculated.equivalentEgp.toLocaleString()} EGP!`,
      });

      // Clear form
      setOpFiles([]);
      setOpNotes('');
      fetchCustomerDetails(detailCustomer.id);
      fetchCustomers();

      setTimeout(() => {
        setDetailTab('operations');
      }, 1500);
    } catch (err: any) {
      setOpFeedback({ type: 'error', message: err.message || 'حدث خطأ أثناء حفظ العملية' });
    } finally {
      setOpSaving(false);
    }
  };

  // Open Partial Payout Modal
  const openPayoutDialog = (session: any) => {
    setSelectedSessionForPayout(session);
    const remainingEgp = Number(session.requestedAmount) - Number(session.deliveredAmount);
    setPayoutAmount(remainingEgp > 0 ? remainingEgp.toString() : '');
    setPayoutRecipient(detailCustomer?.name || '');
    setPayoutNotes('');
    setPayoutFeedback(null);
    setPayoutModalOpen(true);
  };

  // Submit Cash Payout
  const handleExecutePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionForPayout) return;

    setPayoutSaving(true);
    setPayoutFeedback(null);

    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount <= 0) {
      setPayoutFeedback({ type: 'error', message: 'يرجى إدخال مبلغ دفع صحيح أكبر من الصفر' });
      setPayoutSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/v1/customer-sessions/${selectedSessionForPayout.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountEgp: amount,
          recipientName: payoutRecipient.trim() || detailCustomer.name,
          notes: payoutNotes.trim() || 'صرف دفعة نقدية لحساب العميل',
          allowPartial: true,
          idempotencyKey: `payout-${selectedSessionForPayout.id}-${Date.now()}`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تنفيذ الدفعة النقدية');
      }

      setPayoutFeedback({
        type: 'success',
        message: `تم صرف الدفعة النقدية بمبلغ ${amount.toLocaleString()} EGP بنجاح وإصدار سند الصرف!`,
      });

      if (detailCustomer) {
        fetchCustomerDetails(detailCustomer.id);
      }
      fetchCustomers();

      setTimeout(() => {
        setPayoutModalOpen(false);
      }, 1200);
    } catch (err: any) {
      setPayoutFeedback({ type: 'error', message: err.message || 'حدث خطأ أثناء صرف الدفعة' });
    } finally {
      setPayoutSaving(false);
    }
  };

  // Export Statement to Excel (5-column unified ledger format)
  const exportStatementToExcel = () => {
    if (!statementData) return;
    const ledger = statementData.ledgerStatement;
    const rows = (ledger?.rows || []).map((r: any) => ({
      'التاريخ': r.date,
      'التفاصيل': r.description,
      'عليه': Number(r.debit || 0),
      'له': Number(r.credit || 0),
      'الرصيد': Number(r.runningBalance || 0),
      'العملة': r.currency,
      'المرجع': r.reference,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `كشف_${statementCurrency}`);
    XLSX.writeFile(
      wb,
      `كشف_حساب_${statementData.customer.name}_${statementCurrency}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">سجل وملفات العملاء</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              إدارة بيانات العملاء، العمليات والإيصالات، دفعات الصرف، واستخراج كشوف الحسابات
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
            <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200 p-8">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-700">لا يوجد عملاء مسجلون حالياً</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {search ? 'لم نجد أي عميل يطابق معايير البحث المدخلة' : 'ابدأ بإضافة أول عميل إلى النظام لبدء تسجيل العمليات'}
              </p>
            </div>
          ) : (
            customers.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => openCustomerProfile(c, 'summary')}
                          className="font-bold text-slate-900 text-sm sm:text-base hover:text-blue-600 text-right transition-colors"
                        >
                          {c.name}
                        </button>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-mono">
                          {c.customerCode}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        مسجل منذ {new Date(c.createdAt).toLocaleDateString('ar-EG')}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1 ${
                        c.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : c.status === 'closed'
                          ? 'bg-slate-100 text-slate-800 border border-slate-300'
                          : c.status === 'blocked'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {c.status === 'closed' && <Lock className="w-2.5 h-2.5" />}
                      {c.status === 'active' ? 'نشط' : c.status === 'closed' ? 'مقفل' : c.status === 'blocked' ? 'محظور' : 'غير نشط'}
                    </span>
                  </div>

                  <div className="py-2.5 space-y-1.5 text-xs text-slate-600">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <Phone className="w-3.5 h-3.5 text-blue-500 shrink-0" />
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
                  </div>

                  {/* Isolated Multi-Currency Balance Summary */}
                  <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-1.5 text-[10px]">
                    <div className="bg-slate-50/80 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-slate-400 block font-medium">المدين (مطلوب منه)</span>
                      <span className="font-bold text-slate-800 block font-mono">
                        {(c.balances?.EGP?.debtor || 0).toLocaleString()} <span className="text-[9px] text-slate-400 font-normal">EGP</span>
                      </span>
                      <span className="font-medium text-slate-600 block font-mono text-[9px]">
                        {(c.balances?.SDG?.debtor || 0).toLocaleString()} SDG
                      </span>
                    </div>
                    <div className="bg-slate-50/80 p-1.5 rounded-lg border border-slate-100">
                      <span className="text-slate-400 block font-medium">الدائن (مستحق له)</span>
                      <span className="font-bold text-emerald-700 block font-mono">
                        {(c.balances?.EGP?.creditor || 0).toLocaleString()} <span className="text-[9px] text-emerald-600/70 font-normal">EGP</span>
                      </span>
                      <span className="font-medium text-emerald-600 block font-mono text-[9px]">
                        {(c.balances?.SDG?.creditor || 0).toLocaleString()} SDG
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-400 font-medium">
                    {c._count?.sessions || 0} عمليات • {c._count?.receipts || 0} إيصالات
                  </span>

                  <div className="flex items-center space-x-1.5 space-x-reverse">
                    <button
                      onClick={() => openCustomerProfile(c, 'new_operation')}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 text-[11px] font-bold rounded-lg transition-colors min-h-[36px] flex items-center space-x-1 space-x-reverse"
                      title="إنشاء عملية جديدة ورفع إيصالاتها"
                    >
                      <Plus className="w-3 h-3" />
                      <span>عملية وإيصالات</span>
                    </button>
                    <button
                      onClick={() => openCustomerProfile(c, 'summary')}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 text-[11px] font-bold rounded-lg transition-colors flex items-center space-x-1 space-x-reverse min-h-[36px]"
                      title="فتح ملف العميل الكامل"
                    >
                      <Eye className="w-3.5 h-3.5 shrink-0" />
                      <span>الملف المالي</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ============================================================== */}
        {/* CUSTOMER PROFILE & INTEGRATED OPERATIONS DRAWER/MODAL           */}
        {/* ============================================================== */}
        {mounted && detailCustomer && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm p-0 sm:p-4 touch-none" onClick={() => setDetailCustomer(null)}>
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-5xl max-h-[88dvh] sm:max-h-[92vh] flex flex-col text-right safe-area-pb overflow-hidden animate-in slide-in-from-bottom-4 duration-200" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="p-4 sm:p-6 bg-slate-900 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-md">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base sm:text-lg font-black truncate">{detailCustomer.name}</h2>
                      <span className="text-[10px] font-mono bg-slate-800 text-blue-300 px-2 py-0.5 rounded-md">
                        {detailCustomer.customerCode}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">{detailCustomer.phone}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 space-x-reverse">
                  <button
                    onClick={() => openStatement(detailCustomer)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 space-x-reverse shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>كشف الحساب PDF</span>
                  </button>
                  <button
                    onClick={() => setDetailCustomer(null)}
                    className="p-2 text-slate-400 hover:text-white rounded-xl min-w-[36px] min-h-[36px] flex items-center justify-center"
                    aria-label="إغلاق"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-slate-200 bg-slate-50 px-4 sm:px-6 overflow-x-auto no-scrollbar shrink-0">
                <button
                  onClick={() => setDetailTab('summary')}
                  className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-all shrink-0 flex items-center space-x-1.5 space-x-reverse ${
                    detailTab === 'summary'
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Wallet className="w-4 h-4" />
                  <span>ملخص الحساب</span>
                </button>
                <button
                  onClick={() => setDetailTab('new_operation')}
                  className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-all shrink-0 flex items-center space-x-1.5 space-x-reverse ${
                    detailTab === 'new_operation'
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Plus className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700">عملية جديدة وإيصالات</span>
                </button>
                <button
                  onClick={() => setDetailTab('operations')}
                  className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-all shrink-0 flex items-center space-x-1.5 space-x-reverse ${
                    detailTab === 'operations'
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Receipt className="w-4 h-4" />
                  <span>العمليات والدفعات ({customerDetails?.sessions?.length || 0})</span>
                </button>
                <button
                  onClick={() => setDetailTab('receipts')}
                  className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-all shrink-0 flex items-center space-x-1.5 space-x-reverse ${
                    detailTab === 'receipts'
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>معرض المرفقات ({customerDetails?.receipts?.length || 0})</span>
                </button>
              </div>

              {/* Tab Content Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 touch-scroll">
                {detailsLoading ? (
                  <div className="py-20 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
                    <p className="text-xs font-semibold">جاري استخراج السجل المالي للعميل...</p>
                  </div>
                ) : (
                  <>
                    {/* TAB 1: SUMMARY */}
                    {detailTab === 'summary' && (
                      <div className="space-y-6">
                        {/* KPI Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                            <span className="text-[11px] font-bold text-emerald-700 block">إجمالي المقابل المستحق (EGP)</span>
                            <div className="text-lg sm:text-xl font-black text-emerald-950 font-mono mt-1">
                              {Number(customerDetails?.totals?.totalRequestedEgp || 0).toLocaleString()} EGP
                            </div>
                            <span className="text-[10px] text-emerald-600 block mt-1">
                              مقابل {Number(customerDetails?.totals?.totalReceivedSdg || 0).toLocaleString()} SDG
                            </span>
                          </div>

                          <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
                            <span className="text-[11px] font-bold text-blue-700 block">إجمالي المدفوع نقداً (EGP)</span>
                            <div className="text-lg sm:text-xl font-black text-blue-950 font-mono mt-1">
                              {Number(customerDetails?.totals?.totalDeliveredEgp || 0).toLocaleString()} EGP
                            </div>
                            <span className="text-[10px] text-blue-600 block mt-1">مسلم عبر سندات الصرف</span>
                          </div>

                          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                            <span className="text-[11px] font-bold text-amber-700 block">الرصيد المتبقي للتسليم (EGP)</span>
                            <div className="text-lg sm:text-xl font-black text-amber-950 font-mono mt-1">
                              {Math.max(
                                0,
                                Number(customerDetails?.totals?.totalRequestedEgp || 0) -
                                  Number(customerDetails?.totals?.totalDeliveredEgp || 0)
                              ).toLocaleString()}{' '}
                              EGP
                            </div>
                            <span className="text-[10px] text-amber-600 block mt-1">بذمة الصندوق للعميل</span>
                          </div>

                          <div className="p-4 bg-purple-50 border border-purple-200 rounded-2xl">
                            <span className="text-[11px] font-bold text-purple-700 block">إجمالي العمليات</span>
                            <div className="text-lg sm:text-xl font-black text-purple-950 font-mono mt-1">
                              {customerDetails?.sessions?.length || 0} عملية
                            </div>
                            <span className="text-[10px] text-purple-600 block mt-1">
                              {customerDetails?.receipts?.length || 0} إيصال بنكي
                            </span>
                          </div>
                        </div>

                        {/* Isolated Currency Balances (Debtors & Creditors Separation) */}
                        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 mb-4 gap-2">
                            <div>
                              <h3 className="font-black text-slate-900 text-sm">أرصدة العملات والذمم المالية (مفصولة بالكامل)</h3>
                              <p className="text-[11px] text-slate-500">فصل دقيق للمدينين والدائنين دون أي خلط أو مقاصة بين الجنيه المصري والسوداني</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {customerDetails?.status === 'active' && (
                                <button
                                  onClick={() => {
                                    setActionError(null);
                                    setCloseModalOpen(true);
                                  }}
                                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-xs"
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>إقفال الحساب</span>
                                </button>
                              )}
                              {customerDetails?.status === 'closed' && currentUser?.role === 'admin' && (
                                <button
                                  onClick={() => {
                                    setActionError(null);
                                    setReopenModalOpen(true);
                                  }}
                                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-xs"
                                >
                                  <Unlock className="w-3.5 h-3.5" />
                                  <span>إعادة فتح الحساب</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Status Banner if Closed */}
                          {customerDetails?.status === 'closed' && (
                            <div className="mb-4 p-3.5 bg-slate-100 border border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-slate-800 text-xs">
                              <div className="flex items-center gap-2.5">
                                <Lock className="w-4 h-4 text-slate-600 shrink-0" />
                                <div className="flex-1">
                                  <span className="font-bold block">هذا الحساب مقفل ومجمد حالياً</span>
                                  <span className="text-[11px] text-slate-500">
                                    تم إيقاف إنشاء العمليات وإرفاق الإيصالات وصرف النقدية. يمكنك استخراج كشف التسوية النهائي التاريخي في أي وقت.
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => downloadStatementPdf(detailCustomer, 'EGP', '', '')}
                                disabled={pdfDownloading}
                                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-xs"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>كشف التسوية النهائي (PDF)</span>
                              </button>
                            </div>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            {/* EGP Balances Box */}
                            <div className="p-4 bg-emerald-50/50 border border-emerald-200/80 rounded-xl space-y-3">
                              <div className="flex items-center justify-between pb-2 border-b border-emerald-200/60">
                                <span className="font-bold text-xs text-emerald-900 flex items-center gap-1.5">
                                  <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                                  الجنيه المصري (EGP)
                                </span>
                                <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">EGP</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-[11px] text-slate-500 block">المدين (مطلوب منه):</span>
                                  <span className="font-bold text-slate-900 font-mono text-sm">
                                    {(customerDetails?.currencyBalances?.EGP?.debtor || 0).toLocaleString()} EGP
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] text-slate-500 block">الدائن (مستحق له):</span>
                                  <span className="font-bold text-emerald-700 font-mono text-sm">
                                    {(customerDetails?.currencyBalances?.EGP?.creditor || 0).toLocaleString()} EGP
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* SDG Balances Box */}
                            <div className="p-4 bg-blue-50/50 border border-blue-200/80 rounded-xl space-y-3">
                              <div className="flex items-center justify-between pb-2 border-b border-blue-200/60">
                                <span className="font-bold text-xs text-blue-900 flex items-center gap-1.5">
                                  <ArrowDownLeft className="w-3.5 h-3.5 text-blue-700" />
                                  الجنيه السوداني (SDG)
                                </span>
                                <span className="text-[10px] font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded">SDG</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-[11px] text-slate-500 block">المدين (مطلوب منه):</span>
                                  <span className="font-bold text-slate-900 font-mono text-sm">
                                    {(customerDetails?.currencyBalances?.SDG?.debtor || 0).toLocaleString()} SDG
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] text-slate-500 block">الدائن (مستحق له):</span>
                                  <span className="font-bold text-blue-700 font-mono text-sm">
                                    {(customerDetails?.currencyBalances?.SDG?.creditor || 0).toLocaleString()} SDG
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Recent Operations Quick List */}
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-black text-slate-900 text-sm">آخر العمليات والحركات المالية</h3>
                            <button
                              onClick={() => setDetailTab('operations')}
                              className="text-xs text-blue-600 font-bold hover:underline flex items-center space-x-1 space-x-reverse"
                            >
                              <span>عرض جميع العمليات</span>
                              <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                            </button>
                          </div>

                          {(!customerDetails?.sessions || customerDetails.sessions.length === 0) ? (
                            <div className="py-8 text-center text-slate-400 text-xs">
                              لا توجد عمليات سابقة مسجلة لهذا العميل حتى الآن.
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              {customerDetails.sessions.slice(0, 3).map((s: any) => {
                                const remEgp = Math.max(0, Number(s.requestedAmount) - Number(s.deliveredAmount));
                                return (
                                  <div
                                    key={s.id}
                                    className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-xs"
                                  >
                                    <div>
                                      <div className="font-bold text-slate-900 font-mono">{s.sessionNumber}</div>
                                      <div className="text-[11px] text-slate-500">
                                        {s.businessDate} • بسعر صرف: {Number(s.exchangeRate).toLocaleString()}
                                      </div>
                                    </div>
                                    <div className="text-left font-mono">
                                      <div className="font-black text-slate-900">
                                        {Number(s.requestedAmount).toLocaleString()} EGP
                                      </div>
                                      <div
                                        className={`text-[10px] font-bold ${
                                          remEgp === 0 ? 'text-emerald-600' : 'text-amber-600'
                                        }`}
                                      >
                                        {remEgp === 0 ? 'مدفوع بالكامل' : `متبقي: ${remEgp.toLocaleString()} EGP`}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* TAB 2: NEW OPERATION WITH MULTI RECEIPTS */}
                    {detailTab === 'new_operation' && (
                      <div className="max-w-3xl mx-auto space-y-6">
                        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900">
                          <h4 className="font-black text-sm mb-1 text-blue-950">إنشاء عملية جديدة وإرفاق إيصالاتها</h4>
                          <p>
                            أدخل إجمالي المبلغ المحول بالجنيه السوداني (SDG) وسعر الصرف لحساب القيمة المقابلة بالجنيه المصري (EGP) تلقائياً، وارفع صور الإيصالات الداعمة دفعة واحدة.
                          </p>
                        </div>

                        {customerDetails?.status === 'closed' && (
                          <div className="bg-slate-100 border border-slate-300 rounded-2xl p-4 flex items-center gap-3 text-slate-800 text-xs">
                            <Lock className="w-5 h-5 text-slate-600 shrink-0" />
                            <div>
                              <h5 className="font-bold">حساب العميل مقفل حالياً</h5>
                              <p className="text-slate-500 text-[11px] mt-0.5">
                                لا يمكن إنشاء عمليات جديدة أو إرفاق إيصالات لحساب مقفل.
                              </p>
                            </div>
                          </div>
                        )}

                        {opFeedback && (
                          <div
                            className={`p-3.5 rounded-xl border text-xs font-bold flex items-center space-x-2 space-x-reverse ${
                              opFeedback.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-rose-50 border-rose-200 text-rose-800'
                            }`}
                          >
                            {opFeedback.type === 'success' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            )}
                            <span>{opFeedback.message}</span>
                          </div>
                        )}

                        <form onSubmit={handleSubmitOperation} className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-bold text-slate-700 mb-1">
                                إجمالي المبلغ بالسوداني (SDG) <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="number"
                                required
                                min="1"
                                step="any"
                                value={opTotalSdg}
                                onChange={(e) => setOpTotalSdg(e.target.value)}
                                placeholder="مثال: 20000000"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-slate-700 mb-1">
                                سعر الصرف (SDG لكل 1 EGP) <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="number"
                                required
                                min="0.0001"
                                step="any"
                                value={opExchangeRate}
                                onChange={(e) => setOpExchangeRate(e.target.value)}
                                placeholder="مثال: 200"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>

                          {/* Live Calculation Preview Callout */}
                          <div className="p-4 bg-slate-900 text-white rounded-2xl flex items-center justify-between shadow-md">
                            <div>
                              <span className="text-[11px] text-slate-400 block">المعادلة والحساب التلقائي:</span>
                              <div className="text-xs sm:text-sm font-mono text-amber-400 font-bold mt-0.5">
                                {Number(opTotalSdg || 0).toLocaleString()} SDG ÷ {Number(opExchangeRate || 1).toLocaleString()} =
                              </div>
                            </div>
                            <div className="text-left font-mono">
                              <span className="text-[10px] text-slate-400 block">المبلغ المقابل بالجنيه المصري:</span>
                              <span className="text-xl sm:text-2xl font-black text-emerald-400">
                                {calculatedEgp.toLocaleString()} EGP
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-bold text-slate-700 mb-1">
                                عدد الإيصالات المتوقعة
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="20"
                                value={opReceiptCount}
                                onChange={(e) => setOpReceiptCount(parseInt(e.target.value, 10) || 1)}
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات العملية</label>
                              <input
                                type="text"
                                value={opNotes}
                                onChange={(e) => setOpNotes(e.target.value)}
                                placeholder="مثال: تحويل عائلي، دفعة تجارية..."
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>

                          {/* Image & PDF Upload Drag Box */}
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">
                              صور ومستندات الإيصالات (JPG, PNG, PDF)
                            </label>
                            <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 text-center bg-slate-50/50 transition-colors">
                              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                              <p className="text-xs text-slate-600 font-bold">اسحب وأفلت صور الإيصالات هنا أو اضغط للاختيار من جهازك</p>
                              <p className="text-[11px] text-slate-400 mt-1">يدعم رفع عدة صور معاً أو ملفات PDF مباشرة</p>
                              <input
                                type="file"
                                multiple
                                accept="image/jpeg,image/png,image/jpg,application/pdf"
                                onChange={handleFileUpload}
                                className="mt-3 text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                              />
                            </div>

                            {/* Files Preview Grid */}
                            {opFiles.length > 0 && (
                              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                {opFiles.map((file, index) => (
                                  <div
                                    key={index}
                                    className="p-2 border border-slate-200 rounded-xl bg-white flex items-center justify-between text-xs relative group"
                                  >
                                    <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                                      <ImageIcon className="w-4 h-4 text-blue-600 shrink-0" />
                                      <span className="truncate font-mono text-[11px]">{file.name}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeFile(index)}
                                      className="p-1 text-rose-500 hover:text-rose-700 rounded"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="pt-4 flex justify-end">
                            <button
                              type="submit"
                              disabled={opSaving || calculatedEgp <= 0 || customerDetails?.status === 'closed'}
                              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center space-x-2 space-x-reverse"
                            >
                              {opSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
                              <span>حفظ العملية وربط {Math.max(opReceiptCount, opFiles.length)} إيصالات</span>
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    {/* TAB 3: OPERATIONS & PAYMENT DISBURSEMENTS */}
                    {detailTab === 'operations' && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-slate-900 text-sm">سجل العمليات والدفعات النقدية المسلمة</h3>
                          <button
                            onClick={() => setDetailTab('new_operation')}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-xl flex items-center space-x-1 space-x-reverse"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>عملية جديدة</span>
                          </button>
                        </div>

                        {(!customerDetails?.sessions || customerDetails.sessions.length === 0) ? (
                          <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                            لا توجد عمليات مسجلة. اضغط على "عملية جديدة" لبدء تسجيل أول عملية.
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {customerDetails.sessions.map((session: any) => {
                              const requestedEgp = Number(session.requestedAmount || 0);
                              const deliveredEgp = Number(session.deliveredAmount || 0);
                              const remainingEgp = Math.max(0, requestedEgp - deliveredEgp);
                              const progressPercent = requestedEgp > 0 ? Math.min(100, Math.round((deliveredEgp / requestedEgp) * 100)) : 0;

                              return (
                                <div
                                  key={session.id}
                                  className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4"
                                >
                                  {/* Operation Header */}
                                  <div className="flex items-start justify-between flex-wrap gap-2 pb-3 border-b border-slate-100">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-black text-slate-900 text-sm sm:text-base font-mono">
                                          {session.sessionNumber}
                                        </span>
                                        <span
                                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                            session.status === 'completed'
                                              ? 'bg-emerald-100 text-emerald-800'
                                              : session.status === 'partially_delivered'
                                              ? 'bg-blue-100 text-blue-800'
                                              : session.status === 'pending_delivery'
                                              ? 'bg-purple-100 text-purple-800'
                                              : 'bg-amber-100 text-amber-800'
                                          }`}
                                        >
                                          {session.status === 'completed'
                                            ? 'مكتمل ومسدد'
                                            : session.status === 'partially_delivered'
                                            ? 'مدفوع جزئياً'
                                            : session.status === 'pending_delivery'
                                            ? 'بانتظار تسليم الكاش'
                                            : session.status === 'pending_receipts'
                                            ? 'بانتظار الإيصالات'
                                            : session.status}
                                        </span>
                                      </div>
                                      <div className="text-xs text-slate-500 mt-1">
                                        التاريخ: {session.businessDate} • سعر الصرف: {Number(session.exchangeRate).toLocaleString()}
                                      </div>
                                    </div>

                                    <div className="flex items-center space-x-2 space-x-reverse">
                                      {remainingEgp > 0 && (
                                        <button
                                          onClick={() => openPayoutDialog(session)}
                                          disabled={customerDetails?.status === 'closed'}
                                          className={`px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm flex items-center space-x-1 space-x-reverse ${
                                            customerDetails?.status === 'closed'
                                              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                              : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white'
                                          }`}
                                          title={customerDetails?.status === 'closed' ? 'لا يمكن صرف نقدية لحساب مقفل' : undefined}
                                        >
                                          <DollarSign className="w-3.5 h-3.5" />
                                          <span>{customerDetails?.status === 'closed' ? 'الحساب مقفل' : 'تسجيل دفعة نقدية'}</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Amounts Breakdown */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <div>
                                      <span className="text-slate-400 block text-[10px]">إجمالي السوداني</span>
                                      <span className="font-bold text-slate-800 font-mono">
                                        {Number(session.expectedAmount).toLocaleString()} SDG
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 block text-[10px]">إجمالي المقابل المصري</span>
                                      <span className="font-bold text-slate-900 font-mono">
                                        {requestedEgp.toLocaleString()} EGP
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 block text-[10px]">المسلم نقداً حتى الآن</span>
                                      <span className="font-bold text-emerald-700 font-mono">
                                        {deliveredEgp.toLocaleString()} EGP
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 block text-[10px]">المتبقي للتسليم</span>
                                      <span className="font-bold text-amber-700 font-mono">
                                        {remainingEgp.toLocaleString()} EGP
                                      </span>
                                    </div>
                                  </div>

                                  {/* Payment Progress Bar */}
                                  <div>
                                    <div className="flex justify-between text-[11px] font-bold text-slate-500 mb-1">
                                      <span>نسبة الصرف: {progressPercent}%</span>
                                      <span>
                                        {deliveredEgp.toLocaleString()} / {requestedEgp.toLocaleString()} EGP
                                      </span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full transition-all ${
                                          progressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-600'
                                        }`}
                                        style={{ width: `${progressPercent}%` }}
                                      ></div>
                                    </div>
                                  </div>

                                  {/* Linked Cash Payout Vouchers */}
                                  {session.vouchers && session.vouchers.length > 0 && (
                                    <div className="pt-2 border-t border-slate-100">
                                      <span className="text-[11px] font-bold text-slate-600 block mb-2">
                                        الدفعات المسلمة على هذه العملية:
                                      </span>
                                      <div className="space-y-1.5">
                                        {session.vouchers.map((v: any) => (
                                          <div
                                            key={v.id}
                                            className="p-2.5 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-center justify-between text-xs font-mono"
                                          >
                                            <div>
                                              <span className="font-bold text-emerald-900">{v.voucherNumber}</span>
                                              <span className="text-slate-500 text-[10px] mr-2">
                                                المستلم: {v.recipientName}
                                              </span>
                                            </div>
                                            <div className="text-left font-bold text-emerald-700">
                                              +{Number(v.amount).toLocaleString()} EGP
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Linked Receipts Count & View */}
                                  {session.receipts && session.receipts.length > 0 && (
                                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                                      <span>{session.receipts.length} إيصالات مرتبطة بهذه العملية</span>
                                      <button
                                        onClick={() => setDetailTab('receipts')}
                                        className="text-blue-600 font-bold hover:underline"
                                      >
                                        معاينة صور الإيصالات
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 4: ATTACHMENTS & RECEIPTS GALLERY */}
                    {detailTab === 'receipts' && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-slate-900 text-sm">معرض إيصالات ومرفقات العميل</h3>
                          <span className="text-xs text-slate-500">
                            إجمالي: {customerDetails?.receipts?.length || 0} إيصال
                          </span>
                        </div>

                        {(!customerDetails?.receipts || customerDetails.receipts.length === 0) ? (
                          <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                            لا توجد صور إيصالات مرفوعة لهذا العميل حتى الآن.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                            {customerDetails.receipts.map((rcp: any) => {
                              const imgUrl = `/api/v1/receipts/${rcp.id}/image`;
                              return (
                                <div
                                  key={rcp.id}
                                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between"
                                >
                                  <div
                                    onClick={() => setPreviewImageUrl(imgUrl)}
                                    className="h-36 bg-slate-100 flex items-center justify-center overflow-hidden cursor-pointer relative group"
                                  >
                                    <img
                                      src={imgUrl}
                                      alt={rcp.receiptNumber}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                      onError={(e: any) => {
                                        e.target.style.display = 'none';
                                        e.target.nextSibling.style.display = 'flex';
                                      }}
                                    />
                                    <div className="hidden w-full h-full items-center justify-center bg-slate-50 text-slate-400 flex-col">
                                      <ImageIcon className="w-6 h-6 mb-1" />
                                      <span className="text-[10px]">مستند / PDF</span>
                                    </div>
                                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                      <Eye className="w-5 h-5" />
                                    </div>
                                  </div>

                                  <div className="p-3 text-xs space-y-1">
                                    <div className="font-mono font-bold text-slate-900 truncate">
                                      {rcp.transactionId || rcp.receiptNumber}
                                    </div>
                                    <div className="font-mono text-emerald-700 font-bold">
                                      {Number(rcp.amount || 0).toLocaleString()} SDG
                                    </div>
                                    <div className="text-[10px] text-slate-400 flex justify-between pt-1 border-t border-slate-100">
                                      <span>{rcp.transactionDate || '—'}</span>
                                      <a
                                        href={imgUrl}
                                        download={`receipt-${rcp.receiptNumber}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 hover:underline flex items-center space-x-0.5 space-x-reverse"
                                      >
                                        <Download className="w-3 h-3" />
                                        <span>تنزيل</span>
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ============================================================== */}
        {/* CASH PAYOUT (DELIVERY) MODAL                                   */}
        {/* ============================================================== */}
        {mounted && payoutModalOpen && selectedSessionForPayout && createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm p-0 sm:p-4 touch-none"
            onClick={() => !payoutSaving && setPayoutModalOpen(false)}
          >
            <div
              className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[85dvh] sm:max-h-[90vh] flex flex-col text-right overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-black text-slate-900 text-base">تسجيل صرف دفعة نقدية</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPayoutModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg min-w-[36px] min-h-[36px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto overscroll-contain touch-scroll p-4 sm:p-5 space-y-4">
                {payoutFeedback && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-bold ${
                      payoutFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {payoutFeedback.message}
                  </div>
                )}

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1 font-mono">
                  <div>العملية: {selectedSessionForPayout.sessionNumber}</div>
                  <div className="text-slate-500">
                    المتبقي للصرف:{' '}
                    <span className="font-bold text-amber-700">
                      {Math.max(
                        0,
                        Number(selectedSessionForPayout.requestedAmount) -
                          Number(selectedSessionForPayout.deliveredAmount)
                      ).toLocaleString()}{' '}
                      EGP
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المبلغ المطلوب صرفه الآن (EGP) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستلم الفعلي</label>
                  <input
                    type="text"
                    value={payoutRecipient}
                    onChange={(e) => setPayoutRecipient(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الصرف</label>
                  <input
                    type="text"
                    value={payoutNotes}
                    onChange={(e) => setPayoutNotes(e.target.value)}
                    placeholder="دفعة أولى، تسليم يدوي..."
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
                  />
                </div>
              </div>

              {/* Pinned Footer */}
              <div className="shrink-0 bg-slate-50 border-t border-slate-100 p-4 sm:p-5 flex justify-end gap-2.5 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setPayoutModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleExecutePayout}
                  disabled={payoutSaving || !payoutAmount || Number(payoutAmount) <= 0}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center space-x-1.5 space-x-reverse min-h-[44px]"
                >
                  {payoutSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>تأكيد الصرف وإصدار السند</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ============================================================== */}
        {/* LIGHTBOX / IMAGE PREVIEW MODAL                                 */}
        {/* ============================================================== */}
        {mounted && previewImageUrl && createPortal(
          <div
            onClick={() => setPreviewImageUrl(null)}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 cursor-pointer"
          >
            <div className="max-w-4xl max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
              <div className="p-3 bg-slate-900 text-white flex justify-between items-center text-xs">
                <span>معاينة الإيصال</span>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <a
                    href={previewImageUrl}
                    download="receipt"
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 hover:text-blue-400"
                    title="تنزيل الملف"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button onClick={() => setPreviewImageUrl(null)} className="p-1 hover:text-rose-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-2 flex items-center justify-center max-h-[80vh] overflow-auto">
                <img src={previewImageUrl} alt="إيصال" className="max-w-full max-h-[75vh] object-contain rounded" />
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ============================================================== */}
        {/* CREATE CUSTOMER MODAL / BOTTOM SHEET                           */}
        {/* ============================================================== */}
        {mounted && createModalOpen && createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm p-0 sm:p-4 touch-none"
            onClick={() => !saving && setCreateModalOpen(false)}
          >
            <div
              className="bg-white w-full sm:max-w-lg max-h-[85dvh] sm:max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl text-right overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header (Fixed shrink-0) */}
              <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white z-10">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <Users className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">إضافة عميل جديد للنظام</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                  aria-label="إغلاق"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form Body (flex-1 overscroll-contain) */}
              <div className="flex-1 overflow-y-auto overscroll-contain touch-scroll p-4 sm:p-5 space-y-3.5">
                {formError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-center space-x-2 space-x-reverse">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم بالكامل <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: عمر أحمد عبدالله"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      رقم الهاتف الأساسي <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+249 91 211 4342"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-mono focus:ring-2 focus:ring-blue-500 min-h-[44px] text-left"
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
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-mono focus:ring-2 focus:ring-blue-500 min-h-[44px] text-left"
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
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-mono focus:ring-2 focus:ring-blue-500 min-h-[44px] text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الرقم القومي / جواز السفر</label>
                    <input
                      type="text"
                      value={identityNumber}
                      onChange={(e) => setIdentityNumber(e.target.value)}
                      placeholder="رقم الهوية أو الجواز"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-mono focus:ring-2 focus:ring-blue-500 min-h-[44px]"
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
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العنوان التفصيلي</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="المعادي / بدر / وسط البلد"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات العميل</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="أي ملاحظات خاصة بالعميل أو تفضيلات..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  />
                </div>
              </div>

              {/* Pinned Bottom Footer (Fixed shrink-0) */}
              <div className="shrink-0 bg-slate-50 border-t border-slate-100 p-4 sm:p-5 flex items-center justify-end gap-2.5 safe-area-pb">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={saving}
                  className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-100 transition-colors min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleCreateCustomer}
                  disabled={saving || !name.trim() || !phone.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px] flex items-center space-x-2 space-x-reverse transition-all"
                >
                  {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>حفظ العميل</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ============================================================== */}
        {/* PRINTABLE ACCOUNT STATEMENT MODAL                             */}
        {/* ============================================================== */}
        {mounted && activeCustomer && createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm p-0 sm:p-4 touch-none" onClick={() => setActiveCustomer(null)}>
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-4xl max-h-[88dvh] sm:max-h-[94vh] overflow-y-auto overscroll-contain touch-scroll p-4 sm:p-8 text-right safe-area-pb animate-in slide-in-from-bottom-4 duration-200" onClick={(e) => e.stopPropagation()}>
              {/* Actions Header (Screen only, hidden when printed) */}
              <div className="space-y-3 pb-4 border-b border-slate-200 mb-4 sm:mb-6 no-print">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                    <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                    <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                      كشف حساب: {activeCustomer.name} ({activeCustomer.customerCode})
                    </h3>
                  </div>
                  <div className="flex items-center space-x-1.5 space-x-reverse shrink-0 flex-wrap gap-1.5">
                    <button
                      onClick={() => downloadStatementPdf(activeCustomer, statementCurrency, statementFromDate, statementToDate)}
                      disabled={statementLoading || pdfDownloading || !statementData}
                      className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse shadow-md shadow-blue-500/20 min-h-[40px] disabled:opacity-50"
                    >
                      {pdfDownloading ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      <span>{pdfDownloading ? 'جاري التجهيز...' : 'تحميل PDF'}</span>
                    </button>
                    <button
                      onClick={exportStatementToExcel}
                      disabled={statementLoading || !statementData}
                      className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse shadow-sm min-h-[40px] disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">Excel</span>
                    </button>
                    <button
                      onClick={() => window.print()}
                      disabled={statementLoading || !statementData}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse min-h-[40px] disabled:opacity-50"
                    >
                      <Printer className="w-4 h-4" />
                      <span className="hidden sm:inline">طباعة</span>
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

                {/* Currency Selector & Date Range Filters */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-600 ml-1">العملة:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setStatementCurrency('EGP');
                        fetchStatementData(activeCustomer, 'EGP', statementFromDate, statementToDate);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all min-h-[36px] ${
                        statementCurrency === 'EGP'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      جنيه مصري (EGP)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatementCurrency('SDG');
                        fetchStatementData(activeCustomer, 'SDG', statementFromDate, statementToDate);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all min-h-[36px] ${
                        statementCurrency === 'SDG'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      جنيه سوداني (SDG)
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-500">من:</span>
                      <input
                        type="date"
                        value={statementFromDate}
                        onChange={(e) => setStatementFromDate(e.target.value)}
                        className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono min-h-[34px]"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-500">إلى:</span>
                      <input
                        type="date"
                        value={statementToDate}
                        onChange={(e) => setStatementToDate(e.target.value)}
                        className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono min-h-[34px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchStatementData(activeCustomer, statementCurrency, statementFromDate, statementToDate)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold min-h-[34px]"
                    >
                      تطبيق
                    </button>
                    {(statementFromDate || statementToDate) && (
                      <button
                        type="button"
                        onClick={() => {
                          setStatementFromDate('');
                          setStatementToDate('');
                          fetchStatementData(activeCustomer, statementCurrency, '', '');
                        }}
                        className="px-2.5 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-xs font-bold min-h-[34px]"
                      >
                        كشف كامل
                      </button>
                    )}
                  </div>
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
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b-2 border-slate-900 pb-3 gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-white rounded-xl border border-slate-200 p-1 flex items-center justify-center shrink-0 shadow-xs overflow-hidden">
                        <img
                          src="/brand/logo.png"
                          alt="أبو جواد للتجارة"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base sm:text-xl font-black text-slate-900">
                            {statementData.companyName || 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)'}
                          </h2>
                        </div>
                        <p className="text-xs text-slate-500">نظام إدارة العملات والتحويلات المركزية</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">سجل تجاري معتمد • المركز الرئيسي • هاتف: {statementData.company?.phone || '+20 100 000 0000'}</p>
                      </div>
                    </div>
                    <div className="text-right sm:text-left font-mono text-xs border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                      <div className="font-bold text-blue-700 text-sm">كشف حساب عميل ({statementCurrency})</div>
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
                      <span className="font-mono text-slate-800 dir-ltr inline-block">{statementData.customer.phone}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">العملة / الفترة:</span>
                      <span className="font-bold text-slate-700">
                        {statementCurrency} • {statementFromDate || statementToDate ? `${statementFromDate || 'البداية'} ← ${statementToDate || 'الآن'}` : 'كشف كامل'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">حالة الحساب:</span>
                      <span
                        className={`font-bold ${
                          statementData.customer.status === 'closed'
                            ? 'text-rose-700'
                            : statementData.customer.status === 'blocked'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {statementData.customer.status === 'closed'
                          ? 'مقفل'
                          : statementData.customer.status === 'blocked'
                          ? 'محظور'
                          : 'نشط ومعتمد'}
                      </span>
                    </div>
                  </div>

                  {/* Ledger Summary Cards for Selected Currency */}
                  {statementData.ledgerStatement && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                        <div className="text-[10px] text-slate-500 mb-0.5">رصيد بداية المدة</div>
                        <div className="text-sm sm:text-base font-black text-slate-900 font-mono">
                          {Number(statementData.ledgerStatement.openingBalance || 0).toLocaleString()} {statementCurrency}
                        </div>
                      </div>
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center">
                        <div className="text-[10px] text-rose-700 mb-0.5">إجمالي عليه (مدين)</div>
                        <div className="text-sm sm:text-base font-black text-rose-800 font-mono">
                          {Number(statementData.ledgerStatement.totalDebit || 0).toLocaleString()} {statementCurrency}
                        </div>
                      </div>
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                        <div className="text-[10px] text-emerald-700 mb-0.5">إجمالي له (دائن)</div>
                        <div className="text-sm sm:text-base font-black text-emerald-800 font-mono">
                          {Number(statementData.ledgerStatement.totalCredit || 0).toLocaleString()} {statementCurrency}
                        </div>
                      </div>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-center">
                        <div className="text-[10px] text-blue-700 mb-0.5">الرصيد الختامي</div>
                        <div className="text-sm sm:text-base font-black text-blue-900 font-mono">
                          {Number(statementData.ledgerStatement.closingBalance || 0).toLocaleString()} {statementCurrency}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 5-Column RTL Statement Table (التاريخ | التفاصيل | عليه | له | الرصيد) */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-800 text-white font-bold border-b border-slate-900">
                          <tr>
                            <th className="p-2.5 w-24 text-center">التاريخ</th>
                            <th className="p-2.5">التفاصيل</th>
                            <th className="p-2.5 w-28 text-center">عليه</th>
                            <th className="p-2.5 w-28 text-center">له</th>
                            <th className="p-2.5 w-32 text-center">الرصيد</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-[11px]">
                          {(statementFromDate || (statementData.ledgerStatement?.openingBalance || 0) !== 0) && (
                            <tr className="bg-blue-50/70 font-bold">
                              <td className="p-2.5 text-center font-mono text-slate-600">{statementFromDate || '-'}</td>
                              <td className="p-2.5 text-slate-900">رصيد بداية المدة (الرصيد الافتتاحي)</td>
                              <td className="p-2.5 text-center font-mono text-slate-400">-</td>
                              <td className="p-2.5 text-center font-mono text-slate-400">-</td>
                              <td className="p-2.5 text-center font-mono text-slate-900">
                                {Number(statementData.ledgerStatement?.openingBalance || 0).toLocaleString()}
                              </td>
                            </tr>
                          )}

                          {(!statementData.ledgerStatement?.rows || statementData.ledgerStatement.rows.length === 0) ? (
                            <tr>
                              <td colSpan={5} className="p-6 text-center text-slate-400 font-sans">
                                لا توجد حركات مالية مسجلة في هذه الفترة بعملة {statementCurrency}
                              </td>
                            </tr>
                          ) : (
                            statementData.ledgerStatement.rows.map((r: any) => (
                              <tr key={r.id} className="hover:bg-slate-50">
                                <td className="p-2.5 text-center font-mono text-slate-600 whitespace-nowrap">{r.date}</td>
                                <td className="p-2.5 text-slate-900 leading-relaxed">{r.description}</td>
                                <td className="p-2.5 text-center font-mono font-bold text-rose-700 whitespace-nowrap">
                                  {r.debit > 0 ? Number(r.debit).toLocaleString() : '-'}
                                </td>
                                <td className="p-2.5 text-center font-mono font-bold text-emerald-700 whitespace-nowrap">
                                  {r.credit > 0 ? Number(r.credit).toLocaleString() : '-'}
                                </td>
                                <td
                                  className={`p-2.5 text-center font-mono font-black whitespace-nowrap ${
                                    r.runningBalance < 0 ? 'text-rose-700' : 'text-slate-900'
                                  }`}
                                >
                                  {Number(r.runningBalance).toLocaleString()}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                        {statementData.ledgerStatement && (
                          <tfoot className="bg-slate-100 border-t-2 border-slate-800 font-black text-xs">
                            <tr>
                              <td colSpan={2} className="p-2.5 text-slate-900">
                                {statementData.ledgerStatement.closingBalance < 0
                                  ? `الرصيد المطلوب من العميل (${statementCurrency})`
                                  : `الرصيد المتبقي للعميل (${statementCurrency})`}
                              </td>
                              <td className="p-2.5 text-center font-mono text-rose-700">
                                {Number(statementData.ledgerStatement.totalDebit || 0).toLocaleString()}
                              </td>
                              <td className="p-2.5 text-center font-mono text-emerald-700">
                                {Number(statementData.ledgerStatement.totalCredit || 0).toLocaleString()}
                              </td>
                              <td
                                className={`p-2.5 text-center font-mono ${
                                  statementData.ledgerStatement.closingBalance < 0 ? 'text-rose-700' : 'text-blue-700'
                                }`}
                              >
                                {Number(statementData.ledgerStatement.closingBalance || 0).toLocaleString()}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>

                  {statementCurrency === 'EGP' && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600">
                      <span className="font-bold text-slate-800">ملاحظة محاسبية: </span>
                      الاستحقاق والمتبقي بعملة EGP في هذا الكشف محسوبان تعاقدياً من إيصالات بنكك (SDG) المعتمدة وفق سعر الصرف التاريخي لكل جلسة، وليسا رصيداً دائناً مستقلاً في دفتر الأستاذ.
                    </div>
                  )}

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
          </div>,
          document.body
        )}

        {/* Account Closing Modal */}
        {mounted && closeModalOpen && detailCustomer && createPortal(
          <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 touch-none" onClick={() => !actionSubmitting && setCloseModalOpen(false)}>
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[85dvh] flex flex-col text-right overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-base">إقفال حساب العميل</h3>
                    <p className="text-[11px] text-slate-500">{detailCustomer.name} ({detailCustomer.customerCode})</p>
                  </div>
                </div>
                <button
                  onClick={() => setCloseModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Balances & Validation Checklist */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-slate-700">فحص أرصدة العملات والالتزامات المعلقة:</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <span className="text-[10px] text-slate-500 block">رصيد الجنيه المصري (EGP)</span>
                    <span className="font-bold text-slate-800 font-mono block">
                      مدين: {(customerDetails?.currencyBalances?.EGP?.debtor || 0).toLocaleString()} EGP
                    </span>
                    <span className="font-bold text-emerald-700 font-mono block">
                      دائن: {(customerDetails?.currencyBalances?.EGP?.creditor || 0).toLocaleString()} EGP
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <span className="text-[10px] text-slate-500 block">رصيد الجنيه السوداني (SDG)</span>
                    <span className="font-bold text-slate-800 font-mono block">
                      مدين: {(customerDetails?.currencyBalances?.SDG?.debtor || 0).toLocaleString()} SDG
                    </span>
                    <span className="font-bold text-blue-700 font-mono block">
                      دائن: {(customerDetails?.currencyBalances?.SDG?.creditor || 0).toLocaleString()} SDG
                    </span>
                  </div>
                </div>

                {/* Blocking reasons banner */}
                {customerDetails?.blockingReasons && customerDetails.blockingReasons.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5 text-amber-950">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>تنبيه: لا يمكن إقفال الحساب حتى تتم تسوية كافة الأرصدة والعمليات المعلقة:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800 pr-1">
                      {customerDetails.blockingReasons.map((reason: string, idx: number) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-amber-700 font-medium pt-1 border-t border-amber-200/60">
                      * يمنع النظام المحاسبي إقفال الحساب بوجود التزامات أو مستحقات مالية تفادياً لتجميد أموال العملاء أو تعليق تسويتها.
                    </p>
                  </div>
                )}
              </div>

              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
                  {actionError}
                </div>
              )}

              {/* Close Reason Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  سبب الإقفال وملاحظات الإدارة:
                </label>
                <textarea
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="مثال: انتهاء التعامل مع العميل وتصفية كافة الحسابات بالكامل..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCloseModalOpen(false)}
                  disabled={actionSubmitting}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleCloseAccount}
                  disabled={actionSubmitting || !customerDetails?.canClose}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {actionSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>تأكيد إقفال الحساب</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Account Reopening Modal */}
        {mounted && reopenModalOpen && detailCustomer && createPortal(
          <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 touch-none" onClick={() => !actionSubmitting && setReopenModalOpen(false)}>
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[85dvh] flex flex-col text-right overflow-hidden p-5 sm:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Unlock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-base">إعادة فتح حساب العميل</h3>
                    <p className="text-[11px] text-slate-500">{detailCustomer.name} ({detailCustomer.customerCode})</p>
                  </div>
                </div>
                <button
                  onClick={() => setReopenModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                سيتم إعادة تنشيط حساب العميل وتمكينه من إجراء عمليات صرافة جديدة، وإرفاق إشعارات بنكك، وصرف الحوالات النقدية.
              </p>

              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
                  {actionError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  سبب إعادة فتح الحساب <span className="text-rose-500">*</span>:
                </label>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="أدخل سبب إعادة فتح الحساب لتوثيقه في سجل التدقيق (5 أحرف على الأقل)..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReopenModalOpen(false)}
                  disabled={actionSubmitting}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleReopenAccount}
                  disabled={actionSubmitting || reopenReason.trim().length < 5}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {actionSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>تأكيد إعادة التنشيط</span>
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
