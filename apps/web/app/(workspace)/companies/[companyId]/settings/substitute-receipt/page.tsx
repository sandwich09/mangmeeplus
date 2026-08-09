import { SubstituteReceiptSettingsPage } from '@/features/expenses/SubstituteReceiptSettingsPage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function SubstituteReceiptPolicyPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/substitute-receipt');
  if (forbidden) return forbidden;
  return <SubstituteReceiptSettingsPage companyId={companyId} />;
}
