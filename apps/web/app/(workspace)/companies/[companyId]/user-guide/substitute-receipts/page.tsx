import { UserGuidePage } from '@/features/user-guide/UserGuidePage';
import { buildSubstituteReceiptGuide } from '@/features/user-guide/substitute-receipt-guide.content';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function SubstituteReceiptUserGuideRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  // Same rule as the reimbursement manual: content for all, shortcut buttons by permission.
  const session = await fetchServerSession(companyId);
  return <UserGuidePage guide={buildSubstituteReceiptGuide(companyId, session?.permissions ?? [])} />;
}
