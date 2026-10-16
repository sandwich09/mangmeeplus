'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { primaryButtonClass } from '@/common/components/button';
import { AuthFrame, authTitleClass } from './AuthFrame';

/** Legacy account links are retired; web signup claim and password reset keep their own routes. */
export default function VerifyEmailPage() {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.delete('token'); url.hash = fragment.toString();
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  // One sentence and the one next step. Nothing was lost by an old link, so nothing has to be reassured.
  return <AuthFrame>
    <h1 className={authTitleClass}>ลิงก์ยืนยันอีเมลแบบเดิมใช้ไม่ได้แล้ว</h1>
    <p className="mt-2 text-[15px] leading-7 text-gray-600">เข้าสู่ระบบ แล้วขอรหัสยืนยันที่หน้าบัญชีของฉัน</p>
    <Link href="/login" className={`${primaryButtonClass} mt-6 w-full`}>เข้าสู่ระบบ</Link>
  </AuthFrame>;
}
