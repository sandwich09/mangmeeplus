import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SalesHeader from '@/common/components/app-shell/SalesHeader';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { canOpenSales, legalAcceptancePath, salesGateReturnPath } from '@/common/auth/session-gate.logic';
import { REQUEST_PATH_HEADER } from '@/common/auth/auth-cookies.constants';
import SystemAccessDenied from '@/features/auth/SystemAccessDenied';

export const dynamic = 'force-dynamic';

// S07: the sales console is its own platform scope — not `/system`, which stays SYSTEM_ADMIN and
// billing-only. Modelled on that layout for the same reason: middleware only bounces cookie-less
// visits, and a cookie proves nothing, so the real session is validated here and the shell fails
// closed for everyone without `sales.console.read`.
export default async function SalesLayout({ children }: { children: ReactNode }) {
  const returnTo = salesGateReturnPath((await headers()).get(REQUEST_PATH_HEADER));
  const result = await fetchServerSessionResult();

  if (result.status === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }
  if (result.status === 'platform_closed') redirect('/maintenance');
  if (result.status === 'unavailable') {
    throw new Error('Cannot reach the authentication service. Please try again.');
  }
  if (result.status === 'forbidden' || !canOpenSales(result.session)) {
    return <SystemAccessDenied />;
  }
  // Q3/S28: a new เซลล์ signs in with a one-time password, so this gate is on the journey's
  // critical path rather than an edge case.
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
      <SalesHeader environment={environment} canManageTeam={result.session.permissions.includes('sales.team.manage')}
        canReadReports={result.session.permissions.includes('sales.report.read')} />
      <div className="min-w-0 lg:pl-64">
        <main className="px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
