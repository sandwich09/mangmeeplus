import { TaxWorkspacePage } from '@/features/tax/TaxWorkspacePage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function TaxPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <TaxWorkspacePage companyId={companyId} permissions={session?.permissions ?? []} />;
}
