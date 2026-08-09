import { UserGuidePage } from '@/features/user-guide/UserGuidePage';
import { buildReportsGuide } from '@/features/user-guide/reports-guide.content';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ReportsUserGuideRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <UserGuidePage guide={buildReportsGuide(companyId, session?.permissions ?? [])} />;
}
