'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  FileCheck2,
  Wallet,
  UserCheck,
  Building2,
  TrendingUp,
  Landmark,
  Receipt,
  Scale,
  BarChart3,
  Lock,
  History,
  Settings,
  ArrowLeftRight,
  X,
} from 'lucide-react';

export const menuItems = [
  { href: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { href: '/customers', label: 'العملاء', icon: Users },
  { href: '/customer-sessions', label: 'الحسابات اليومية', icon: CalendarDays },
  { href: '/receipts', label: 'إيصالات بنكك والـ OCR', icon: FileCheck2 },
  { href: '/reconciliation', label: 'مطابقة كشف الحساب البنكي', icon: Scale },
  { href: '/custody', label: 'الموظفون والعهد', icon: UserCheck },
  { href: '/suppliers', label: 'الموردون ومخزون العملات', icon: Building2 },
  { href: '/accounts', label: 'الصناديق والحسابات المالية', icon: Wallet },
  { href: '/exchange-rates', label: 'أسعار الصرف', icon: TrendingUp },
  { href: '/capital', label: 'رأس المال', icon: Landmark },
  { href: '/expenses', label: 'المصروفات', icon: Receipt },
  { href: '/debts', label: 'الديون والالتزامات', icon: Scale },
  { href: '/daily-closing', label: 'الإغلاق اليومي والمطابقة', icon: Lock },
  { href: '/reports', label: 'التقارير المالية والتحليل', icon: BarChart3 },
  { href: '/audit-logs', label: 'سجل التدقيق الرقابي', icon: History },
  { href: '/settings', label: 'إعدادات النظام', icon: Settings },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const handleLinkClick = () => {
    if (onClose) onClose();
  };

  const navContent = (
    <div className="flex flex-col h-full w-full min-h-0 bg-slate-900 text-white select-none overflow-hidden">
      {/* Brand Header */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3 space-x-reverse min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20 shrink-0">
            <ArrowLeftRight className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-base leading-tight text-white truncate">منصة الصرافة</h1>
            <p className="text-xs text-slate-400 truncate">إدارة العملات وإيصالات بنكك</p>
          </div>
        </div>

        {/* Close Button for Mobile Drawer */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation List */}
      <nav className="flex-1 min-h-0 p-3 space-y-1 overflow-y-auto overscroll-contain touch-scroll custom-scrollbar">
        {menuItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleLinkClick}
              className={`flex items-center space-x-3 space-x-reverse px-3.5 py-3 sm:py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px] ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer Info with safe area */}
      <div className="p-4 border-t border-slate-800 text-xs text-slate-400 flex flex-col space-y-1 safe-area-pb shrink-0">
        <div className="flex items-center justify-between text-slate-400">
          <span>نظام الإنتاج المالي</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        </div>
        <p className="text-[11px] text-slate-400">الإصدار 1.0.0 • محرك محاسبي مزدوج</p>
      </div>
    </div>
  );

  return (
    <>
      {/* 1. Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex w-64 h-full max-h-screen flex-col shadow-xl z-20 shrink-0 overflow-hidden">
        {navContent}
      </aside>

      {/* 2. Mobile Drawer & Backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`lg:hidden fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] h-full max-h-screen shadow-2xl transition-transform duration-300 ease-in-out overflow-hidden flex flex-col ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {navContent}
      </aside>
    </>
  );
}
