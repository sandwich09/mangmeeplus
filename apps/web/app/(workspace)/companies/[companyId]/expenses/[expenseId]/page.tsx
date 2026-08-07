import { ExpenseReviewPage } from '@/features/expenses/ExpenseReviewPage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; expenseId: string }>;
}) {
  const { companyId, expenseId } = await params;
  const session = await fetchServerSession(companyId);
  return <ExpenseReviewPage companyId={companyId} expenseId={expenseId} userId={session?.userId ?? ''} permissions={session?.permissions ?? []} isOwner={session?.roles.includes('OWNER') ?? false} />;
}
