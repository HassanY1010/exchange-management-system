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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 border border-slate-100">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/30">
            <ArrowLeftRight className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-1">منصة الصرافة والتحويلات المالية</h1>
          <p className="text-sm text-slate-500">نظام إدارة العملات، إيصالات بنكك والمحاسبة المركزية</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 space-x-reverse text-rose-700 text-sm">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm pl-10"
                placeholder="name@exchange.com"
              />
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور</label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm pl-10"
                placeholder="••••••••"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50"
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
        <div className="mt-8 pt-6 border-t border-slate-100">
          <p className="text-xs font-bold text-slate-500 mb-3 text-center">أدوار تجريبية سريعة:</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => quickFill('admin@exchange.com', 'admin123')}
              className="px-2 py-1.5 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors"
            >
              مدير النظام
            </button>
            <button
              onClick={() => quickFill('accountant@exchange.com', 'accountant123')}
              className="px-2 py-1.5 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors"
            >
              المحاسب
            </button>
            <button
              onClick={() => quickFill('mohammed@exchange.com', 'custody123')}
              className="px-2 py-1.5 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 text-[11px] font-semibold text-slate-700 transition-colors"
            >
              موظف التسليم
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
