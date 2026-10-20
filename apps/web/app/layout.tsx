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

// proxy.ts sends a fresh script nonce per request, and Next stamps it onto its own scripts only
// when the page renders per request. A page prerendered at build time ships un-nonced scripts that
// the CSP blocks, so it never hydrates (/privacy and /terms stuck on the loading screen, 2026-10-20).
// Opting out here keeps every page — including ones added later — rendered per request.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  return (
    <html lang="th">
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
