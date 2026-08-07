import { WorkflowHubPage } from '@/features/workflow/WorkflowPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <WorkflowHubPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
