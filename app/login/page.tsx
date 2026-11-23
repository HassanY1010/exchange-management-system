'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight, Lock, Mail, ShieldAlert, CheckCircle2, Loader2 } from 'lucide-react';
import { getSafeRedirectUrl } from '@/lib/redirect';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // In production, start with empty credentials for security
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Only show quick demo buttons in development / testing environments
  const showDemoLogins = process.env.NODE_ENV !== 'production';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // Prevent double submit

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل الدخول. يرجى التحقق من البيانات المدخلة.');
      }

      // Safe redirect prevention of Open Redirect attacks
      const requestedRedirect = searchParams.get('returnUrl') || searchParams.get('redirect');
      let targetUrl = '/dashboard';

      if (requestedRedirect) {
        targetUrl = getSafeRedirectUrl(requestedRedirect, '/dashboard');
      } else {
        // Direct to role-appropriate initial workspace
        const role = data.user?.role;
        if (role === 'custody_officer' || role === 'cashier') {
          targetUrl = '/custody';
        } else if (role === 'accountant') {
          targetUrl = '/customer-sessions';
        } else {
          targetUrl = '/dashboard';
        }
      }

      router.push(targetUrl);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (roleEmail: string, pass: string) => {
    setEmail(roleEmail);
    setPassword(pass);
    setError('');
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 sm:p-8 border border-slate-100" dir="rtl">
      <div className="text-center mb-6 sm:mb-8">
        <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-slate-200/80 p-2 border border-slate-100 overflow-hidden">
          <img
            src="/brand/logo.png"
            alt="أبو جواد للتجارة"
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1">أبو جواد للتجارة</h1>
        <p className="text-xs sm:text-sm font-bold text-amber-600 tracking-wider font-mono uppercase mb-1">ABU JAWAD FOR TRADEING</p>
        <p className="text-xs sm:text-sm text-slate-500">نظام إدارة الصرافة والمحاسبة المالية المركزية</p>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 space-x-reverse text-rose-700 text-xs sm:text-sm animate-fadeIn">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600" />
          <span className="font-semibold leading-relaxed">{error}</span>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">البريد الإلكتروني</label>
          <div className="relative">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              disabled={loading}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm sm:text-base pl-10 min-h-[44px] disabled:bg-slate-50 disabled:text-slate-500 text-slate-900"
              placeholder="name@exchange.com"
            />
            <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">كلمة المرور</label>
          <div className="relative">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={loading}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm sm:text-base pl-10 min-h-[44px] disabled:bg-slate-50 disabled:text-slate-500 text-slate-900"
              placeholder="••••••••"
            />
            <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !email.trim() || !password}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-bold text-sm sm:text-base shadow-md shadow-blue-500/20 transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50 min-h-[48px]"
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>جاري التحقق من بيانات الدخول...</span>
            </div>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>دخول النظام</span>
            </>
          )}
        </button>
      </form>

      {/* Quick Demo Access Roles (Visible only in non-production environments for developer testing) */}
      {showDemoLogins && (
        <div className="mt-6 pt-5 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-500 mb-2.5 text-center">أدوار تجريبية سريعة (بيئة التطوير فقط):</p>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => quickFill('admin@exchange.com', 'admin123')}
              className="px-2 py-2 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors min-h-[40px] flex items-center justify-center text-center disabled:opacity-50"
            >
              مدير النظام
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => quickFill('accountant@exchange.com', 'admin123')}
              className="px-2 py-2 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors min-h-[40px] flex items-center justify-center text-center disabled:opacity-50"
            >
              المحاسب
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => quickFill('mohammed@exchange.com', 'admin123')}
              className="px-2 py-2 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors min-h-[40px] flex items-center justify-center text-center disabled:opacity-50"
            >
              مسؤول التسليم
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-3 sm:p-6 safe-area-pb safe-area-pt">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 border border-slate-100 flex items-center justify-center min-h-[300px]">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
