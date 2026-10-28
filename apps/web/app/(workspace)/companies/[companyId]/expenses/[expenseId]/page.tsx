import { shopHasSystemWhtCertificates } from '@/features/expenses/expense-wht-certificates.logic';
import { ExpenseReviewPage } from '@/features/expenses/ExpenseReviewPage';
import { fetchServerSession } from '@/common/auth/server-session';
import { hasSelfApprovalExemptRole } from '@/features/expenses/substitute-receipt-wizard.model';
import { canOpenDisbursementVoucherWeb } from '@/features/expenses/disbursement-voucher-entry.logic';

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; expenseId: string }>;
}) {
  const { companyId, expenseId } = await params;
  const session = await fetchServerSession(companyId);
  return <ExpenseReviewPage systemCertificatesAvailable={shopHasSystemWhtCertificates(session?.entitledFeatureKeys)} companyId={companyId} expenseId={expenseId} userId={session?.userId ?? ''} permissions={session?.permissions ?? []} freeExpenseDrafts={session?.freeExpenseDrafts === true} canSelfApprove={hasSelfApprovalExemptRole(session?.roles)} disbursementEntryOpen={canOpenDisbursementVoucherWeb(session, companyId)} />;
}
