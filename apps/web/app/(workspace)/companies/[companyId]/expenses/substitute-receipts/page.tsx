import { fetchServerSession } from '@/common/auth/server-session';
import { SubstituteReceiptHubPage } from '@/features/expenses/SubstituteReceiptHubPage';

export default async function SubstituteReceiptsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return (
    <SubstituteReceiptHubPage
      companyId={companyId}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      isOwner={session?.roles.includes('OWNER') ?? false}
    />
  );
}
