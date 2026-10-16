'use client';

import { useEffect } from 'react';
import { primaryButtonClass } from '@/common/components/button/button-classes';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="th">
      <body>
        <main className="flex min-h-dvh items-center justify-center bg-brand-25 p-6">
          <section className="w-full max-w-lg rounded-3xl border border-brand-100 bg-white p-10 text-center shadow-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-900">
              <MangmeeLogo size={36} />
            </div>
            <h1 className="mt-6 text-2xl font-extrabold text-gray-900">ระบบขัดข้องชั่วคราว</h1>
            <p className="mt-3 text-sm leading-7 text-gray-500">ลองอีกครั้ง ถ้ายังไม่ได้ ติดต่อทีมงานมั่งมี <a href="tel:0982565628" className="font-semibold text-brand-700 underline">098-256-5628</a></p>
            <button type="button" onClick={reset} className={`${primaryButtonClass} mt-7`}>
              ลองอีกครั้ง
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
