import { WorkspaceDashboardPage } from '@/features/web-core-workspace/components/WorkspaceDashboardPage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  // Layout already redirects cookie-less/expired sessions, so session is present here.
  const session = await fetchServerSession(companyId);
  return <WorkspaceDashboardPage companyId={companyId} permissions={session?.permissions ?? []} displayName={session?.displayName ?? null} />;
}
