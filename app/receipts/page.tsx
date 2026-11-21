'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import {
  FileCheck2,
  Upload,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  RefreshCw,
  Search,
  Check,
  Building,
  User,
  Calendar,
  Layers,
  X,
  Save,
  ChevronLeft,
} from 'lucide-react';

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  // Upload state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [batchReceiptsText, setBatchReceiptsText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');

  // Review Modal State
  const [reviewReceipt, setReviewReceipt] = useState<any>(null);
  const [editTxnId, setEditTxnId] = useState('');
  const [editAmount, setEditAmount] = useState<number | string>('');
  const [editSender, setEditSender] = useState('');
  const [editReceiver, setEditReceiver] = useState('');
  const [editDate, setEditDate] = useState('');
  const [verifySource, setVerifySource] = useState('mobile_app');
  const [verifyNotes, setVerifyNotes] = useState('');
  const [processingAction, setProcessingAction] = useState(false);
  const [modalFeedback, setModalFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchReceipts = () => {
    setLoading(true);
    let url = '/api/v1/receipts?';
    if (statusFilter) url += `status=${statusFilter}&`;
    if (search) url += `search=${encodeURIComponent(search)}&`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setReceipts(data.data || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReceipts();

    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setCustomers(data.data || []);
      });

    fetch('/api/v1/customer-sessions?status=open')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSessions(data.data || []);
      });
  }, [statusFilter]);

  // Handle Batch Receipt Upload
  const handleBatchUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setUploadMessage('');

    try {
      const rawTextBlocks = batchReceiptsText.split(/\n\s*---\s*\n|\n\s*===\s*\n/);
      const items = rawTextBlocks.map((block, idx) => {
        return {
          customerId: selectedCustomerId || null,
          customerSessionId: selectedSessionId || null,
          rawOcrText: block.trim(),
          imageData: `simulated-bankak-receipt-image-${Date.now()}-${idx + 1}.png`,
        };
      });

      const res = await fetch('/api/v1/receipts/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل رفع الإيصالات');
      }

      setUploadMessage(`تم رفع ومعالجة ${data.count} إيصال بنجاح بواسطة محرك OCR!`);
      setBatchReceiptsText('');
      fetchReceipts();
      setTimeout(() => {
        setUploadModalOpen(false);
        setUploadMessage('');
      }, 1500);
    } catch (err: any) {
      setUploadMessage(`خطأ: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Open Review Drawer
  const openReview = (rcp: any) => {
    setReviewReceipt(rcp);
    setEditTxnId(rcp.transactionId);
    setEditAmount(rcp.amount);
    setEditSender(rcp.senderName || '');
    setEditReceiver(rcp.receiverName || '');
    setEditDate(rcp.transactionDate || '');
    setModalFeedback(null);
  };

  // Save Manual Edits
  const handleSaveEdits = async () => {
    if (!reviewReceipt) return;
    setProcessingAction(true);
    setModalFeedback(null);
    try {
      const res = await fetch(`/api/v1/receipts/${reviewReceipt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: editTxnId,
          amount: Number(editAmount),
          senderName: editSender,
          receiverName: editReceiver,
          transactionDate: editDate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تحديث بيانات الإيصال');
      }
      setReviewReceipt(data.data);
      setModalFeedback({ type: 'success', message: 'تم حفظ وتوثيق تعديلات الإيصال بنجاح' });
      fetchReceipts();
    } catch (err: any) {
      setModalFeedback({ type: 'error', message: err.message });
    } finally {
      setProcessingAction(false);
    }
  };

  // Verify Receipt (Step 1)
  const handleVerify = async () => {
    if (!reviewReceipt) return;
    setProcessingAction(true);
    setModalFeedback(null);
    try {
      // Save changes if modified
      const hasChanges =
        editTxnId !== reviewReceipt.transactionId ||
        Number(editAmount) !== Number(reviewReceipt.amount) ||
        editSender !== (reviewReceipt.senderName || '') ||
        editReceiver !== (reviewReceipt.receiverName || '') ||
        editDate !== (reviewReceipt.transactionDate || '');

      if (hasChanges) {
        const patchRes = await fetch(`/api/v1/receipts/${reviewReceipt.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: editTxnId,
            amount: Number(editAmount),
            senderName: editSender,
            receiverName: editReceiver,
            transactionDate: editDate,
          }),
        });
        const patchData = await patchRes.json();
        if (!patchRes.ok || !patchData.success) {
          throw new Error(patchData.error || 'فشل حفظ التعديلات قبل التحقق');
        }
      }

      const res = await fetch(`/api/v1/receipts/${reviewReceipt.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationSource: verifySource,
          verificationNotes: verifyNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل التحقق من الإيصال');
      }
      setReviewReceipt(data.data);
      setModalFeedback({ type: 'success', message: 'تم تأكيد التحقق البنكي بنجاح، الإيصال جاهز للاعتماد' });
      fetchReceipts();
    } catch (err: any) {
      setModalFeedback({ type: 'error', message: err.message });
    } finally {
      setProcessingAction(false);
    }
  };

  // Approve Receipt & Post Ledger (Step 2)
  const handleApprove = async () => {
    if (!reviewReceipt) return;
    setProcessingAction(true);
    setModalFeedback(null);
    try {
      // Save changes if modified
      const hasChanges =
        editTxnId !== reviewReceipt.transactionId ||
        Number(editAmount) !== Number(reviewReceipt.amount) ||
        editSender !== (reviewReceipt.senderName || '') ||
        editReceiver !== (reviewReceipt.receiverName || '') ||
        editDate !== (reviewReceipt.transactionDate || '');

      if (hasChanges) {
        const patchRes = await fetch(`/api/v1/receipts/${reviewReceipt.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: editTxnId,
            amount: Number(editAmount),
            senderName: editSender,
            receiverName: editReceiver,
            transactionDate: editDate,
          }),
        });
        const patchData = await patchRes.json();
        if (!patchRes.ok || !patchData.success) {
          throw new Error(patchData.error || 'فشل حفظ التعديلات قبل الاعتماد');
        }
      }

      const res = await fetch(`/api/v1/receipts/${reviewReceipt.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directVerification: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل اعتماد الإيصال');
      }
      setReviewReceipt(null);
      fetchReceipts();
    } catch (err: any) {
      setModalFeedback({ type: 'error', message: err.message });
    } finally {
      setProcessingAction(false);
    }
  };

  // Reject Receipt
  const handleReject = async () => {
    if (!reviewReceipt) return;
    const reason = prompt('سبب رفض الإيصال (إلزامي للتوثيق والرقابة):', 'بيانات غير مطابقة أو إشعار غير صالح');
    if (!reason || !reason.trim()) return;

    setProcessingAction(true);
    setModalFeedback(null);
    try {
      const res = await fetch(`/api/v1/receipts/${reviewReceipt.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل رفض الإيصال');
      }
      setReviewReceipt(null);
      fetchReceipts();
    } catch (err: any) {
      setModalFeedback({ type: 'error', message: err.message });
    } finally {
      setProcessingAction(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            <span>معتمد مالياً</span>
          </span>
        );
      case 'verified':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
            <CheckCircle className="w-3 h-3 text-blue-600" />
            <span>تم التحقق بنكياً</span>
          </span>
        );
      case 'suspicious':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 animate-pulse">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span>مشتبه به!</span>
          </span>
        );
      case 'duplicate':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 animate-pulse">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>إيصال مكرر!</span>
          </span>
        );
      case 'pending_verification':
      case 'pending_review':
      case 'uploaded':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
            <span>بانتظار التحقق</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
            <XCircle className="w-3 h-3 text-slate-500" />
            <span>مرفوض</span>
          </span>
        );
      default:
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">إدارة إيصالات بنكك والـ OCR</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              رفع الإيصالات، فك النصوص تلقائياً، كشف التكرار والاعتماد المالي
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse self-stretch sm:self-auto">
            <button
              onClick={() => setUploadModalOpen(true)}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
            >
              <Upload className="w-4 h-4" />
              <span>رفع إيصالات دفعة واحدة</span>
            </button>
            <button
              onClick={fetchReceipts}
              className="p-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
              title="تحديث"
              aria-label="تحديث الإيصالات"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 space-x-reverse w-full md:max-w-md">
            <div className="relative w-full">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchReceipts()}
                placeholder="بحث برقم العملية، المرسل، أو المستفيد..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            </div>
            <button
              onClick={fetchReceipts}
              className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs sm:text-sm font-semibold hover:bg-slate-800 min-h-[44px] shrink-0"
            >
              بحث
            </button>
          </div>

          <div className="flex items-center space-x-1.5 space-x-reverse overflow-x-auto touch-scroll pb-1 md:pb-0">
            {[
              { id: '', label: 'الكل' },
              { id: 'pending_verification', label: 'بانتظار التحقق' },
              { id: 'verified', label: 'تم التحقق بنكياً' },
              { id: 'approved', label: 'معتمدة' },
              { id: 'duplicate', label: 'مكررة' },
              { id: 'rejected', label: 'مرفوضة' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setStatusFilter(btn.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all min-h-[38px] ${
                  statusFilter === btn.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* 1. MOBILE CARDS VIEW: (Visible on screens < 1024px) */}
        <div className="lg:hidden space-y-3">
          {receipts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs sm:text-sm">
              {loading ? 'جاري تحميل الإيصالات...' : 'لا توجد إيصالات تطابق البحث'}
            </div>
          ) : (
            receipts.map((rcp) => (
              <div
                key={rcp.id}
                onClick={() => openReview(rcp)}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:bg-slate-50 transition-colors flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold bg-slate-100 px-2.5 py-1 rounded-lg text-slate-800">
                    {rcp.receiptNumber}
                  </span>
                  <div>{getStatusBadge(rcp.status)}</div>
                </div>

                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <span className="text-[10px] text-slate-400 block">رقم العملية (Bankak TXN):</span>
                    <span className="font-mono font-bold text-sm text-blue-700">{rcp.transactionId}</span>
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] text-slate-400 block">المبلغ:</span>
                    <span className="font-mono font-black text-base text-slate-900">
                      {Number(rcp.amount).toLocaleString()} <span className="text-xs text-slate-400 font-normal">SDG</span>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-50 rounded-xl mb-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">المرسل:</span>
                    <span className="font-medium text-slate-800 truncate block">{rcp.senderName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">العميل المرتبط:</span>
                    <span className="font-medium text-blue-700 truncate block">{rcp.customer?.name || 'عام'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">التاريخ:</span>
                    <span className="font-mono text-slate-600 text-[11px]">{rcp.transactionDate} {rcp.transactionTime}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">دقة الـ OCR:</span>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      rcp.ocrConfidence >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {rcp.ocrConfidence}%
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="w-full py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl text-xs flex items-center justify-center space-x-1 space-x-reverse min-h-[40px]"
                >
                  <Eye className="w-4 h-4" />
                  <span>معاينة وتدقيق الإيصال</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* 2. DESKTOP VIEW: Data Table (Visible on screens >= 1024px) */}
        <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">رقم الإيصال</th>
                  <th className="p-3.5">رقم العملية (Bankak TXN)</th>
                  <th className="p-3.5">المبلغ (SDG)</th>
                  <th className="p-3.5">المرسل</th>
                  <th className="p-3.5">المستفيد</th>
                  <th className="p-3.5">العميل المرتبط</th>
                  <th className="p-3.5">التاريخ والوقت</th>
                  <th className="p-3.5">دقة OCR</th>
                  <th className="p-3.5">الحالة</th>
                  <th className="p-3.5 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {receipts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-slate-400">
                      {loading ? 'جاري تحميل الإيصالات...' : 'لا توجد إيصالات تطابق البحث'}
                    </td>
                  </tr>
                ) : (
                  receipts.map((rcp) => (
                    <tr key={rcp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-medium text-slate-900">{rcp.receiptNumber}</td>
                      <td className="p-3.5 font-mono font-bold text-blue-700">{rcp.transactionId}</td>
                      <td className="p-3.5 font-mono font-black text-slate-900 text-sm">
                        {Number(rcp.amount).toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">SDG</span>
                      </td>
                      <td className="p-3.5">{rcp.senderName || '—'}</td>
                      <td className="p-3.5">{rcp.receiverName || 'مكتب الصرافة'}</td>
                      <td className="p-3.5 font-medium">{rcp.customer?.name || 'غير محدد'}</td>
                      <td className="p-3.5 font-mono text-[11px] text-slate-500">
                        {rcp.transactionDate} {rcp.transactionTime}
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          rcp.ocrConfidence >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {rcp.ocrConfidence}%
                        </span>
                      </td>
                      <td className="p-3.5">{getStatusBadge(rcp.status)}</td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => openReview(rcp)}
                          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-xs transition-colors flex items-center justify-center space-x-1 space-x-reverse mx-auto"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>معاينة واعتماد</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* BATCH UPLOAD MODAL / BOTTOM SHEET */}
        {uploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto touch-scroll rounded-t-3xl sm:rounded-3xl shadow-2xl p-4 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2.5 space-x-reverse min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">رفع إيصالات بنكك دفعة واحدة</h3>
                    <p className="text-[11px] sm:text-xs text-slate-500 truncate">معالجة فورية بواسطة OCR، استخراج المبالغ ومنع التكرار</p>
                  </div>
                </div>
                <button
                  onClick={() => setUploadModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {uploadMessage && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl text-xs font-bold">
                  {uploadMessage}
                </div>
              )}

              <form onSubmit={handleBatchUpload} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">ربط بعميل (اختياري)</label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                    >
                      <option value="">بدون تحديد عميل (عام)</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.customerCode})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">ربط بجلسة يومية (اختياري)</label>
                    <select
                      value={selectedSessionId}
                      onChange={(e) => setSelectedSessionId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                    >
                      <option value="">بدون ربط بجلسة محددة</option>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.sessionNumber} - {s.customer?.name} ({s.businessDate})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-1 gap-1">
                    <label className="block text-xs font-bold text-slate-700">
                      نصوص إيصالات بنكك (أو لصق إشعارات متعددة مفصولة بـ ---)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setBatchReceiptsText(
                          `Bank of Khartoum\nTransaction ID: 123456789\nAmount: 5,000,000 SDG\nSender: عمر أحمد\nReceiver: مكتب الصرافة\nDate: 21/11/2026\nTime: 10:15:00\n---\nBank of Khartoum\nTransaction ID: 987654321\nAmount: 3,000,000 SDG\nSender: عمر أحمد\nReceiver: مكتب الصرافة\nDate: 21/11/2026\nTime: 10:25:00\n---\nBank of Khartoum\nTransaction ID: 554433221\nAmount: 7,000,000 SDG\nSender: عمر أحمد\nReceiver: مكتب الصرافة\nDate: 21/11/2026\nTime: 10:40:00\n---\nBank of Khartoum\nTransaction ID: 998877665\nAmount: 5,000,000 SDG\nSender: عمر أحمد\nReceiver: مكتب الصرافة\nDate: 21/11/2026\nTime: 11:00:00`
                        );
                      }}
                      className="text-[11px] text-blue-600 font-bold hover:underline self-start sm:self-auto"
                    >
                      تحميل نموذج تجريبي (عمر أحمد)
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={batchReceiptsText}
                    onChange={(e) => setBatchReceiptsText(e.target.value)}
                    required
                    placeholder="الصق نصوص أو بيانات إيصالات بنكك هنا..."
                    className="w-full p-3 font-mono text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setUploadModalOpen(false)}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 active:bg-blue-800 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px]"
                  >
                    {uploading ? 'جاري التحليل واستخراج البيانات...' : 'معالجة ورفع الدفعة'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SIDE-BY-SIDE REVIEW & APPROVAL MODAL / BOTTOM SHEET */}
        {reviewReceipt && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-4xl max-h-[92vh] overflow-y-auto touch-scroll p-4 sm:p-6 text-right safe-area-pb">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                  <FileCheck2 className="w-5 h-5 text-blue-600 shrink-0" />
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                    مراجعة إيصال بنكك • {reviewReceipt.receiptNumber}
                  </h3>
                </div>
                <button
                  onClick={() => setReviewReceipt(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Feedback Alert Banner */}
              {modalFeedback && (
                <div className={`mb-4 p-3.5 rounded-2xl flex items-center space-x-2 space-x-reverse text-xs sm:text-sm font-bold ${
                  modalFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border border-rose-200'
                }`}>
                  {modalFeedback.type === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{modalFeedback.message}</span>
                </div>
              )}

              {/* Duplicate Alert if duplicate */}
              {reviewReceipt.status === 'duplicate' && (
                <div className="mb-4 p-3.5 bg-rose-50 border border-rose-300 rounded-2xl flex items-center space-x-3 space-x-reverse text-rose-900">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                  <div>
                    <h4 className="font-black text-xs sm:text-sm">تحذير حاسم: هذا الإيصال مسجل مسبقاً في النظام!</h4>
                    <p className="text-[11px] sm:text-xs text-rose-700 mt-0.5">
                      تم اكتشاف رقم العملية ({reviewReceipt.transactionId}) مسبقاً، وتم منعه لحماية الدفاتر المحاسبية.
                    </p>
                  </div>
                </div>
              )}

              {/* Suspicious Alert if suspicious */}
              {reviewReceipt.status === 'suspicious' && (
                <div className="mb-4 p-3.5 bg-amber-50 border border-amber-300 rounded-2xl flex items-center space-x-3 space-x-reverse text-amber-900">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <h4 className="font-black text-xs sm:text-sm">تنبيه: اشتباه في تطابق الإيصال مع معاملة سابقة</h4>
                    <p className="text-[11px] sm:text-xs text-amber-700 mt-0.5">
                      {reviewReceipt.suspicionReason || 'يرجى مراجعة تفاصيل الحساب البنكي والتحقق من صحة التحويل قبل الاعتماد.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Stack on mobile, 2-cols on desktop */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                {/* Visual Simulated Receipt Preview */}
                <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-slate-800 shadow-inner">
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <Building className="w-5 h-5 text-emerald-400 shrink-0" />
                        <span className="font-bold text-xs sm:text-sm text-white">بنك الخرطوم (BOK)</span>
                      </div>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-bold">
                        إشعار تحويل بنكك
                      </span>
                    </div>

                    <div className="text-center py-3 my-2 bg-slate-800/60 rounded-xl border border-slate-800">
                      <div className="text-[11px] text-slate-400 mb-0.5">المبلغ المحول</div>
                      <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
                        {Number(editAmount || 0).toLocaleString()} <span className="text-xs text-slate-400 font-normal">SDG</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-300 mt-3">
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400 text-[11px]">رقم العملية:</span>
                        <span className="font-mono font-bold text-white truncate max-w-[180px]">{editTxnId}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400 text-[11px]">المرسل:</span>
                        <span className="font-medium text-white truncate max-w-[180px]">{editSender || 'غير محدد'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400 text-[11px]">المستفيد:</span>
                        <span className="font-medium text-white truncate max-w-[180px]">{editReceiver || 'مكتب الصرافة'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400 text-[11px]">التاريخ:</span>
                        <span className="font-mono text-white">{editDate || '2026-11-21'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-2.5 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between items-center">
                    <span>ثقة OCR: {reviewReceipt.ocrConfidence}%</span>
                    <span className="font-mono">Hash: {reviewReceipt.imageHash?.substring(0, 10)}...</span>
                  </div>
                </div>

                {/* Editable Fields */}
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs sm:text-sm text-slate-900">
                      بيانات الإيصال المستخرجة (قابلة للمراجعة والتصحيح)
                    </h4>
                    {reviewReceipt.reviewedBy && (
                      <span className="text-[10px] text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded">
                        آخر تعديل: {reviewReceipt.reviewedBy}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم العملية (Transaction ID)</label>
                    <input
                      type="text"
                      disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                      value={editTxnId}
                      onChange={(e) => setEditTxnId(e.target.value)}
                      className="w-full px-3.5 py-2.5 font-mono text-sm font-bold rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px] disabled:bg-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ (SDG)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full px-3.5 py-2.5 font-mono text-sm font-black rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px] disabled:bg-slate-100"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">اسم المرسل</label>
                      <input
                        type="text"
                        disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                        value={editSender}
                        onChange={(e) => setEditSender(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px] disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">المستفيد</label>
                      <input
                        type="text"
                        disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                        value={editReceiver}
                        onChange={(e) => setEditReceiver(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px] disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">التاريخ</label>
                      <input
                        type="date"
                        disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[44px] disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">العميل المرتبط</label>
                      <div className="p-2.5 bg-slate-100 rounded-xl text-xs font-bold text-slate-800 truncate min-h-[44px] flex items-center">
                        {reviewReceipt.customer?.name || 'غير محدد'}
                      </div>
                    </div>
                  </div>

                  {/* Save Edits Action Button */}
                  {reviewReceipt.status !== 'approved' && reviewReceipt.status !== 'rejected' && (
                    <button
                      type="button"
                      onClick={handleSaveEdits}
                      disabled={processingAction}
                      className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center justify-center space-x-1 space-x-reverse min-h-[40px] transition-colors"
                    >
                      <Save className="w-4 h-4 text-slate-600" />
                      <span>حفظ التعديلات المدخلة</span>
                    </button>
                  )}

                  {/* Verification Section */}
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-blue-900">التحقق من وصول الأموال بنكياً:</span>
                      {reviewReceipt.verifiedBy ? (
                        <span className="text-[11px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-full">
                          تم التحقق بواسطة {reviewReceipt.verifiedBy} ({reviewReceipt.verificationSource || 'تطبيق بنكك'})
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-700 font-bold bg-amber-100 px-2 py-0.5 rounded-full">
                          بانتظار التحقق من كشف الحساب/التطبيق
                        </span>
                      )}
                    </div>

                    {!reviewReceipt.verifiedBy && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">مصدر التحقق</label>
                          <select
                            value={verifySource}
                            onChange={(e) => setVerifySource(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 min-h-[38px]"
                          >
                            <option value="mobile_app">تطبيق بنكك (الهاتف)</option>
                            <option value="bank_statement">كشف حساب بنك الخرطوم</option>
                            <option value="teller_confirmation">إشعار صراف معتمد</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">ملاحظات التحقق</label>
                          <input
                            type="text"
                            value={verifyNotes}
                            onChange={(e) => setVerifyNotes(e.target.value)}
                            placeholder="مثال: مطابقة الرصيد اللحظي"
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 min-h-[38px]"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                    <button
                      onClick={handleReject}
                      disabled={processingAction || reviewReceipt.status === 'approved'}
                      className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 rounded-xl text-xs font-bold transition-all disabled:opacity-40 min-h-[44px]"
                    >
                      رفض الإيصال
                    </button>
                    <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2">
                      {!reviewReceipt.verifiedBy && reviewReceipt.status !== 'approved' && reviewReceipt.status !== 'duplicate' && (
                        <button
                          type="button"
                          onClick={handleVerify}
                          disabled={processingAction}
                          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-40 min-h-[44px]"
                        >
                          تأكيد التحقق البنكي (Verify)
                        </button>
                      )}
                      <button
                        onClick={() => setReviewReceipt(null)}
                        className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 min-h-[44px]"
                      >
                        إلغاء
                      </button>
                      <button
                        onClick={handleApprove}
                        disabled={processingAction || reviewReceipt.status === 'approved' || reviewReceipt.status === 'duplicate'}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center space-x-1.5 space-x-reverse disabled:opacity-40 min-h-[44px]"
                      >
                        <Check className="w-4 h-4 shrink-0" />
                        <span>الاعتماد المالي وقيد اليومية</span>
                      </button>
                    </div>
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
