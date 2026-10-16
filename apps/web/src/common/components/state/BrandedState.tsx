import type { ReactNode } from 'react';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';

export function BrandedState({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /**
   * Two or three actions as one group by the shared rule (thai-ux-standard §2.3, §2.4): shared
   * buttons or links as direct children, **the one that backs out first, the one that acts last**.
   * They come out one width, side by side in the middle of the card, or stacked with the acting
   * one on top when the names do not fit. Use this instead of hand-styled anchors in `children`.
   */
  actions?: ReactNode;
  /** Free content under the text, laid out as it always was (a column on a phone, a centred row from 640 px). */
  children?: ReactNode;
}) {
  return (
    <main className="mangmee-safe-bottom relative flex min-h-dvh items-center justify-center overflow-hidden bg-brand-25 p-4 sm:p-6">
      <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full bg-brand-200/50 blur-3xl" />
      <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-gold-100/70 blur-3xl" />
      <section className="relative w-full max-w-lg rounded-3xl border border-brand-100 bg-white p-6 text-center shadow-[0_24px_70px_rgba(21,128,61,.12)] sm:p-12">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl sm:h-16 sm:w-16 bg-linear-to-br from-brand-500 to-brand-900 shadow-lg shadow-brand-900/15">
          <MangmeeLogo size={36} />
        </div>
        {/* No letter-spacing: on Thai it opens a gap after every letter and pulls the marks off their base. */}
        <p className="mt-5 text-xs font-bold sm:mt-6 text-brand-600">{eyebrow}</p>
        <h1 className="mt-3 text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-gray-500">{description}</p>
        {actions ? <ActionGroup align="center" className="mt-6 sm:mt-7">{actions}</ActionGroup> : null}
        {children ? (
          <div className="mt-6 flex flex-col items-stretch gap-3 sm:mt-7 sm:flex-row sm:flex-wrap sm:justify-center">
            {children}
          </div>
        ) : null}
        <p className="mt-6 text-xs font-semibold text-gray-300 sm:mt-8">มั่ง<span className="text-gold-500">มี</span></p>
      </section>
    </main>
  );
}
