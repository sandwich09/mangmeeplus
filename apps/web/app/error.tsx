'use client';

import { useEffect, useState } from 'react';
import { BrandedState } from '@/common/components/state';
import { Button, secondaryButtonClass } from '@/common/components/button';
import { logoutCurrentSession } from '@/common/auth/session';
import { useLocale } from '@/common/i18n/use-locale';

export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  const [locale] = useLocale();
  const th = locale === 'th';
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  // A permanently broken landing route still needs a sign-out exit even when retry cannot recover.
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
      eyebrow=""
      title={th ? 'เปิดหน้านี้ไม่ได้' : 'We could not open this page'}
      description={th ? 'ระบบขัดข้องชั่วคราว ปัญหาอยู่ที่ระบบของเรา' : 'A temporary problem on our side.'}
      // One group, three weights: the way out of the account first, the way that fixes it last.
      actions={<>
        <Button variant="quiet" type="button" loading={signingOut} onClick={handleSignOut}>{th ? 'ออกจากระบบ' : 'Sign out'}</Button>
        {/* A plain anchor, not <Link>: a soft navigation re-renders inside the tree that just threw,
            and a full load also drops any stale client chunks left by a redeploy. `home=reset` skips a
            remembered landing that may itself be the page that failed. */}
        <a href="/login?home=reset" className={secondaryButtonClass}>{th ? 'กลับไปหน้าแรก' : 'Back to home'}</a>
        {/* Refetch the server page as well; resetting only the boundary can replay its cached failure. */}
        <Button type="button" onClick={() => window.location.reload()}>{th ? 'ลองอีกครั้ง' : 'Try again'}</Button>
      </>}
    >
      {signOutFailed && (
        <p role="alert" className="w-full text-sm text-red-600">
          {th
            ? 'ออกจากระบบไม่สำเร็จ คุณยังอยู่ในระบบ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง'
            : 'Sign-out failed and you are still signed in. Check your connection and try again.'}
        </p>
      )}
    </BrandedState>
  );
}
