import { fetchServerSession } from '@/common/auth/server-session';
import { SubstituteReceiptHubPage } from '@/features/expenses/SubstituteReceiptHubPage';
import { hasSelfApprovalExemptRole } from '@/features/expenses/substitute-receipt-wizard.model';

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
      canSelfApprove={hasSelfApprovalExemptRole(session?.roles)}
    />
  );
}
