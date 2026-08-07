import { fetchServerSession } from '@/common/auth/server-session';
import { TradeTaxEvidencePage } from '@/features/tax/TradeTaxEvidencePage';

export default async function TaxEvidenceRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <TradeTaxEvidencePage companyId={companyId} permissions={session?.permissions ?? []} />;
}
