import { fetchServerSession } from '@/common/auth/server-session';
import { SubstituteReceiptWizardPage } from '@/features/expenses/SubstituteReceiptWizardPage';
import { hasSelfApprovalExemptRole } from '@/features/expenses/substitute-receipt-wizard.model';

export default async function ExistingSubstituteReceiptPage({
  params,
}: {
  params: Promise<{ companyId: string; evidenceId: string }>;
}) {
  const { companyId, evidenceId } = await params;
  const session = await fetchServerSession(companyId);
  return (
    <SubstituteReceiptWizardPage
      companyId={companyId}
      evidenceId={evidenceId}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      canSelfApprove={hasSelfApprovalExemptRole(session?.roles)}
    />
  );
}
