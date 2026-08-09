import DataRightsDetailPage from '@/features/system-data-rights/DataRightsDetailPage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function SystemDataRightsDetailRoute({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const session = await fetchServerSession();
  return <DataRightsDetailPage caseId={caseId} currentUserId={session?.userId ?? null} />;
}
