'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  FileCheck2,
  UserCheck,
  Menu,
} from 'lucide-react';

interface MobileNavProps {
  onOpenMenu: () => void;
}

export function MobileNav({ onOpenMenu }: MobileNavProps) {
  const pathname = usePathname();

  const primaryItems = [
    { href: '/dashboard', label: 'الرئيسية', icon: LayoutDashboard },
    { href: '/customers', label: 'العملاء', icon: Users },
    { href: '/receipts', label: 'إيصالات', icon: FileCheck2 },
    { href: '/custody', label: 'العهد', icon: UserCheck },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] safe-area-pb select-none">
      <div className="grid grid-cols-5 h-16 max-w-lg mx-auto px-1 items-center">
        {primaryItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center h-full transition-colors active:scale-95 ${
                isActive ? 'text-blue-600 font-semibold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <div className={`p-1 rounded-full ${isActive ? 'bg-blue-50' : ''}`}>
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
              </div>
              <span className="text-[11px] leading-tight mt-0.5 truncate max-w-full px-1">{item.label}</span>
            </Link>
          );
        })}

        {/* Menu Drawer Toggle */}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-col items-center justify-center h-full text-slate-500 hover:text-slate-900 active:scale-95 transition-colors"
          aria-label="فتح القائمة الكاملة"
        >
          <div className="p-1 rounded-full hover:bg-slate-100">
            <Menu className="w-5 h-5 stroke-[1.8]" />
          </div>
          <span className="text-[11px] leading-tight mt-0.5 truncate">المزيد</span>
        </button>
      </div>
    </nav>
  );
}
