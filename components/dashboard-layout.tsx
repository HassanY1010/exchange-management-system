'use client';

import React, { useState } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { MobileNav } from './mobile-nav';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 w-full">
      {/* Sidebar: persistent on desktop, drawer on mobile */}
      <div className="no-print h-full shrink-0 flex flex-col">
        <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full">
        <div className="no-print">
          <Header onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        </div>
        
        {/* Main scrollable body with padding for mobile bottom bar */}
        <main className="flex-1 overflow-y-auto touch-scroll p-3 sm:p-5 lg:p-8 pb-24 lg:pb-8 w-full max-w-full">
          {children}
        </main>
      </div>

      {/* Mobile Persistent Bottom Navigation Bar */}
      <div className="no-print">
        <MobileNav onOpenMenu={() => setMobileMenuOpen(true)} />
      </div>
    </div>
  );
}
