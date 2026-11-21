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

  // Side-by-side Review Modal State
  const [reviewReceipt, setReviewReceipt] = useState<any>(null);
  const [editTxnId, setEditTxnId] = useState('');
  const [editAmount, setEditAmount] = useState<number | string>('');
  const [editSender, setEditSender] = useState('');
  const [editReceiver, setEditReceiver] = useState('');
  const [editDate, setEditDate] = useState('');
  const [processingAction, setProcessingAction] = useState(false);

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

    // Fetch customers & open sessions for linking
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
      // Split pasted or formatted receipts text
      // If user inputs multiple receipts or single text
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
  };

  // Approve Receipt
  const handleApprove = async () => {
    if (!reviewReceipt) return;
    setProcessingAction(true);
    try {
      const res = await fetch(`/api/v1/receipts/${reviewReceipt.id}/approve`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل اعتماد الإيصال');
      }
      setReviewReceipt(null);
      fetchReceipts();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcessingAction(false);
    }
  };

  // Reject Receipt
  const handleReject = async () => {
    if (!reviewReceipt) return;
    const reason = prompt('سبب رفض الإيصال:', 'بيانات غير مطابقة أو إشعار غير صالح');
    if (!reason) return;

    setProcessingAction(true);
    try {
      const res = await fetch(`/api/v1/receipts/${reviewReceipt.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل رفض الإيصال');
      }
      setReviewReceipt(null);
      fetchReceipts();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcessingAction(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">إدارة إيصالات بنكك والتحقق الذكي (OCR)</h1>
            <p className="text-sm text-slate-500">
              رفع الإيصالات دفعة واحدة، فك النصوص تلقائياً، كشف الإيصالات المكررة واعتمادها مالياً
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <button
              onClick={() => setUploadModalOpen(true)}
              className="flex items-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all"
            >
              <Upload className="w-4 h-4" />
              <span>رفع إيصالات دفعة واحدة (Batch Upload)</span>
            </button>
            <button
              onClick={fetchReceipts}
              className="p-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50"
              title="تحديث"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-2 space-x-reverse flex-1 max-w-md">
            <div className="relative w-full">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchReceipts()}
                placeholder="بحث برقم العملية، اسم المرسل، أو المستفيد..."
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
            <button
              onClick={fetchReceipts}
              className="px-3.5 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
            >
              بحث
            </button>
          </div>

          <div className="flex items-center space-x-2 space-x-reverse overflow-x-auto pb-1 md:pb-0">
            {[
              { id: '', label: 'جميع الإيصالات' },
              { id: 'pending_review', label: 'بانتظار المراجعة' },
              { id: 'approved', label: 'معتمدة' },
              { id: 'duplicate', label: 'مكررة (تحذير)' },
              { id: 'rejected', label: 'مرفوضة' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setStatusFilter(btn.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
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

        {/* Receipts Data Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">رقم الإيصال</th>
                  <th className="p-3.5">رقم العملية (Bankak TXN)</th>
                  <th className="p-3.5">المبلغ (SDG)</th>
                  <th className="p-3.5">المرسل</th>
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
                    <td colSpan={9} className="text-center py-12 text-slate-400">
                      {loading ? 'جاري تحميل الإيصالات...' : 'لا توجد إيصالات تطابق البحث'}
                    </td>
                  </tr>
                ) : (
                  receipts.map((rcp) => (
                    <tr key={rcp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-medium text-slate-900">{rcp.receiptNumber}</td>
                      <td className="p-3.5 font-mono font-bold text-blue-700">{rcp.transactionId}</td>
                      <td className="p-3.5 font-mono font-black text-slate-900 text-sm">
                        {rcp.amount.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">SDG</span>
                      </td>
                      <td className="p-3.5">{rcp.senderName || '—'}</td>
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
                      <td className="p-3.5">
                        {rcp.status === 'approved' && (
                          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle className="w-3 h-3 text-emerald-600" />
                            <span>معتمد</span>
                          </span>
                        )}
                        {rcp.status === 'duplicate' && (
                          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 animate-pulse">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            <span>إيصال مكرر!</span>
                          </span>
                        )}
                        {rcp.status === 'pending_review' && (
                          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                            <span>بانتظار المراجعة</span>
                          </span>
                        )}
                        {rcp.status === 'rejected' && (
                          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                            <XCircle className="w-3 h-3 text-slate-500" />
                            <span>مرفوض</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => openReview(rcp)}
                          className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-xs transition-colors flex items-center justify-center space-x-1 space-x-reverse mx-auto"
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

        {/* BATCH UPLOAD MODAL */}
        {uploadModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 border border-slate-100 text-right">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <div className="flex items-center space-x-2.5 space-x-reverse">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-base">رفع إيصالات بنكك دفعة واحدة</h3>
                    <p className="text-xs text-slate-500">معالجة فورية بواسطة OCR، استخراج المبالغ ومنع التكرار</p>
                  </div>
                </div>
                <button
                  onClick={() => setUploadModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
                >
                  ✕
                </button>
              </div>

              {uploadMessage && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl text-xs font-bold">
                  {uploadMessage}
                </div>
              )}

              <form onSubmit={handleBatchUpload} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">ربط بعميل (اختياري)</label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500"
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
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500"
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      نصوص إيصالات بنكك (أو لصق إشعارات متعددة مفصولة بـ ---)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setBatchReceiptsText(
                          `Bank of Khartoum\nTransaction ID: 123456789\nAmount: 5,000,000 SDG\nSender: عمر أحمد\nDate: 21/11/2026\nTime: 10:15:00\n---\nBank of Khartoum\nTransaction ID: 987654321\nAmount: 3,000,000 SDG\nSender: عمر أحمد\nDate: 21/11/2026\nTime: 10:25:00\n---\nBank of Khartoum\nTransaction ID: 554433221\nAmount: 7,000,000 SDG\nSender: عمر أحمد\nDate: 21/11/2026\nTime: 10:40:00\n---\nBank of Khartoum\nTransaction ID: 998877665\nAmount: 5,000,000 SDG\nSender: عمر أحمد\nDate: 21/11/2026\nTime: 11:00:00`
                        );
                      }}
                      className="text-[11px] text-blue-600 font-bold hover:underline"
                    >
                      تحميل مثال إشعارات عمر أحمد (20 مليون SDG مجزأة)
                    </button>
                  </div>
                  <textarea
                    rows={8}
                    value={batchReceiptsText}
                    onChange={(e) => setBatchReceiptsText(e.target.value)}
                    required
                    placeholder="الصق نصوص أو بيانات إيصالات بنكك هنا... النظام سيتعرف تلقائياً على رقم العملية والمبلغ وتاريخ التحويل وأسماء الأطراف."
                    className="w-full p-3 font-mono text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => setUploadModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-md shadow-blue-500/20 disabled:opacity-50"
                  >
                    {uploading ? 'جاري التحليل واستخراج البيانات...' : 'معالجة ورفع الدفعة'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SIDE-BY-SIDE REVIEW & APPROVAL MODAL (Section 9.4) */}
        {reviewReceipt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 border border-slate-100 text-right">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <FileCheck2 className="w-5 h-5 text-blue-600" />
                  <h3 className="font-black text-slate-900 text-base">
                    مراجعة وتدقيق إيصال بنكك • {reviewReceipt.receiptNumber}
                  </h3>
                </div>
                <button
                  onClick={() => setReviewReceipt(null)}
                  className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
                >
                  ✕
                </button>
              </div>

              {/* Duplicate Alert if duplicate */}
              {reviewReceipt.status === 'duplicate' && (
                <div className="mb-6 p-4 bg-rose-50 border border-rose-300 rounded-2xl flex items-center space-x-3 space-x-reverse text-rose-900">
                  <AlertTriangle className="w-6 h-6 text-rose-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-black text-sm">تحذير حاسم: هذا الإيصال مسجل مسبقاً في النظام!</h4>
                    <p className="text-xs text-rose-700 mt-0.5">
                      تم اكتشاف رقم العملية ({reviewReceipt.transactionId}) أو بصمة الصورة مسبقاً. تم منع احتسابه في الإجمالي تلقائياً لمنع التكرار المحاسبي.
                    </p>
                  </div>
                </div>
              )}

              {/* Side-by-side grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Right: Visual Simulated Receipt Preview */}
                <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-col justify-between border border-slate-800 shadow-inner">
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <Building className="w-5 h-5 text-emerald-400" />
                        <span className="font-bold text-sm text-white">بنك الخرطوم (Bank of Khartoum)</span>
                      </div>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-bold">
                        إشعار تحويل بنكك
                      </span>
                    </div>

                    <div className="text-center py-4 my-2 bg-slate-800/60 rounded-xl border border-slate-800">
                      <div className="text-xs text-slate-400 mb-1">المبلغ المحول</div>
                      <div className="text-2xl font-black text-emerald-400 font-mono">
                        {Number(editAmount || 0).toLocaleString()} <span className="text-xs text-slate-400">SDG</span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs text-slate-300 mt-4">
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400">رقم العملية (Transaction ID):</span>
                        <span className="font-mono font-bold text-white">{editTxnId}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400">المرسل (Sender):</span>
                        <span className="font-medium text-white">{editSender || 'غير محدد'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400">المستفيد (Beneficiary):</span>
                        <span className="font-medium text-white">{editReceiver || 'مكتب الصرافة'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800">
                        <span className="text-slate-400">التاريخ:</span>
                        <span className="font-mono text-white">{editDate || '2026-11-21'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between items-center">
                    <span>درجة ثقة OCR: {reviewReceipt.ocrConfidence}%</span>
                    <span className="font-mono">Hash: {reviewReceipt.imageHash.substring(0, 10)}...</span>
                  </div>
                </div>

                {/* Left: Extracted & Editable Fields */}
                <div className="space-y-4">
                  <h4 className="font-bold text-sm text-slate-900 flex items-center space-x-1.5 space-x-reverse">
                    <span>بيانات الإيصال المستخرجة (قابلة للمراجعة والتصحيح)</span>
                  </h4>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم العملية (Transaction ID)</label>
                    <input
                      type="text"
                      value={editTxnId}
                      onChange={(e) => setEditTxnId(e.target.value)}
                      className="w-full px-3 py-2 font-mono text-xs font-bold rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ (SDG)</label>
                    <input
                      type="number"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full px-3 py-2 font-mono text-xs font-black rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">اسم المرسل</label>
                    <input
                      type="text"
                      value={editSender}
                      onChange={(e) => setEditSender(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">التاريخ</label>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">العميل المرتبط</label>
                      <div className="p-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-800">
                        {reviewReceipt.customer?.name || 'غير محدد'}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <button
                      onClick={handleReject}
                      disabled={processingAction || reviewReceipt.status === 'approved'}
                      className="px-4 py-2.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                    >
                      رفض الإيصال
                    </button>
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <button
                        onClick={() => setReviewReceipt(null)}
                        className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50"
                      >
                        إغلاق
                      </button>
                      <button
                        onClick={handleApprove}
                        disabled={processingAction || reviewReceipt.status === 'approved' || reviewReceipt.status === 'duplicate'}
                        className="px-6 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center space-x-1.5 space-x-reverse disabled:opacity-40"
                      >
                        <Check className="w-4 h-4" />
                        <span>اعتماد الإيصال وتسجيل القيد المالي</span>
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
