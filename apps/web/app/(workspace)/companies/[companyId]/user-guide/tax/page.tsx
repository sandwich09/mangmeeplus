import { UserGuidePage } from '@/features/user-guide/UserGuidePage';
import { buildTaxGuide } from '@/features/user-guide/tax-guide.content';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function TaxUserGuideRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <UserGuidePage guide={buildTaxGuide(companyId, session?.permissions ?? [])} />;
}
