import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SystemHeader from '@/common/components/app-shell/SystemHeader';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { isSystemAdmin, canOpenSystemBilling, canOpenSystemExecutive, isExecutiveOnlySession, legalAcceptancePath, systemGateReturnPath } from '@/common/auth/session-gate.logic';
import { REQUEST_PATH_HEADER } from '@/common/auth/auth-cookies.constants';
import SystemAccessDenied from '@/features/auth/SystemAccessDenied';

export const dynamic = 'force-dynamic';

// Platform scope. Middleware only bounces cookie-less visits, and a cookie proves nothing — so the
// real session is validated here; section readers enter only their permission-checked subtree.
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
  if (result.status === 'forbidden' || (!isSystemAdmin(result.session) && !canOpenSystemBilling(result.session, returnTo) && !canOpenSystemExecutive(result.session, returnTo))) {
    return <SystemAccessDenied executive={result.status === 'signed_in' && isExecutiveOnlySession(result.session)} />;
  }
  if (result.session.mustChangePassword) {
    redirect(`/change-password?next=${encodeURIComponent(returnTo)}`);
  }
  if (result.session.legalAcceptanceRequired !== false) {
    redirect(legalAcceptancePath(returnTo, result.session.companyId));
  }

  const environment = process.env.DEPLOY_ENVIRONMENT === 'uat' ? 'ระบบทดสอบ UAT'
    : process.env.DEPLOY_ENVIRONMENT === 'production' ? 'ระบบจริง'
      : process.env.APP_ENV === 'local' ? 'ทดสอบในเครื่อง' : undefined;

  return (
    <div className="min-h-dvh bg-gray-50">
      <SystemHeader homeThemeAllowed={isSystemAdmin(result.session) && result.session.permissions.includes('system.home_theme.manage')} whtCategoriesAllowed={result.session.permissions.includes('system.wht_income_category.manage')} executiveUsersAllowed={result.session.permissions.includes('system.executive_user.manage')} environment={environment} billingOnly={!isSystemAdmin(result.session)} executiveOnly={isExecutiveOnlySession(result.session)} executiveAllowed={result.session.permissions.includes('system.executive.read')} billingAllowed={result.session.permissions.includes('system.billing.read')} emailAllowed={result.session.permissions.includes('system.email_delivery.read')} />
      <div className="min-w-0 lg:pl-64">{children}</div>
    </div>
  );
}
