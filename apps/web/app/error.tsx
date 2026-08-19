'use client';

import { useEffect, useState } from 'react';
import { BrandedState } from '@/common/components/state';
import { Button } from '@/common/components/button';
import { logoutCurrentSession } from '@/common/auth/session';
import { useLocale } from '@/common/i18n/use-locale';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale] = useLocale();
  const th = locale === 'th';
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  // When the landing route itself throws every time, neither button here escapes: `reset` re-renders
  // the tree that just threw, and /login redirects an authenticated session straight back into that
  // same route (app/login/page.tsx records the same loop). Signing out is the only exit, so it has
  // to live on this screen — without it the app is unusable and the user cannot even leave.
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    if (!(await logoutCurrentSession())) {
      setSigningOut(false);
      setSignOutFailed(true);
    }
  };

  return (
    <BrandedState
      eyebrow={th ? 'ระบบขัดข้องชั่วคราว' : 'Temporary problem'}
      title={th ? 'ไม่สามารถเปิดหน้านี้ได้' : 'We could not open this page'}
      description={th ? 'ระบบหรือการเชื่อมต่ออาจขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' : 'The service or connection may be temporarily unavailable. Please try again.'}
    >
      <Button type="button" onClick={reset}>{th ? 'ลองอีกครั้ง' : 'Try again'}</Button>
      {/* A plain anchor, not <Link>: a soft navigation re-renders inside the tree that just threw,
          and a full load also drops any stale client chunks left by a redeploy. `home=reset` skips a
          remembered landing that may itself be the page that failed. */}
      <a
        href="/login?home=reset"
        className="inline-flex h-11 items-center justify-center sm:h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        {th ? 'กลับหน้าหลัก' : 'Back to home'}
      </a>
      <Button variant="secondary" type="button" onClick={handleSignOut} disabled={signingOut}>
        {signingOut ? (th ? 'กำลังออกจากระบบ…' : 'Signing out…') : th ? 'ออกจากระบบ' : 'Sign out'}
      </Button>
      {signOutFailed && (
        <p className="mt-3 w-full text-sm text-red-600">
          {th
            ? 'ออกจากระบบไม่สำเร็จ คุณยังอยู่ในระบบ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง'
            : 'Sign-out failed and you are still signed in. Check your connection and try again.'}
        </p>
      )}
    </BrandedState>
  );
}
