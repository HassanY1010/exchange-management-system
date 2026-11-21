import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'منصة إدارة الصرافة والتحويلات المالية والمحاسبة',
  description: 'نظام مالي ومحاسبي متكامل لإدارة نشاط الصرافة وإيصالات بنكك والعهد والموردين والإغلاق اليومي',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-slate-50 text-slate-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
