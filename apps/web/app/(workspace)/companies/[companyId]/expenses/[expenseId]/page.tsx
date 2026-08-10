import { ExpenseReviewPage } from '@/features/expenses/ExpenseReviewPage';
import { fetchServerSession } from '@/common/auth/server-session';
import { hasSelfApprovalExemptRole } from '@/features/expenses/substitute-receipt-wizard.model';

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; expenseId: string }>;
}) {
  const { companyId, expenseId } = await params;
  const session = await fetchServerSession(companyId);
  return <ExpenseReviewPage companyId={companyId} expenseId={expenseId} userId={session?.userId ?? ''} permissions={session?.permissions ?? []} canSelfApprove={hasSelfApprovalExemptRole(session?.roles)} />;
}
