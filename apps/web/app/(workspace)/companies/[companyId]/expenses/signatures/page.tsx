import { ExpensesHubPage } from '@/features/expenses/ExpensesPages';
import { fetchServerSession } from '@/common/auth/server-session';

// Un-parked 2026-08-20 (owner decision), reversing the 2026-08-05 park. The park's rationale was
// that approved assets had no consumer; substitute receipts now certify with exactly these assets,
// and the LINE flow sends people here by link, so the screen has to exist.
export default async function ExpensesSignaturesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <ExpensesHubPage companyId={companyId} userId={session?.userId ?? ''} permissions={session?.permissions ?? []} freeExpenseDrafts={session?.freeExpenseDrafts === true} tab="signatures" />;
}
