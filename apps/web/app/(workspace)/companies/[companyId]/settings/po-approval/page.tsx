import { PoApprovalSettingsPage } from '@/features/employee-access/PoApprovalSettingsPage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function PoApprovalPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/po-approval');
  if (forbidden) return forbidden;
  return <PoApprovalSettingsPage companyId={companyId} />;
}
