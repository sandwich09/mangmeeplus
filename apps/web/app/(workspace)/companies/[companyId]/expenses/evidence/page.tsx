import { ExpensesHubPage } from '@/features/expenses/ExpensesPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ExpensesEvidencePage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <ExpensesHubPage companyId={companyId} userId={session?.userId ?? ''} permissions={session?.permissions ?? []} freeExpenseDrafts={session?.freeExpenseDrafts === true} tab="evidence" />;
}
