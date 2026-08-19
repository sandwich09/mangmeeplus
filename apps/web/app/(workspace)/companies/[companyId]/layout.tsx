import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import WorkspaceLayoutClient from '@/features/web-core-workspace/WorkspaceLayout';
import { fetchServerSession, fetchServerSessionResult } from '@/common/auth/server-session';
import CompanyAccessUnavailable from '@/features/auth/CompanyAccessUnavailable';
import { legalAcceptancePath } from '@/common/auth/session-gate.logic';

export default async function CompanyWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;

  // Middleware already bounces cookie-less visits; this covers expired/revoked tokens
  // that still carry a cookie. The login page silently refreshes and returns here.
  const sessionResult = await fetchServerSessionResult(companyId);
  if (sessionResult.status === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/dashboard`)}`);
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
    return <CompanyAccessUnavailable displayName={current?.displayName ?? null} />;
  }
  const returnTo = `/companies/${companyId}/dashboard`;
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
