import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import SystemHeader from '@/common/components/app-shell/SystemHeader';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { isSystemAdmin, legalAcceptancePath } from '@/common/auth/session-gate.logic';
import SystemAccessDenied from '@/features/auth/SystemAccessDenied';

export const dynamic = 'force-dynamic';

// Platform scope. Middleware only bounces cookie-less visits, and a cookie proves nothing — so the
// real session is validated here and the shell fails closed for everyone who is not a system admin.
// ponytail: a layout cannot read the current pathname, so the recovery target is the section root
// (deep links keep their exact `next` through the cookie-less middleware redirect).
export default async function SystemLayout({ children }: { children: ReactNode }) {
  const result = await fetchServerSessionResult();

  if (result.status === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent('/system/platform-access')}`);
  }
  if (result.status === 'platform_closed') redirect('/maintenance');
  if (result.status === 'unavailable') {
    throw new Error('Cannot reach the authentication service. Please try again.');
  }
  if (result.status === 'forbidden' || !isSystemAdmin(result.session)) {
    return <SystemAccessDenied />;
  }
  if (result.session.mustChangePassword) {
    redirect(`/change-password?next=${encodeURIComponent('/system/platform-access')}`);
  }
  if (result.session.legalAcceptanceRequired !== false) {
    redirect(legalAcceptancePath('/system/platform-access', result.session.companyId));
  }

  return (
    <div className="min-h-dvh bg-gray-50">
      <SystemHeader />
      {children}
    </div>
  );
}
