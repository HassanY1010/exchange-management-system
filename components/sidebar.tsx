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
} from 'lucide-react';

const menuItems = [
  { href: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { href: '/customers', label: 'العملاء', icon: Users },
  { href: '/customer-sessions', label: 'الحسابات اليومية', icon: CalendarDays },
  { href: '/receipts', label: 'إيصالات بنكك والـ OCR', icon: FileCheck2 },
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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-white min-h-screen flex flex-col shadow-xl z-20 flex-shrink-0">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center space-x-3 space-x-reverse">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
          <ArrowLeftRight className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-base leading-tight text-white">منصة الصرافة والمالية</h1>
          <p className="text-xs text-slate-400">إدارة العملات وإيصالات بنكك</p>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-3 space-x-reverse px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 text-xs text-slate-400 flex flex-col space-y-1">
        <div className="flex items-center justify-between text-slate-400">
          <span>نظام الإنتاج المالي</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        </div>
        <p className="text-[11px] text-slate-400">الإصدار 1.0.0 • محرك محاسبي مزدوج</p>
      </div>
    </aside>
  );
}
