import { IndividualPermissionsPrototypePage } from '@/features/employee-access/IndividualPermissionsPrototypePage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function SettingsAccessOverviewPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/access-overview');
  if (forbidden) return forbidden;
  return <IndividualPermissionsPrototypePage companyId={companyId} viewerPermissions={session?.permissions ?? []} />;
}
