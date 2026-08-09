import { LineOaSettingsPage } from '@/features/crm-inbox/LineOaSettingsPage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function LineOaSettingsRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/line-oa');
  if (forbidden) return forbidden;
  return <LineOaSettingsPage companyId={companyId} />;
}
