import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import WorkspaceLayoutClient from '@/features/web-core-workspace/WorkspaceLayout';
import { fetchServerSession, fetchServerSessionResult } from '@/common/auth/server-session';
import CompanyAccessUnavailable from '@/features/auth/CompanyAccessUnavailable';
import { companyGateReturnPath, isSalesOnlySession, legalAcceptancePath, SALES_HOME_PATH } from '@/common/auth/session-gate.logic';
import { REQUEST_PATH_HEADER } from '@/common/auth/auth-cookies.constants';

export default async function CompanyWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const returnTo = companyGateReturnPath((await headers()).get(REQUEST_PATH_HEADER), companyId);

  // Middleware already bounces cookie-less visits; this covers expired/revoked tokens
  // that still carry a cookie. The login page silently refreshes and returns here.
  const sessionResult = await fetchServerSessionResult(companyId);
  if (sessionResult.status === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  if (sessionResult.status === 'platform_closed') redirect('/maintenance');
  // An unreachable/erroring auth service is an outage: say so honestly. Sending it to /login would
  // bounce straight back here (the cookie is still valid), and notFound() would lie about the cause.
  if (sessionResult.status === 'unavailable') {
    throw new Error('Cannot reach the authentication service. Please try again.');
  }
  if (sessionResult.status === 'forbidden') {
    // Resolve the account itself — no company header, so this succeeds where the scoped call 403s —
    // and name it on the screen. Without it the page reads as "your access was revoked" even in the
    // usual case: a deep link opened in a browser still signed in as a different account.
    const current = await fetchServerSession();
    return (
      <CompanyAccessUnavailable
        displayName={current?.displayName ?? null}
        companyName={sessionResult.companyName ?? null}
      />
    );
  }
  // S29: `MANGMEE_SALES*` are memberships of มั่งมี's own platform tenant, so a เซลล์ reaching this
  // shell would be opening มั่งมี's internal company as if it were their shop. They hold no business
  // permission, so every page behind here would 403 anyway — send them to their own console instead.
  if (isSalesOnlySession(sessionResult.session)) redirect(SALES_HOME_PATH);
  // Return to the page that was actually opened, not the dashboard: a LINE deep link tapped by a
  // user with a pending password change or an unaccepted legal release used to lose its destination.
  if (sessionResult.session.mustChangePassword) {
    redirect(`/change-password?next=${encodeURIComponent(returnTo)}`);
  }
  if (sessionResult.session.legalAcceptanceRequired !== false) {
    redirect(legalAcceptancePath(returnTo, companyId));
  }

  return (
    <WorkspaceLayoutClient companyId={companyId} session={sessionResult.session}>
      {children}
    </WorkspaceLayoutClient>
  );
}
