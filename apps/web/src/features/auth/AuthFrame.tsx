import type { ReactNode } from 'react';
import Link from 'next/link';
import { SignupBrandHeader } from '@/features/external-signup/SignupChrome';

/** The one size of title for every page a person meets before the shop opens. */
export const authTitleClass = 'text-[22px] font-bold leading-9 text-gray-900';

/** The quiet way back that sits under the card. Always the same words (glossary: `กลับไป` + the place). */
export function BackToLoginLink({ label = 'กลับไปหน้าเข้าสู่ระบบ' }: { label?: string }) {
  return (
    <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4 hover:text-brand-800">
      {label}
    </Link>
  );
}

/**
 * One frame for the pages outside the shop (thai-ux-standard §3.3): the brand bar the sign-up
 * pages already had, one card at one width, and one place under the card for the way back. A page
 * says where the person is in its own `h1` (`authTitleClass`); the frame says whose product it is.
 */
export function AuthFrame({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <div className="min-h-dvh bg-gray-50">
      <SignupBrandHeader />
      <main className="mx-auto w-full max-w-md px-4 py-6 sm:max-w-lg sm:py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">{children}</div>
        {below ? <div className="mt-3 text-center text-sm text-gray-600">{below}</div> : null}
      </main>
    </div>
  );
}
