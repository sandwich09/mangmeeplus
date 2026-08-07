import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import WorkspaceLayoutClient from '@/features/web-core-workspace/WorkspaceLayout';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import CompanyAccessUnavailable from '@/features/auth/CompanyAccessUnavailable';

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
  // An unreachable/erroring auth service is an outage: say so honestly. Sending it to /login would
  // bounce straight back here (the cookie is still valid), and notFound() would lie about the cause.
  if (sessionResult.status === 'unavailable') {
    throw new Error('Cannot reach the authentication service. Please try again.');
  }
  if (sessionResult.status === 'forbidden') return <CompanyAccessUnavailable />;

  return (
    <WorkspaceLayoutClient companyId={companyId} session={sessionResult.session}>
      {children}
    </WorkspaceLayoutClient>
  );
}
