import { CompanyProfilePage } from '@/features/company-profile/CompanyProfilePage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

// Prerendering this page would build it without a CSP nonce and serve a dead screen; the same
// trap that took out /signup and /claim-account (docs/agent-memory/auto-register-flow-b.md).
export const dynamic = 'force-dynamic';

export default async function CompanyProfileSettingsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/profile');
  if (forbidden) return forbidden;
  return <CompanyProfilePage companyId={companyId} />;
}
