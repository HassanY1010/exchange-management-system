'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, ShieldCheck, Clock, Plus, Upload, CheckCircle2, Menu } from 'lucide-react';

interface HeaderProps {
  onOpenMobileMenu?: () => void;
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
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
    <header className="h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm shrink-0">
      {/* Right side: Mobile Hamburger + Quick Action Buttons */}
      <div className="flex items-center space-x-2 sm:space-x-3 space-x-reverse min-w-0">
        {/* Mobile Hamburger Toggle */}
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
            aria-label="فتح القائمة الجانبية"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <Link
          href="/receipts"
          className="flex items-center space-x-1.5 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold shadow-sm transition-all min-h-[38px] shrink-0"
          title="رفع إيصالات بنكك"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">رفع إيصالات</span>
        </Link>

        <Link
          href="/customer-sessions"
          className="flex items-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold shadow-sm transition-all min-h-[38px] shrink-0"
          title="فتح حساب يومي"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden md:inline">فتح حساب يومي</span>
        </Link>

        <Link
          href="/daily-closing"
          className="hidden sm:flex items-center space-x-1.5 space-x-reverse bg-amber-600 hover:bg-amber-700 text-white px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold shadow-sm transition-all min-h-[38px] shrink-0"
          title="الإغلاق اليومي"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>الإغلاق</span>
        </Link>

        <div className="hidden xl:flex items-center space-x-2 space-x-reverse bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span dir="ltr">{time}</span>
        </div>
      </div>

      {/* Left side: Notifications & User profile */}
      <div className="flex items-center space-x-2 sm:space-x-4 space-x-reverse shrink-0">
        {/* Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg relative transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="الإشعارات والتنبيهات"
            aria-label="الإشعارات والتنبيهات"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="fixed sm:absolute inset-x-2 sm:inset-x-auto sm:left-0 top-16 sm:top-auto sm:mt-2 w-auto sm:w-80 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 z-50 text-right">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <span className="font-bold text-sm text-slate-900">تنبيهات النظام</span>
                <span
                  onClick={() => setShowNotifications(false)}
                  className="text-xs text-blue-600 cursor-pointer p-1"
                >
                  إغلاق
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2 touch-scroll">
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
          <div className="flex items-center space-x-2 sm:space-x-3 space-x-reverse border-r border-slate-200 pr-2 sm:pr-4">
            <div className="text-right">
              <div className="text-xs font-bold text-slate-900 truncate max-w-[90px] sm:max-w-[130px]">{user.name}</div>
              <div className="hidden sm:flex items-center space-x-1 space-x-reverse text-[11px] text-blue-600 font-medium">
                <ShieldCheck className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {user.role === 'admin'
                    ? 'مدير النظام'
                    : user.role === 'accountant'
                    ? 'محاسب مالي'
                    : user.role === 'custody_officer'
                    ? 'مسؤول تسليم'
                    : 'مدخل بيانات'}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
