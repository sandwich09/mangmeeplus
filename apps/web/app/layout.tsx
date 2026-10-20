import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { ToastProvider } from '@/common/components/toast';
import { LEGAL_OPERATOR } from '@/common/legal/legal-content';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(LEGAL_OPERATOR.website),
  title: 'มั่งมี | MangmeePlus',
  description: 'ระบบจัดการธุรกิจ บัญชี เอกสารขาย ค่าใช้จ่าย และรายงานภาษี พร้อมผู้ช่วย AI ที่ให้ผู้ใช้ตรวจสอบก่อนบันทึก',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // proxy.ts sends a per-request nonce CSP with 'strict-dynamic', and Next stamps that nonce on its
  // scripts only when a page renders per request. A page prerendered at build time (/privacy, /terms,
  // /forgot-password, /data-deletion, /) ships nonce-less scripts the browser blocks, so it never hydrates.
  await connection();
  return (
    <html lang="th">
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
