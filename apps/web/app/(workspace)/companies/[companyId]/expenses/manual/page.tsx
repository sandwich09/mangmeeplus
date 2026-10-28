import { ExpensesHubPage } from '@/features/expenses/ExpensesPages';
import { canOpenManualWeb } from '@/features/expenses/manual-expense-entry.logic';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ExpensesManualPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  // The hub is rendered whatever the company setting says, and the setting travels as a prop: the
  // page's admission is client state (spec §7.1), so a refresh after the admin switches the menu off
  // must change a prop, not swap this tree and take an open form with it.
  return <ExpensesHubPage companyId={companyId} userId={session?.userId ?? ''} permissions={session?.permissions ?? []} freeExpenseDrafts={session?.freeExpenseDrafts === true} tab="manual" manualEntryOpen={canOpenManualWeb(session, companyId)} readerIsOwner={session?.roles.includes('OWNER') ?? false} />;
}
