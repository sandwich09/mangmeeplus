'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrandedState } from '@/common/components/state';
import { Button } from '@/common/components/button';
import { AlertModal } from '@/common/components/modal';
import { logoutCurrentSession } from '@/common/auth/session';
import { companyAccessDescription, signInAgainPath } from './auth.logic';
import { useLocale } from '@/common/i18n/use-locale';

export default function CompanyAccessUnavailable({
  displayName,
  companyName,
}: {
  displayName?: string | null;
  companyName?: string | null;
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
      eyebrow={th ? 'การเข้าถึงบริษัท' : 'Company access'}
      title={th ? 'ไม่สามารถเข้าถึงบริษัทนี้ได้' : 'This company is unavailable'}
      // Naming the signed-in account is what makes the common cause self-evident: a link opened in
      // a browser (LINE's in-app browser keeps its own cookies) still signed in as another account.
      description={companyAccessDescription(locale, displayName, companyName)}
    >
      {/* home=reset: without it the remembered landing points back at this same company and the
          redirect loops (audit H-16). */}
      <Link href="/login?home=reset" className="inline-flex h-10 items-center justify-center rounded-lg bg-linear-to-br from-brand-500 to-brand-700 px-4 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-800">
        {th ? 'ไปยังบริษัทที่ใช้งานได้' : 'Go to an available company'}
      </Link>
      <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
        {th ? 'ลองอีกครั้ง' : 'Try again'}
      </Button>
      <Button type="button" loading={busy} onClick={() => void signOut()}>
        {th ? 'ออกจากระบบ' : 'Sign out'}
      </Button>
      <AlertModal
        open={signOutFailed}
        title={th ? 'ออกจากระบบ' : 'Sign out'}
        message={th ? 'ออกจากระบบไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง' : 'Sign out failed. Check your connection and try again.'}
        closeLabel={th ? 'ปิด' : 'Close'}
        onClose={() => setSignOutFailed(false)}
      />
    </BrandedState>
  );
}
