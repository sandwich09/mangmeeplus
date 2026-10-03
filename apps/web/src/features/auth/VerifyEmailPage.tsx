'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Legacy account links are retired; web signup claim and password reset keep their own routes. */
export default function VerifyEmailPage() {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.delete('token'); url.hash = fragment.toString();
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  return <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
    <main className="w-full max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
      <h1 className="text-xl font-semibold">ยืนยันอีเมลด้วยรหัสยืนยัน</h1>
      <p>ลิงก์ยืนยันอีเมลแบบเดิมใช้ไม่ได้แล้ว กรุณาเข้าสู่ระบบ เปิดหน้าบัญชีของฉัน แล้วขอรหัสยืนยันอีเมลใหม่</p>
      <p>อีเมลเดิมและข้อมูลร้านยังคงอยู่ หากเปลี่ยนอีเมล ระบบจะใช้อีเมลใหม่เมื่อคุณกรอกรหัสยืนยันสำเร็จ</p>
      <Link href="/login" className="inline-flex min-h-11 items-center rounded-xl bg-green-700 px-4 py-3 font-semibold text-white">เข้าสู่ระบบเพื่อขอรหัสยืนยัน</Link>
    </main>
  </div>;
}
