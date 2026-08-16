import { fetchServerSession } from '@/common/auth/server-session';
import { SubstituteReceiptWizardPage } from '@/features/expenses/SubstituteReceiptWizardPage';
import { hasSelfApprovalExemptRole } from '@/features/expenses/substitute-receipt-wizard.model';

export default async function NewSubstituteReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ expenseId?: string; workflow?: string }>;
}) {
  const { companyId } = await params;
  const { expenseId, workflow } = await searchParams;
  const session = await fetchServerSession(companyId);
  return (
    <SubstituteReceiptWizardPage
      companyId={companyId}
      initialExpenseId={expenseId}
      workflowId={workflow}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      canSelfApprove={hasSelfApprovalExemptRole(session?.roles)}
    />
  );
}
