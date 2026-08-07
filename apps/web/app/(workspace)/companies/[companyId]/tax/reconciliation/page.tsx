import { fetchServerSession } from '@/common/auth/server-session';
import { TaxReconciliationPage } from '@/features/tax/TaxReconciliationPage';

export default async function TaxReconciliationRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <TaxReconciliationPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
