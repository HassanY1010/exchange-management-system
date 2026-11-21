'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Lock, Mail, ShieldAlert, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@exchange.com');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل تسجيل الدخول');
      }

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (roleEmail: string, pass: string) => {
    setEmail(roleEmail);
    setPassword(pass);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-3 sm:p-6 safe-area-pb safe-area-pt">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 sm:p-8 border border-slate-100">
        <div className="text-center mb-6 sm:mb-8">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-blue-500/30">
            <ArrowLeftRight className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mb-1">منصة الصرافة والتحويلات المالية</h1>
          <p className="text-xs sm:text-sm text-slate-500">نظام إدارة العملات، إيصالات بنكك والمحاسبة المركزية</p>
        </div>

        {error && (
          <div className="mb-5 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 space-x-reverse text-rose-700 text-xs sm:text-sm">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">البريد الإلكتروني</label>
            <div className="relative">
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm sm:text-base pl-10 min-h-[44px]"
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm sm:text-base pl-10 min-h-[44px]"
                placeholder="••••••••"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-bold text-sm sm:text-base shadow-md shadow-blue-500/20 transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50 min-h-[48px]"
          >
            {loading ? (
              <span>جاري التحقق...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>دخول النظام</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Demo Access Roles */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-500 mb-2.5 text-center">أدوار تجريبية سريعة:</p>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => quickFill('admin@exchange.com', 'admin123')}
              className="px-2 py-2 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors min-h-[40px] flex items-center justify-center text-center"
            >
              مدير النظام
            </button>
            <button
              type="button"
              onClick={() => quickFill('accountant@exchange.com', 'accountant123')}
              className="px-2 py-2 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors min-h-[40px] flex items-center justify-center text-center"
            >
              المحاسب
            </button>
            <button
              type="button"
              onClick={() => quickFill('mohammed@exchange.com', 'custody123')}
              className="px-2 py-2 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors min-h-[40px] flex items-center justify-center text-center"
            >
              مسؤول التسليم
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
