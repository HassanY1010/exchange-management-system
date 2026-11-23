import type { Metadata, Viewport } from 'next';
import './globals.css';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://exchange-management-system.onrender.com';
const BRAND_TITLE = 'أبو جواد للتجارة | منصة إدارة الصرافة والتحويلات المالية';
const BRAND_DESCRIPTION = 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING) - المنظومة المالية والمحاسبية المركزية لإدارة نشاط الصرافة وإيصالات بنكك والتحويلات والعهد اليومية';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: BRAND_TITLE,
    template: `%s | أبو جواد للتجارة`,
  },
  description: BRAND_DESCRIPTION,
  applicationName: 'أبو جواد للتجارة',
  authors: [{ name: 'أبو جواد للتجارة (ABU JAWAD FOR TRADEING)' }],
  creator: 'أبو جواد للتجارة',
  publisher: 'أبو جواد للتجارة',
  keywords: [
    'أبو جواد للتجارة',
    'ABU JAWAD FOR TRADEING',
    'صرافة',
    'تحويلات مالية',
    'إيصالات بنكك',
    'نظام محاسبي',
    'إدارة العملات',
  ],
  icons: {
    icon: [
      { url: '/brand/logo.png', type: 'image/png' },
    ],
    shortcut: '/brand/logo.png',
    apple: '/brand/logo.png',
  },
  openGraph: {
    type: 'website',
    locale: 'ar_SA',
    url: APP_URL,
    siteName: 'أبو جواد للتجارة | ABU JAWAD FOR TRADEING',
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    images: [
      {
        url: '/brand/og-banner.png',
        width: 1200,
        height: 630,
        alt: 'أبو جواد للتجارة - ABU JAWAD FOR TRADEING',
        type: 'image/png',
      },
      {
        url: '/brand/logo.png',
        width: 1024,
        height: 1009,
        alt: 'شعار أبو جواد للتجارة',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
    images: ['/brand/og-banner.png'],
  },
  other: {
    'og:image:secure_url': `${APP_URL}/brand/og-banner.png`,
    'og:image:type': 'image/png',
    'og:image:width': '1200',
    'og:image:height': '630',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* Open Graph / Facebook / WhatsApp explicit fallback tags */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://exchange-management-system.onrender.com/" />
        <meta property="og:site_name" content="أبو جواد للتجارة | ABU JAWAD FOR TRADEING" />
        <meta property="og:title" content="أبو جواد للتجارة | منصة إدارة الصرافة والتحويلات المالية" />
        <meta property="og:description" content="أبو جواد للتجارة (ABU JAWAD FOR TRADEING) - المنظومة المالية والمحاسبية المركزية لإدارة نشاط الصرافة وإيصالات بنكك والتحويلات والعهد اليومية" />
        <meta property="og:image" content="https://exchange-management-system.onrender.com/brand/og-banner.png" />
        <meta property="og:image:secure_url" content="https://exchange-management-system.onrender.com/brand/og-banner.png" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="أبو جواد للتجارة - ABU JAWAD FOR TRADEING" />
        <meta property="og:locale" content="ar_SA" />

        {/* Twitter Card explicit fallback tags */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content="https://exchange-management-system.onrender.com/" />
        <meta name="twitter:title" content="أبو جواد للتجارة | منصة إدارة الصرافة والتحويلات المالية" />
        <meta name="twitter:description" content="أبو جواد للتجارة (ABU JAWAD FOR TRADEING) - المنظومة المالية والمحاسبية المركزية لإدارة نشاط الصرافة وإيصالات بنكك والتحويلات والعهد اليومية" />
        <meta name="twitter:image" content="https://exchange-management-system.onrender.com/brand/og-banner.png" />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                window.addEventListener('error', function(event) {
                  if (event && event.message && (event.message.indexOf('M_ID') !== -1 || event.message.indexOf('m_id') !== -1)) {
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    return true;
                  }
                }, true);
              }
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased bg-slate-50 text-slate-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
