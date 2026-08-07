import { ReimbursementsHubPage } from '@/features/reimbursements/ReimbursementsPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ReimbursementsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return (
    <ReimbursementsHubPage
      companyId={companyId}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      roles={session?.roles ?? []}
    />
  );
}
