import { fetchServerSession } from '@/common/auth/server-session';
import { AiSuggestionsHubPage } from '@/features/ai-suggestions/AiSuggestionsPages';
import { canOpenManualWeb } from '@/features/expenses/manual-expense-entry.logic';

export default async function AiSuggestionsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <AiSuggestionsHubPage companyId={companyId} permissions={session?.permissions ?? []} canOpenManualExpense={canOpenManualWeb(session, companyId)} />;
}
