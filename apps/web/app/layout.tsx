import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Thai, Outfit } from 'next/font/google';
import { ToastProvider } from '@/common/components/toast';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

const plexSansThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'มั่งมี',
  description: 'ระบบบัญชีและจัดการสิทธิ์ร้านค้า',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${outfit.variable} ${plexSansThai.variable}`}>
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
