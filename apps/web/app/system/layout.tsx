import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SystemHeader from '@/common/components/app-shell/SystemHeader';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { isSystemAdmin, canOpenSystemBilling, legalAcceptancePath, systemGateReturnPath } from '@/common/auth/session-gate.logic';
import { REQUEST_PATH_HEADER } from '@/common/auth/auth-cookies.constants';
import SystemAccessDenied from '@/features/auth/SystemAccessDenied';

export const dynamic = 'force-dynamic';

// Platform scope. Middleware only bounces cookie-less visits, and a cookie proves nothing — so the
// real session is validated here and the shell fails closed for everyone who is not a system admin.
export default async function SystemLayout({ children }: { children: ReactNode }) {
  const returnTo = systemGateReturnPath((await headers()).get(REQUEST_PATH_HEADER));
  const result = await fetchServerSessionResult();

  if (result.status === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  if (result.status === 'platform_closed') redirect('/maintenance');
  if (result.status === 'unavailable') {
    throw new Error('Cannot reach the authentication service. Please try again.');
  }
  if (result.status === 'forbidden' || (!isSystemAdmin(result.session) && !canOpenSystemBilling(result.session, returnTo))) {
    return <SystemAccessDenied />;
  }
  if (result.session.mustChangePassword) {
    redirect(`/change-password?next=${encodeURIComponent(returnTo)}`);
  }
  if (result.session.legalAcceptanceRequired !== false) {
    redirect(legalAcceptancePath(returnTo, result.session.companyId));
  }

  return (
    <div className="min-h-dvh bg-gray-50">
      <SystemHeader billingOnly={!isSystemAdmin(result.session)} billingAllowed={result.session.permissions.includes('system.billing.read')} emailAllowed={result.session.permissions.includes('system.email_delivery.read')} />
      {children}
    </div>
  );
}
