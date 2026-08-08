import { DiscountPolicyPage } from '@/features/employee-access/DiscountPolicyPage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function DiscountPolicyRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/discount-policy');
  if (forbidden) return forbidden;
  return <DiscountPolicyPage companyId={companyId} />;
}
