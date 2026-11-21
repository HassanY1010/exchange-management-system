'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, ShieldCheck, Clock, Plus, Upload, CheckCircle2 } from 'lucide-react';

export function Header() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    // Clock
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);

    // Fetch user & notifications
    fetch('/api/v1/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setUser(data.user);
        } else {
          // If not authenticated, redirect to login
          router.push('/login');
        }
      })
      .catch(() => router.push('/login'));

    fetch('/api/v1/notifications')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setNotifications(data.data || []);
      })
      .catch(() => {});

    return () => clearInterval(interval);
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/v1/auth/me', { method: 'POST' });
    router.push('/login');
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-10 shadow-sm">
      {/* Right side: Quick Action Buttons & Clock */}
      <div className="flex items-center space-x-3 space-x-reverse">
        <Link
          href="/receipts"
          className="flex items-center space-x-1.5 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>رفع إيصالات بنكك</span>
        </Link>
        <Link
          href="/customer-sessions"
          className="flex items-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>فتح حساب يومي</span>
        </Link>
        <Link
          href="/daily-closing"
          className="flex items-center space-x-1.5 space-x-reverse bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>الإغلاق اليومي</span>
        </Link>

        <div className="hidden lg:flex items-center space-x-2 space-x-reverse bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span dir="ltr">{time}</span>
        </div>
      </div>

      {/* Left side: Notifications & User profile */}
      <div className="flex items-center space-x-4 space-x-reverse">
        {/* Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg relative transition-colors"
            title="الإشعارات والتنبيهات"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute left-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 z-50 text-right">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <span className="font-bold text-sm text-slate-900">تنبيهات النظام</span>
                <span className="text-xs text-blue-600 cursor-pointer">تحديد كمقروء</span>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {notifications.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">لا توجد إشعارات جديدة</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-2.5 rounded-lg text-xs border ${
                        n.type === 'duplicate_receipt'
                          ? 'bg-rose-50 border-rose-200 text-rose-900'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <p className="font-bold mb-0.5">{n.title}</p>
                      <p className="text-slate-600">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Card */}
        {user && (
          <div className="flex items-center space-x-3 space-x-reverse border-r border-slate-200 pr-4">
            <div className="text-right">
              <div className="text-xs font-bold text-slate-900">{user.name}</div>
              <div className="flex items-center space-x-1 space-x-reverse text-[11px] text-blue-600 font-medium">
                <ShieldCheck className="w-3 h-3" />
                <span>
                  {user.role === 'admin'
                    ? 'مدير النظام'
                    : user.role === 'accountant'
                    ? 'محاسب مالي'
                    : user.role === 'custody_officer'
                    ? 'مسؤول تسليم نقدية'
                    : 'مدخل بيانات'}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
