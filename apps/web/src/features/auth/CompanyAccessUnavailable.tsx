'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrandedState } from '@/common/components/state';
import { Button, primaryButtonClass } from '@/common/components/button';
import { AlertModal } from '@/common/components/modal';
import { logoutCurrentSession } from '@/common/auth/session';
import { companyAccessDescription, signInAgainPath } from './auth.logic';
import { useLocale } from '@/common/i18n/use-locale';

export default function CompanyAccessUnavailable({
  displayName,
  companyName,
  code,
}: {
  displayName?: string | null;
  companyName?: string | null;
  code?: string;
}) {
  const [locale] = useLocale();
  const [busy, setBusy] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const th = locale === 'th';

  async function signOut() {
    setBusy(true);
    // Keep the blocked destination: this screen is usually a LINE deep link opened in a browser
    // still signed in as another account, so the next sign-in must land on the link itself.
    const target = signInAgainPath(window.location.pathname, window.location.search);
    if (!(await logoutCurrentSession(target))) {
      setBusy(false);
      // Themed dialog instead of window.alert(): the browser alert ignored the app theme.
      setSignOutFailed(true);
    }
  }

  return (
    <BrandedState
      eyebrow=""
      title={th ? 'เข้าร้านนี้ไม่ได้' : 'This shop is unavailable'}
      // Naming the signed-in account is what makes the common cause self-evident: a link opened in
      // a browser (LINE's in-app browser keeps its own cookies) still signed in as another account.
      description={companyAccessDescription(locale, displayName, companyName, code)}
      // One group, one filled button: the way out of the account first, the way onward last.
      actions={<>
        <Button type="button" variant="quiet" loading={busy} onClick={() => void signOut()}>
          {th ? 'ออกจากระบบ' : 'Sign out'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
          {th ? 'ลองอีกครั้ง' : 'Try again'}
        </Button>
        {/* home=reset: without it the remembered landing points back at this same company and the
            redirect loops (audit H-16). */}
        <Link href="/login?home=reset" className={primaryButtonClass}>
          {th ? 'ไปร้านที่เข้าได้' : 'Go to a shop you can open'}
        </Link>
      </>}
    >
      <AlertModal
        open={signOutFailed}
        title={th ? 'ออกจากระบบไม่สำเร็จ' : 'Sign-out failed'}
        message={th ? 'คุณยังอยู่ในระบบ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง' : 'You are still signed in. Check your connection and try again.'}
        closeLabel={th ? 'ปิด' : 'Close'}
        onClose={() => setSignOutFailed(false)}
      />
    </BrandedState>
  );
}
