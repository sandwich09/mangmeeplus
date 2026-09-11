import { fetchServerSession } from '@/common/auth/server-session';
import { SubstituteReceiptWizardPage } from '@/features/expenses/SubstituteReceiptWizardPage';
import { hasSelfApprovalExemptRole } from '@/features/expenses/substitute-receipt-wizard.model';

export default async function ExistingSubstituteReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; evidenceId: string }>;
  searchParams: Promise<{ edit?: string; mode?: string }>;
}) {
  const { companyId, evidenceId } = await params;
  const session = await fetchServerSession(companyId);
  return (
    <SubstituteReceiptWizardPage
      companyId={companyId}
      evidenceId={evidenceId}
      viewOnly={(await searchParams).mode === 'view'}
      initialEditPayment={(await searchParams).edit === 'payment'}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      canSelfApprove={hasSelfApprovalExemptRole(session?.roles)}
    />
  );
}
