'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrandedState } from '@/common/components/state';
import { Button } from '@/common/components/button';
import { AlertModal } from '@/common/components/modal';
import { logoutCurrentSession } from '@/common/auth/session';
import { signInAgainPath } from './auth.logic';
import { useLocale } from '@/common/i18n/use-locale';

export default function CompanyAccessUnavailable({ displayName }: { displayName?: string | null }) {
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
      description={displayName
        ? (th
          ? `คุณกำลังเข้าสู่ระบบเป็น "${displayName}" ซึ่งไม่มีสิทธิ์ในบริษัทนี้ หากลิงก์นี้มาจากอีกบัญชีหนึ่ง ให้ออกจากระบบแล้วเข้าสู่ระบบใหม่ด้วยบัญชีนั้น หรือติดต่อผู้ดูแลบริษัท`
          : `You are signed in as "${displayName}", which has no access to this company. If this link belongs to another account, sign out and sign in with that account, or contact your company administrator.`)
        : (th
          ? 'บริษัทอาจถูกปิดใช้งาน หรือสิทธิ์ของคุณถูกยกเลิก กรุณาติดต่อผู้ดูแลบริษัท หากต้องการเปลี่ยนบัญชีให้ออกจากระบบแล้วเข้าสู่ระบบใหม่'
          : 'The company may be inactive or your access may have been removed. Contact your company administrator, or sign out to use another account.')}
    >
      {/* home=reset: without it the remembered landing points back at this same company and the
          redirect loops (audit H-16). */}
      <Link href="/login?home=reset" className="inline-flex h-10 items-center rounded-lg bg-linear-to-br from-brand-500 to-brand-700 px-4 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-800">
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
