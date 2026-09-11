import { fetchServerSession } from '@/common/auth/server-session';
import { AiSuggestionsHubPage } from '@/features/ai-suggestions/AiSuggestionsPages';

export default async function AiSuggestionsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <AiSuggestionsHubPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
