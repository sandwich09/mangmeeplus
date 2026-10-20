import { shopHasSystemWhtCertificates } from '@/features/expenses/expense-wht-certificates.logic';
import { fetchServerSession } from '@/common/auth/server-session';
import { WithholdingPage } from '@/features/tax/WithholdingPage';
export default async function WithholdingRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <WithholdingPage systemCertificatesAvailable={shopHasSystemWhtCertificates(session?.entitledFeatureKeys)} companyId={companyId} permissions={session?.permissions ?? []} />;
}
