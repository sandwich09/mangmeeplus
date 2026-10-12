import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';
import { WhtCertificatesPage } from '@/features/expenses/WhtCertificatesPage';

export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const denied = requireRoutePermission(session, '/expenses/wht-certificates');
  return denied ?? <WhtCertificatesPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
