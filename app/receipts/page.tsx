'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Camera,
  Image as ImageIcon,
  Trash2,
  Plus,
  ExternalLink,
  ZoomIn,
  FileText,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Copy,
} from 'lucide-react';

interface PendingImageFile {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  sizeFormatted: string;
  base64Data: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
}

export default function ReceiptsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [receipts, setReceipts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTab, setUploadTab] = useState<'images' | 'text'>('images');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<PendingImageFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [batchReceiptsText, setBatchReceiptsText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStageText, setUploadStageText] = useState('جاري المعالجة واستخراج الـ OCR...');
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadSummary, setUploadSummary] = useState<{
    total: number;
    success: number;
    duplicates: number;
    suspicious: number;
    needsReview: number;
    message?: string;
  } | null>(null);
  const [postUploadBanner, setPostUploadBanner] = useState<{
    total: number;
    success: number;
    duplicates: number;
    suspicious: number;
    needsReview: number;
    message: string;
  } | null>(null);
  const [copiedTxnId, setCopiedTxnId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const handleCopyTxn = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!id) return;
    navigator.clipboard.writeText(id);
    setCopiedTxnId(id);
    setTimeout(() => setCopiedTxnId(null), 2000);
  };

  // Hidden file inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Review Modal State
  const [reviewReceipt, setReviewReceipt] = useState<any>(null);
  const [editTxnId, setEditTxnId] = useState('');
  const [editAmount, setEditAmount] = useState<number | string>('');
  const [editSender, setEditSender] = useState('');
  const [editSenderAccount, setEditSenderAccount] = useState('');
  const [editReceiver, setEditReceiver] = useState('');
  const [editReceiverAccount, setEditReceiverAccount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [showRawOcr, setShowRawOcr] = useState(false);
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

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Convert File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Client-side image optimization: preserves original quality for normal receipts (<3MB) and resizes huge camera photos (>3MB)
  const optimizeImageForOcr = async (file: File): Promise<{ base64: string; sizeFormatted: string }> => {
    // Preserve 100% original pixel sharpness without lossy canvas compression for screenshot receipts
    if (file.size <= 3 * 1024 * 1024) {
      const base64 = await fileToBase64(file);
      return { base64, sizeFormatted: formatFileSize(file.size) };
    }

    return new Promise((resolve) => {
      if (!file.type.startsWith('image/') || file.type.includes('svg')) {
        fileToBase64(file).then((b) => resolve({ base64: b, sizeFormatted: formatFileSize(file.size) }));
        return;
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const maxDim = 1800; // Crisp resolution for high-res photos
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fileToBase64(file).then((b) => resolve({ base64: b, sizeFormatted: formatFileSize(file.size) }));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.95);
        const approxBytes = Math.round((optimizedBase64.length - optimizedBase64.indexOf(',') - 1) * 0.75);
        resolve({ base64: optimizedBase64, sizeFormatted: formatFileSize(approxBytes) });
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        fileToBase64(file).then((b) => resolve({ base64: b, sizeFormatted: formatFileSize(file.size) }));
      };

      img.src = objectUrl;
    });
  };

  // Handle incoming files from file picker, camera, or drop
  const handleFilesAdded = async (files: FileList | File[]) => {
    const validFiles: File[] = [];
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (allowedTypes.includes(file.type)) {
        if (file.size <= 15 * 1024 * 1024) {
          validFiles.push(file);
        } else {
          alert(`الملف ${file.name} يتجاوز الحد الأقصى (15 ميغابايت)`);
        }
      } else {
        alert(`نوع الملف ${file.name} غير مدعوم. يرجى اختيار صور بصيغة PNG أو JPG أو WebP`);
      }
    }

    if (validFiles.length === 0) return;

    const newEntries: PendingImageFile[] = [];
    for (const file of validFiles) {
      try {
        const { base64, sizeFormatted } = await optimizeImageForOcr(file);
        const previewUrl = URL.createObjectURL(file);
        newEntries.push({
          id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          file,
          previewUrl,
          name: file.name,
          sizeFormatted,
          base64Data: base64,
          status: 'pending',
        });
      } catch (err) {
        console.error('Error reading file:', err);
      }
    }

    setSelectedFiles((prev) => [...prev, ...newEntries]);
    setUploadSummary(null);
  };

  // Remove single image
  const removeFile = (id: string) => {
    setSelectedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  // Clear all images
  const clearAllFiles = () => {
    selectedFiles.forEach((f) => {
      if (f.previewUrl.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl);
    });
    setSelectedFiles([]);
    setUploadSummary(null);
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  // Submit batch of images or text with progressive feedback & timeout protection
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return; // Prevent double submit

    setUploading(true);
    setUploadSummary(null);

    try {
      if (uploadTab === 'images') {
        if (selectedFiles.length === 0) {
          throw new Error('يرجى اختيار صورة إيصال واحدة على الأقل أو التقاطها بالكاميرا');
        }

        const total = selectedFiles.length;
        setUploadProgress({ current: 0, total });
        setUploadStageText(`بدء المعالجة واستخراج الـ OCR لـ (${total}) صور...`);

        const allReturned: any[] = [];
        let dupCount = 0;
        let suspCount = 0;
        let reviewCount = 0;
        const failedErrors: string[] = [];

        // Process images with concurrency-friendly individual requests to eliminate timeouts & isolate errors
        for (let i = 0; i < total; i++) {
          const currentFile = selectedFiles[i];
          setUploadProgress({ current: i + 1, total });
          setUploadStageText(`جاري قراءة واستخراج بيانات الصورة (${i + 1} من ${total})...`);

          // Mark current file as uploading
          setSelectedFiles((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' } : f))
          );

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s per individual image guard

          try {
            const res = await fetch('/api/v1/receipts/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [
                  {
                    customerId: selectedCustomerId || null,
                    customerSessionId: selectedSessionId || null,
                    imageData: currentFile.base64Data,
                  },
                ],
              }),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.error || 'فشل استخراج بيانات الإيصال');
            }

            const returned = data.data?.[0];
            if (returned) {
              allReturned.push(returned);
              if (returned.isDuplicate || returned.status === 'duplicate') dupCount++;
              else if (returned.isSuspicious || returned.status === 'suspicious') suspCount++;
              else if (returned.status !== 'approved' && (returned.status === 'pending_review' || returned.ocrConfidence < 70)) reviewCount++;

              // Mark as success
              setSelectedFiles((prev) =>
                prev.map((f, idx) => (idx === i ? { ...f, status: 'success' } : f))
              );
            }
          } catch (fileErr: any) {
            clearTimeout(timeoutId);
            const isTimeout = fileErr.name === 'AbortError';
            const errorMsg = isTimeout
              ? 'تجاوزت مهلة معالجة الصورة (25 ثانية) - يمكنك مراجعتها يدوياً'
              : fileErr.message || 'فشلت معالجة الصورة';

            failedErrors.push(`صورة #${i + 1}: ${errorMsg}`);

            // Mark this specific file as error, but continue processing the remaining images!
            setSelectedFiles((prev) =>
              prev.map((f, idx) =>
                idx === i
                  ? { ...f, status: 'error', errorMessage: errorMsg }
                  : f
              )
            );
          }
        }

        const successCount = allReturned.length;
        const approvedCount = allReturned.filter((r) => r.status === 'approved').length;
        const readyCount = Math.max(0, successCount - dupCount - reviewCount - approvedCount);
        const summaryMsg = `تمت معالجة ${total} إيصالات: تم التحقق والاعتماد التلقائي لـ (${approvedCount}) إيصال${reviewCount > 0 ? `، ${reviewCount} تحتاج مراجعة` : ''}${dupCount > 0 ? `، ${dupCount} مكررة` : ''}${readyCount > 0 ? `، ${readyCount} جاهزة` : ''}`;

        setPostUploadBanner({
          total,
          success: successCount,
          duplicates: dupCount,
          suspicious: suspCount,
          needsReview: reviewCount,
          message: summaryMsg,
        });

        if (successCount > 0) {
          fetchReceipts();
        }

        setUploadSummary({
          total,
          success: successCount,
          duplicates: dupCount,
          suspicious: suspCount,
          needsReview: reviewCount,
          message:
            successCount === total
              ? `تم بنجاح رفع واستخراج بيانات جميع الإيصالات (${total} إيصالات) دون أي تعليق!`
              : successCount > 0
              ? `تمت معالجة ${successCount} من أصل ${total} بنجاح. تعذر استخراج ${failedErrors.length} (متاحة للمراجعة اليدوية).`
              : `تعذرت المعالجة الآلية للصور: ${failedErrors.join(' | ')}`,
        });

        // Always auto-transition to table after brief delay (1.2s) to show completion status
        setTimeout(() => {
          setUploadModalOpen(false);
          setUploadSummary(null);
          clearAllFiles();
          tableRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 1200);
      } else {
        // Text mode: parse blocks and submit
        if (!batchReceiptsText.trim()) {
          throw new Error('يرجى إدخال أو لصق نصوص الإيصالات');
        }
        const rawTextBlocks = batchReceiptsText.split(/\n\s*---\s*\n|\n\s*===\s*\n/);
        const itemsToUpload = rawTextBlocks.map((block, idx) => ({
          customerId: selectedCustomerId || null,
          customerSessionId: selectedSessionId || null,
          rawOcrText: block.trim(),
          imageData: `simulated-bankak-receipt-${Date.now()}-${idx + 1}.png`,
        }));

        setUploadStageText('جاري التحليل المالي للنصوص...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        try {
          const res = await fetch('/api/v1/receipts/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsToUpload }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'فشلت معالجة نصوص الإيصالات');
          }

          const returned = data.data || [];
          const dupCount = returned.filter((r: any) => r.isDuplicate || r.status === 'duplicate').length;
          const suspCount = returned.filter((r: any) => r.isSuspicious || r.status === 'suspicious').length;
          const reviewCount = returned.filter((r: any) => r.status === 'pending_review' || r.ocrConfidence < 70).length;

          setUploadSummary({
            total: returned.length,
            success: returned.length - dupCount,
            duplicates: dupCount,
            suspicious: suspCount,
            needsReview: reviewCount,
            message: `تمت معالجة وتدقيق ${returned.length} إشعار بنجاح!`,
          });

          const readyCount = Math.max(0, returned.length - dupCount - reviewCount);
          setPostUploadBanner({
            total: returned.length,
            success: returned.length - dupCount,
            duplicates: dupCount,
            suspicious: suspCount,
            needsReview: reviewCount,
            message: `تمت معالجة ${returned.length} إشعار: ${reviewCount} تحتاج مراجعة، ${dupCount} مكررة، و${readyCount} جاهزة للتحقق`,
          });

          setBatchReceiptsText('');
          fetchReceipts();

          setTimeout(() => {
            setUploadModalOpen(false);
            setUploadSummary(null);
            tableRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 1200);
        } catch (textErr: any) {
          clearTimeout(timeoutId);
          throw textErr;
        }
      }
    } catch (err: any) {
      setUploadSummary({
        total: 0,
        success: 0,
        duplicates: 0,
        suspicious: 0,
        needsReview: 0,
        message: `خطأ: ${err.message}`,
      });
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadStageText('جاري المعالجة واستخراج الـ OCR...');
    }
  };

  // Open Review Drawer
  const openReview = (rcp: any) => {
    setReviewReceipt(rcp);
    setEditTxnId(rcp.transactionId);
    setEditAmount(rcp.amount);
    setEditSender(rcp.senderName || '');
    setEditSenderAccount(rcp.senderAccount || '');
    setEditReceiver(rcp.receiverName || '');
    setEditReceiverAccount(rcp.receiverAccount || '');
    setEditDate(rcp.transactionDate || '');
    setEditTime(rcp.transactionTime || '');
    setShowRawOcr(false);
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
          senderAccount: editSenderAccount,
          receiverName: editReceiver,
          receiverAccount: editReceiverAccount,
          transactionDate: editDate,
          transactionTime: editTime,
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

  // Re-run OCR Extraction
  const handleReprocessOcr = async () => {
    if (!reviewReceipt) return;
    setProcessingAction(true);
    setModalFeedback(null);
    try {
      const res = await fetch(`/api/v1/receipts/${reviewReceipt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reprocessOcr: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إعادة معالجة الـ OCR');
      }
      setReviewReceipt(data.data);
      setEditTxnId(data.data.transactionId);
      setEditAmount(data.data.amount);
      setEditSender(data.data.senderName || '');
      setEditReceiver(data.data.receiverName || '');
      setEditDate(data.data.transactionDate || '');
      setModalFeedback({ type: 'success', message: 'تمت إعادة معالجة وتدقيق الإيصال بمحرك الـ OCR بنجاح' });
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
            senderAccount: editSenderAccount,
            receiverName: editReceiver,
            receiverAccount: editReceiverAccount,
            transactionDate: editDate,
            transactionTime: editTime,
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

    if (!editAmount || Number(editAmount) <= 0) {
      setModalFeedback({
        type: 'error',
        message: 'لا يمكن اعتماد إيصال بمبلغ 0 SDG أو غير محدد. يرجى إدخال المبلغ الصحيح أولاً.',
      });
      return;
    }

    setProcessingAction(true);
    setModalFeedback(null);
    try {
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
            senderAccount: editSenderAccount,
            receiverName: editReceiver,
            receiverAccount: editReceiverAccount,
            transactionDate: editDate,
            transactionTime: editTime,
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
        body: JSON.stringify({ directVerification: true }),
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
            <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
            <span>معتمد مالياً</span>
          </span>
        );
      case 'verified':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
            <CheckCircle className="w-3 h-3 text-blue-600 shrink-0" />
            <span>تم التحقق بنكياً</span>
          </span>
        );
      case 'suspicious':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 animate-pulse">
            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
            <span>مشتبه به!</span>
          </span>
        );
      case 'duplicate':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 animate-pulse">
            <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
            <span>إيصال مكرر!</span>
          </span>
        );
      case 'pending_review':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600 shrink-0" />
            <span>يحتاج مراجعة OCR</span>
          </span>
        );
      case 'pending_verification':
      case 'uploaded':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
            <span>بانتظار التحقق</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center space-x-1 space-x-reverse px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
            <XCircle className="w-3 h-3 text-slate-500 shrink-0" />
            <span>مرفوض</span>
          </span>
        );
      default:
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  const isRealImage = (key?: string) => {
    if (!key || key === 'no-image') return false;
    return (
      key.startsWith('http') ||
      key.startsWith('/uploads') ||
      key.startsWith('data:image') ||
      key.startsWith('receipts/') ||
      key.startsWith('local:')
    );
  };

  const getDisplayImageUrl = (rcp: any) => {
    if (!rcp || !rcp.imageStorageKey || rcp.imageStorageKey === 'no-image') return '';
    if (rcp.imageStorageKey.startsWith('http') || rcp.imageStorageKey.startsWith('data:image')) {
      return rcp.imageStorageKey;
    }
    const token = typeof window !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('auth_token')) : '';
    return `/api/v1/receipts/${rcp.id}/image${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 max-w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
              إدارة إيصالات بنكك والـ OCR الفعلي
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              رفع وتصوير الإيصالات الحقيقية، استخراج البيانات بالذكاء الاصطناعي، ومنع التكرار
            </p>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse self-stretch sm:self-auto">
            <button
              onClick={() => {
                setUploadSummary(null);
                setUploadModalOpen(true);
              }}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 space-x-reverse bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition-all min-h-[44px]"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span>رفع / تصوير إيصالات</span>
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

        {/* Post-Upload Notification Banner */}
        {postUploadBanner && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-blue-950 p-4 rounded-2xl flex items-center justify-between shadow-sm animate-in fade-in">
            <div className="flex items-center space-x-3 space-x-reverse min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-black text-xs sm:text-sm text-blue-900">
                  تم اكتمال الرفع والمعالجة — تم تحديث جدول الإيصالات تلقائياً
                </h4>
                <p className="text-[11px] sm:text-xs text-blue-700 mt-0.5 font-medium">
                  {postUploadBanner.message}
                </p>
              </div>
            </div>
            <button
              onClick={() => setPostUploadBanner(null)}
              className="p-1.5 text-blue-400 hover:text-blue-700 rounded-lg min-w-[32px] min-h-[32px] flex items-center justify-center shrink-0"
              title="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

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
              { id: 'pending_review', label: 'مراجعة OCR' },
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

        {/* 1. MOBILE CARDS VIEW: Prioritizing 1. Recipient, 2. Amount, 3. TXN (Visible on screens < 1024px) */}
        <div ref={tableRef} className="lg:hidden space-y-3">
          {receipts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs sm:text-sm">
              {loading ? 'جاري تحميل الإيصالات...' : 'لا توجد إيصالات تطابق البحث'}
            </div>
          ) : (
            receipts.map((rcp) => (
              <div
                key={rcp.id}
                onClick={() => openReview(rcp)}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:bg-slate-50 transition-colors flex flex-col justify-between space-y-3"
              >
                {/* Header row: Receipt ID & Status */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold bg-slate-100 px-2.5 py-1 rounded-lg text-slate-800">
                    {rcp.receiptNumber}
                  </span>
                  <div>{getStatusBadge(rcp.status)}</div>
                </div>

                {/* Priority 1 & 2: Recipient Name & Amount */}
                <div className="p-3 bg-slate-50/80 rounded-xl space-y-2 border border-slate-100">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] text-slate-400 block font-medium">اسم المستفيد (المرسل إليه):</span>
                      {rcp.receiverName ? (
                        <span className="font-bold text-sm text-slate-900 truncate block">{rcp.receiverName}</span>
                      ) : (
                        <span className="inline-flex items-center text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-200">
                          غير مستخرج (يحتاج مراجعة)
                        </span>
                      )}
                    </div>
                    <div className="text-left shrink-0">
                      <span className="text-[10px] text-slate-400 block font-medium">المبلغ:</span>
                      {Number(rcp.amount) > 0 ? (
                        <span className="font-mono font-black text-base text-slate-900">
                          {Number(rcp.amount).toLocaleString()} <span className="text-xs text-slate-400 font-normal">SDG</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 space-x-reverse text-amber-800 bg-amber-100 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-300 animate-pulse">
                          <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                          <span>غير محدد</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Priority 3: Transaction ID with copy button */}
                  <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">رقم العملية (Bankak TXN):</span>
                      <span className="font-mono font-bold text-xs sm:text-sm text-blue-700">{rcp.transactionId || 'غير مستخرج'}</span>
                    </div>
                    {rcp.transactionId && (
                      <button
                        type="button"
                        onClick={(e) => handleCopyTxn(rcp.transactionId, e)}
                        className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold flex items-center space-x-1 space-x-reverse hover:bg-slate-50"
                      >
                        {copiedTxnId === rcp.transactionId ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-600">تم النسخ</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>نسخ</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs px-1">
                  <div>
                    <span className="text-[10px] text-slate-400 block">اسم المرسل:</span>
                    <span className="font-medium text-slate-800 truncate block">{rcp.senderName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">العميل المرتبط:</span>
                    <span className="font-medium text-blue-700 truncate block">{rcp.customer?.name || 'غير محدد'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">التاريخ والوقت:</span>
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
                  <span>معاينة واعتماد الإيصال والصورة</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* 2. DESKTOP VIEW: Data Table by Priority (Visible on screens >= 1024px) */}
        <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">المستفيد (المرسل إليه)</th>
                  <th className="p-3.5">المبلغ (SDG)</th>
                  <th className="p-3.5">رقم العملية (Bankak TXN)</th>
                  <th className="p-3.5">اسم المرسل</th>
                  <th className="p-3.5">العميل المرتبط</th>
                  <th className="p-3.5">التاريخ والوقت</th>
                  <th className="p-3.5">دقة OCR</th>
                  <th className="p-3.5 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {receipts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      {loading ? 'جاري تحميل الإيصالات...' : 'لا توجد إيصالات تطابق البحث'}
                    </td>
                  </tr>
                ) : (
                  receipts.map((rcp) => (
                    <tr key={rcp.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. المستفيد (المرسل إليه) */}
                      <td className="p-3.5">
                        {rcp.receiverName ? (
                          <span className="font-bold text-slate-900 block">{rcp.receiverName}</span>
                        ) : (
                          <span className="inline-flex items-center text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px] font-medium border border-amber-200">
                            غير مستخرج (يحتاج مراجعة)
                          </span>
                        )}
                        {rcp.receiverAccount && (
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            حساب: {rcp.receiverAccount}
                          </span>
                        )}
                      </td>

                      {/* 2. المبلغ (SDG) */}
                      <td className="p-3.5 font-mono text-sm">
                        {Number(rcp.amount) > 0 ? (
                          <span className="font-black text-slate-900">
                            {Number(rcp.amount).toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">SDG</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 space-x-reverse text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded-lg text-xs font-bold border border-amber-300 animate-pulse">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>⚠️ غير محدد (مطلوب إدخاله)</span>
                          </span>
                        )}
                      </td>

                      {/* 3. رقم العملية (Bankak TXN) */}
                      <td className="p-3.5 font-mono">
                        <div className="flex items-center space-x-1.5 space-x-reverse">
                          <span className="font-bold text-blue-700">{rcp.transactionId || '—'}</span>
                          {rcp.transactionId && (
                            <button
                              type="button"
                              onClick={(e) => handleCopyTxn(rcp.transactionId, e)}
                              className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors"
                              title="نسخ رقم العملية"
                            >
                              {copiedTxnId === rcp.transactionId ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block font-mono">{rcp.receiptNumber}</span>
                      </td>

                      {/* 4. اسم المرسل */}
                      <td className="p-3.5">
                        <span className="font-medium text-slate-800 block">{rcp.senderName || '—'}</span>
                        {rcp.senderAccount && (
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            حساب: {rcp.senderAccount}
                          </span>
                        )}
                      </td>

                      {/* 5. العميل المرتبط */}
                      <td className="p-3.5 font-medium">{rcp.customer?.name || <span className="text-slate-400">غير محدد</span>}</td>

                      {/* 6. التاريخ والوقت */}
                      <td className="p-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {rcp.transactionDate} {rcp.transactionTime}
                      </td>

                      {/* 7. دقة OCR */}
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          rcp.ocrConfidence >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {rcp.ocrConfidence}%
                        </span>
                      </td>

                      {/* 8. الإجراءات */}
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

        {/* COMPREHENSIVE UPLOAD MODAL (REAL IMAGE / CAMERA / DRAG & DROP / TEXT) */}
        {mounted && uploadModalOpen && createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm p-0 sm:p-4 touch-none"
            onClick={() => !uploading && setUploadModalOpen(false)}
          >
            <div
              className="bg-white w-full sm:max-w-3xl max-h-[85dvh] sm:max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl text-right overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white z-10">
                <div className="flex items-center space-x-2.5 space-x-reverse min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                      رفع وتصوير إيصالات بنكك بالـ OCR الفعلي
                    </h3>
                    <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                      رفع صور حقيقية، التصوير المباشر بالكاميرا، أو لصق النصوص واستخراج الحسابات
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  disabled={uploading}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto overscroll-contain touch-scroll p-4 sm:p-5 space-y-4">
                {/* Mode Selection Tabs */}
                <div className="flex items-center bg-slate-100 p-1 rounded-2xl mb-4">
                <button
                  type="button"
                  onClick={() => setUploadTab('images')}
                  className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center space-x-1.5 space-x-reverse transition-all ${
                    uploadTab === 'images'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 shrink-0" />
                  <span>رفع وتصوير الصور (كـاميرا / ملفات)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUploadTab('text')}
                  className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center space-x-1.5 space-x-reverse transition-all ${
                    uploadTab === 'text'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>لصق نصوص الإشعارات يدوياً</span>
                </button>
              </div>

              {/* Live Real-time Upload & OCR Progress Bar */}
              {uploadProgress && (
                <div className="mb-4 p-3.5 bg-blue-50/95 border border-blue-200/80 rounded-2xl text-blue-950 shadow-sm animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-xs font-bold mb-2">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin shrink-0" />
                      <span className="text-blue-900">{uploadStageText}</span>
                    </div>
                    <span className="font-mono text-blue-700 font-black">
                      {uploadProgress.current} / {uploadProgress.total} ({Math.round((uploadProgress.current / uploadProgress.total) * 100)}%)
                    </span>
                  </div>
                  <div className="w-full bg-blue-200/60 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Upload Summary Report Banner */}
              {uploadSummary && (
                <div className={`mb-4 p-4 rounded-2xl border text-xs sm:text-sm ${
                  uploadSummary.total > 0
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                  <div className="font-bold flex items-center space-x-2 space-x-reverse mb-1">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{uploadSummary.message}</span>
                  </div>
                  {uploadSummary.total > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200/60 mt-2 text-center text-xs">
                      <div className="bg-white/80 p-1.5 rounded-xl">
                        <span className="text-[10px] text-slate-500 block">إجمالي المرفوع</span>
                        <span className="font-bold font-mono text-slate-900">{uploadSummary.total}</span>
                      </div>
                      <div className="bg-white/80 p-1.5 rounded-xl">
                        <span className="text-[10px] text-slate-500 block">المقبولة بنجاح</span>
                        <span className="font-bold font-mono text-emerald-700">{uploadSummary.success}</span>
                      </div>
                      <div className="bg-white/80 p-1.5 rounded-xl">
                        <span className="text-[10px] text-slate-500 block">إيصالات مكررة</span>
                        <span className="font-bold font-mono text-rose-700">{uploadSummary.duplicates}</span>
                      </div>
                      <div className="bg-white/80 p-1.5 rounded-xl">
                        <span className="text-[10px] text-slate-500 block">تحتاج مراجعة</span>
                        <span className="font-bold font-mono text-amber-700">{uploadSummary.needsReview}</span>
                      </div>
                    </div>
                  )}
                  {uploadSummary.total > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadModalOpen(false);
                        setUploadSummary(null);
                        clearAllFiles();
                        tableRef.current?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="mt-3 w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 space-x-reverse min-h-[40px] shadow-sm transition-all"
                    >
                      <Eye className="w-4 h-4 text-blue-400" />
                      <span>الانتقال فوراً إلى جدول الإيصالات لمراجعتها واعتمادها</span>
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {/* Optional Customer / Session Linkage */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">ربط بعميل (اختياري)</label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
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
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
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

                {/* TAB 1: REAL IMAGES & CAMERA UPLOAD */}
                {uploadTab === 'images' && (
                  <div className="space-y-3">
                    {/* Hidden inputs */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      multiple
                      onChange={(e) => e.target.files && handleFilesAdded(e.target.files)}
                      className="hidden"
                    />
                    <input
                      type="file"
                      ref={cameraInputRef}
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => e.target.files && handleFilesAdded(e.target.files)}
                      className="hidden"
                    />

                    {/* Action Buttons: Choose from Gallery & Camera */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 space-x-reverse shadow-sm transition-all min-h-[48px]"
                      >
                        <ImageIcon className="w-5 h-5 text-blue-400 shrink-0" />
                        <span>اختيار صور الإيصالات من الجهاز</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 space-x-reverse shadow-md shadow-blue-500/20 transition-all min-h-[48px]"
                      >
                        <Camera className="w-5 h-5 shrink-0" />
                        <span>تصوير الإيصال بكاميرا الجوال</span>
                      </button>
                    </div>

                    {/* Drag and Drop Box */}
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                        isDragging
                          ? 'border-blue-500 bg-blue-50/60'
                          : 'border-slate-300 hover:border-blue-400 bg-slate-50/50'
                      }`}
                    >
                      <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <p className="text-xs sm:text-sm font-bold text-slate-800">
                        اسحب وأفلت صور إشعارات بنكك هنا، أو انقر للاختيار
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        الصيغ المدعومة: PNG, JPG, JPEG, WebP • الحد الأقصى 15MB للصورة • يدعم رفع عدة صور
                      </p>
                    </div>

                    {/* Previews List */}
                    {selectedFiles.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                          <span>الصور المختارة ({selectedFiles.length} صور جاهزة للـ OCR):</span>
                          <button
                            type="button"
                            onClick={clearAllFiles}
                            className="text-rose-600 hover:underline text-[11px]"
                          >
                            مسح جميع الصور
                          </button>
                        </div>

                        <div className="max-h-60 overflow-y-auto space-y-2 p-1 touch-scroll">
                          {selectedFiles.map((item, idx) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                            >
                              <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                                <img
                                  src={item.previewUrl}
                                  alt={item.name}
                                  className="w-12 h-12 rounded-lg object-cover border border-slate-300 shrink-0 bg-white"
                                />
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-800 truncate">{item.name}</p>
                                  <div className="flex items-center space-x-2 space-x-reverse mt-0.5">
                                    <p className="text-[10px] text-slate-400 font-mono">
                                      صورة #{idx + 1} • {item.sizeFormatted}
                                    </p>
                                    {item.status === 'uploading' && (
                                      <span className="inline-flex items-center space-x-1 space-x-reverse text-[10px] text-blue-700 bg-blue-100/80 px-1.5 py-0.5 rounded font-bold animate-pulse">
                                        <RefreshCw className="w-2.5 h-2.5 animate-spin shrink-0" />
                                        <span>جاري التحليل...</span>
                                      </span>
                                    )}
                                    {item.status === 'success' && (
                                      <span className="inline-flex items-center space-x-1 space-x-reverse text-[10px] text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded font-bold">
                                        <CheckCircle className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                        <span>تم الاستخراج</span>
                                      </span>
                                    )}
                                    {item.status === 'error' && (
                                      <span className="inline-flex items-center space-x-1 space-x-reverse text-[10px] text-rose-700 bg-rose-100/80 px-1.5 py-0.5 rounded font-bold" title={item.errorMessage}>
                                        <AlertTriangle className="w-2.5 h-2.5 text-rose-600 shrink-0" />
                                        <span>فشلت القراءة</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {!uploading && (
                                <button
                                  type="button"
                                  onClick={() => removeFile(item.id)}
                                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0"
                                  title="إزالة الصورة"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: TEXT PASTE FALLBACK */}
                {uploadTab === 'text' && (
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-1 gap-1">
                      <label className="block text-xs font-bold text-slate-700">
                        نصوص إيصالات بنكك (أو لصق إشعارات متعددة مفصولة بـ ---)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setBatchReceiptsText(
                            `Bank of Khartoum\nTransaction ID: 123456789\nAmount: 5,000,000 SDG\nSender: عمر أحمد\nReceiver: مكتب الصرافة\nDate: 21/11/2026\nTime: 10:15:00\n---\nBank of Khartoum\nTransaction ID: 987654321\nAmount: 3,000,000 SDG\nSender: عمر أحمد\nReceiver: مكتب الصرافة\nDate: 21/11/2026\nTime: 10:25:00`
                          );
                        }}
                        className="text-[11px] text-blue-600 font-bold hover:underline self-start sm:self-auto"
                      >
                        تحميل نموذج تجريبي
                      </button>
                    </div>
                    <textarea
                      rows={6}
                      value={batchReceiptsText}
                      onChange={(e) => setBatchReceiptsText(e.target.value)}
                      placeholder="الصق نصوص أو بيانات إيصالات بنكك هنا..."
                      className="w-full p-3 font-mono text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Pinned Actions Footer (Fixed shrink-0) */}
            <div className="shrink-0 bg-slate-50 border-t border-slate-100 p-4 sm:p-5 flex items-center justify-end gap-2.5 safe-area-pb">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                disabled={uploading}
                className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs sm:text-sm font-bold min-h-[44px] hover:bg-slate-100 transition-colors"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleUploadSubmit}
                disabled={uploading || (uploadTab === 'images' && selectedFiles.length === 0)}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 active:bg-blue-800 shadow-md shadow-blue-500/20 disabled:opacity-50 min-h-[44px] flex items-center justify-center space-x-1.5 space-x-reverse transition-all"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    <span>{uploadStageText}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>
                      {uploadTab === 'images'
                        ? `بدء الرفع واستخراج بيانات (${selectedFiles.length}) صور`
                        : 'معالجة نصوص الدفعة'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

        {/* SIDE-BY-SIDE REVIEW & APPROVAL MODAL / BOTTOM SHEET */}
        {mounted && reviewReceipt && createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-sm p-0 sm:p-4 touch-none"
            onClick={() => !processingAction && setReviewReceipt(null)}
          >
            <div
              className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-5xl max-h-[85dvh] sm:max-h-[92vh] flex flex-col text-right overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Review Header (Fixed shrink-0) */}
              <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white z-10">
                <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                  <FileCheck2 className="w-5 h-5 text-blue-600 shrink-0" />
                  <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                    مراجعة وتدقيق إيصال بنكك • {reviewReceipt.receiptNumber}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewReceipt(null)}
                  disabled={processingAction}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center -ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Body (flex-1 overscroll-contain) */}
              <div className="flex-1 overflow-y-auto overscroll-contain touch-scroll p-4 sm:p-5 space-y-4">

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

              {/* OCR Low Confidence or Missing Fields Warning */}
              {(reviewReceipt.status === 'pending_review' || reviewReceipt.ocrConfidence < 70) && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl flex items-center space-x-2.5 space-x-reverse text-xs">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <div>
                    <span className="font-black block">دقة قراءة منخفضة (OCR {reviewReceipt.ocrConfidence}%) أو بيانات ناقصة:</span>
                    <span className="text-[11px] text-amber-800">
                      يرجى تدقيق الصورة الأصلية ومراجعة الحقول وتصحيحها قبل اعتماد الإيصال مالياً.
                    </span>
                  </div>
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

              {/* Rejected Alert if rejected */}
              {reviewReceipt.status === 'rejected' && (
                <div className="mb-4 p-3.5 bg-slate-100 border border-slate-300 rounded-2xl flex items-center space-x-3 space-x-reverse text-slate-800">
                  <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  <div>
                    <h4 className="font-black text-xs sm:text-sm text-rose-700">هذا الإيصال مرفوض رسمياً</h4>
                    <p className="text-[11px] sm:text-xs text-slate-600 mt-0.5">
                      <span className="font-bold">سبب الرفض: </span>
                      {reviewReceipt.suspicionReason || 'تم رفض الإيصال من قبل المراجع المختص'}
                    </p>
                  </div>
                </div>
              )}

              {/* Stack on mobile, 2-cols on desktop */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {/* 1. VISUAL IMAGE PREVIEW & OCR METRICS */}
                <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-slate-800 shadow-inner space-y-3">
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <Building className="w-5 h-5 text-emerald-400 shrink-0" />
                        <span className="font-bold text-xs sm:text-sm text-white">إشعار بنك الخرطوم (بنكك)</span>
                      </div>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-bold">
                        ثقة OCR: {reviewReceipt.ocrConfidence}%
                      </span>
                    </div>

                    {/* Actual Uploaded Image Viewer */}
                    {isRealImage(reviewReceipt.imageStorageKey) ? (
                      <div className="space-y-2">
                        <div className="relative group bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center max-h-72">
                          <img
                            src={getDisplayImageUrl(reviewReceipt)}
                            alt="صورة إيصال بنكك الأصلية"
                            className="max-h-72 w-auto object-contain cursor-zoom-in transition-transform duration-200 group-hover:scale-105"
                            onClick={() => window.open(getDisplayImageUrl(reviewReceipt), '_blank')}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                          <span>انقر على الصورة للتكبير</span>
                          <a
                            href={getDisplayImageUrl(reviewReceipt)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline flex items-center space-x-1 space-x-reverse"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>فتح الصورة بحجم كامل</span>
                          </a>
                        </div>
                      </div>
                    ) : (
                      /* Simulated receipt badge if text-only */
                      <div className="text-center py-4 my-2 bg-slate-800/60 rounded-xl border border-slate-800">
                        <div className="text-[11px] text-slate-400 mb-0.5">المبلغ المحول</div>
                        <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
                          {Number(editAmount || 0).toLocaleString()} <span className="text-xs text-slate-400 font-normal">SDG</span>
                        </div>
                      </div>
                    )}

                    {/* Quick Meta */}
                    <div className="space-y-1.5 text-xs text-slate-300 mt-3 pt-2 border-t border-slate-800">
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-400 text-[11px]">رقم العملية:</span>
                        <span className="font-mono font-bold text-white truncate max-w-[200px]">{editTxnId}</span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-400 text-[11px]">المرسل:</span>
                        <span className="font-medium text-white truncate max-w-[200px]">{editSender || 'غير محدد'}</span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-400 text-[11px]">المستفيد:</span>
                        <span className="font-medium text-white truncate max-w-[200px]">{editReceiver || 'غير مستخرج (يحتاج مراجعة)'}</span>
                      </div>
                    </div>

                    {/* Raw OCR Text Collapsible Accordion */}
                    <div className="mt-3 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => setShowRawOcr(!showRawOcr)}
                        className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-white py-1"
                      >
                        <span className="flex items-center space-x-1 space-x-reverse">
                          <FileText className="w-3.5 h-3.5 text-blue-400" />
                          <span>عرض النص الخام المستخرج من الـ OCR</span>
                        </span>
                        {showRawOcr ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {showRawOcr && (
                        <pre className="mt-2 p-2.5 bg-slate-950 rounded-xl text-[10px] font-mono text-slate-300 whitespace-pre-wrap max-h-36 overflow-y-auto border border-slate-800">
                          {reviewReceipt.ocrText || 'لا يوجد نص خام مستخرج'}
                        </pre>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between items-center">
                    <span className="font-mono truncate max-w-[200px]">Hash: {reviewReceipt.imageHash}</span>
                    <button
                      type="button"
                      onClick={handleReprocessOcr}
                      disabled={processingAction || reviewReceipt.status === 'approved'}
                      className="text-blue-400 hover:underline flex items-center space-x-1 space-x-reverse disabled:opacity-50"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>إعادة معالجة الـ OCR</span>
                    </button>
                  </div>
                </div>

                {/* 2. EDITABLE RECEIPT FIELDS */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs sm:text-sm text-slate-900">
                      بيانات الإيصال المستخرجة (قابلة للمراجعة والتصحيح)
                    </h4>
                    {reviewReceipt.reviewedBy && (
                      <span className="text-[10px] text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded">
                        آخر تدقيق: {reviewReceipt.reviewedBy}
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
                    <label className="block text-xs font-bold text-slate-700 mb-1">المبلغ المحول (SDG)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className={`w-full px-3.5 py-2.5 font-mono text-sm font-black rounded-xl border focus:ring-2 focus:ring-blue-500 min-h-[44px] disabled:bg-slate-100 ${
                        !editAmount || Number(editAmount) <= 0
                          ? 'border-amber-400 bg-amber-50/50 text-amber-900'
                          : 'border-slate-300'
                      }`}
                    />
                    {(!editAmount || Number(editAmount) <= 0) && (
                      <p className="text-[11px] text-amber-700 font-bold mt-1.5 flex items-center space-x-1 space-x-reverse">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>المبلغ غير محدد أو صفري — يجب إدخال المبلغ الفعلي من الصورة قبل الاعتماد</span>
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">اسم المرسل</label>
                      <input
                        type="text"
                        disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                        value={editSender}
                        onChange={(e) => setEditSender(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[42px] disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">رقم حساب المرسل</label>
                      <input
                        type="text"
                        disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                        value={editSenderAccount}
                        onChange={(e) => setEditSenderAccount(e.target.value)}
                        placeholder="اختياري"
                        className="w-full px-3.5 py-2 font-mono text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[42px] disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستفيد</label>
                      <input
                        type="text"
                        disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                        value={editReceiver}
                        onChange={(e) => setEditReceiver(e.target.value)}
                        className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[42px] disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">رقم حساب المستفيد</label>
                      <input
                        type="text"
                        disabled={reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                        value={editReceiverAccount}
                        onChange={(e) => setEditReceiverAccount(e.target.value)}
                        placeholder="اختياري"
                        className="w-full px-3.5 py-2 font-mono text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[42px] disabled:bg-slate-100"
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
                        className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 min-h-[42px] disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">العميل المرتبط</label>
                      <div className="p-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-800 truncate min-h-[42px] flex items-center">
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
                      className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 space-x-reverse min-h-[40px] transition-colors"
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
                </div>
              </div>
            </div>

            {/* Pinned Bottom Footer (Fixed shrink-0) */}
            <div className="shrink-0 bg-slate-50 border-t border-slate-100 p-4 sm:p-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 safe-area-pb">
              <button
                type="button"
                onClick={handleReject}
                disabled={processingAction || reviewReceipt.status === 'approved' || reviewReceipt.status === 'rejected'}
                className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 rounded-xl text-xs font-bold transition-all disabled:opacity-40 min-h-[44px]"
              >
                رفض الإيصال
              </button>
              <div className="flex items-center space-x-2 space-x-reverse flex-wrap gap-2 justify-end">
                {!reviewReceipt.verifiedBy && reviewReceipt.status !== 'approved' && reviewReceipt.status !== 'duplicate' && reviewReceipt.status !== 'rejected' && (
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
                  type="button"
                  onClick={() => setReviewReceipt(null)}
                  className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={
                    processingAction ||
                    !editAmount ||
                    Number(editAmount) <= 0 ||
                    reviewReceipt.status === 'approved' ||
                    reviewReceipt.status === 'duplicate' ||
                    reviewReceipt.status === 'rejected'
                  }
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center space-x-1.5 space-x-reverse disabled:opacity-40 min-h-[44px]"
                  title={!editAmount || Number(editAmount) <= 0 ? 'يجب إدخال مبلغ أكبر من صفر للاعتماد' : undefined}
                >
                  <Check className="w-4 h-4 shrink-0" />
                  <span>الاعتماد المالي وقيد اليومية</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      </div>
    </DashboardLayout>
  );
}
