import { ExpensesHubPage } from '@/features/expenses/ExpensesPages';
import { canOpenManualWeb } from '@/features/expenses/manual-expense-entry.logic';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ExpensesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <ExpensesHubPage companyId={companyId} userId={session?.userId ?? ''} permissions={session?.permissions ?? []} freeExpenseDrafts={session?.freeExpenseDrafts === true} manualEntryOpen={canOpenManualWeb(session, companyId)} readerIsOwner={session?.roles.includes('OWNER') ?? false} />;
}
