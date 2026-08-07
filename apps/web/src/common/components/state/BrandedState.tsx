import type { ReactNode } from 'react';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';

export function BrandedState({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-25 p-6">
      <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full bg-brand-200/50 blur-3xl" />
      <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-gold-100/70 blur-3xl" />
      <section className="relative w-full max-w-lg rounded-3xl border border-brand-100 bg-white p-8 text-center shadow-[0_24px_70px_rgba(21,128,61,.12)] sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-900 shadow-lg shadow-brand-900/15">
          <MangmeeLogo size={36} />
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[.2em] text-brand-600">{eyebrow}</p>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-gray-500">{description}</p>
        {children ? <div className="mt-7 flex flex-wrap justify-center gap-3">{children}</div> : null}
        <p className="mt-8 text-xs font-semibold text-gray-300">มั่ง<span className="text-gold-500">มี</span></p>
      </section>
    </main>
  );
}
