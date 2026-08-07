'use client';

import { useEffect } from 'react';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="th">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-brand-25 p-6">
          <section className="w-full max-w-lg rounded-3xl border border-brand-100 bg-white p-10 text-center shadow-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-900">
              <MangmeeLogo size={36} />
            </div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[.2em] text-brand-600">System error</p>
            <h1 className="mt-3 text-2xl font-extrabold text-gray-900">ระบบขัดข้องชั่วคราว</h1>
            <p className="mt-3 text-sm leading-7 text-gray-500">กรุณาลองเปิดระบบอีกครั้ง หากยังพบปัญหาให้ติดต่อผู้ดูแลระบบ</p>
            <button type="button" onClick={reset} className="mt-7 inline-flex h-10 items-center rounded-lg bg-linear-to-br from-brand-500 to-brand-700 px-4 text-sm font-medium text-white">
              ลองอีกครั้ง
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
