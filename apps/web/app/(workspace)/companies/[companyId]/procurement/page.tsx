import { ProcurementHubPage } from '@/features/procurement/ProcurementPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ProcurementPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <ProcurementHubPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
