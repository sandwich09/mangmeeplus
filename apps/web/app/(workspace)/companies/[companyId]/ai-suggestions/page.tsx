import { AiSuggestionsHubPage } from '@/features/ai-suggestions/AiSuggestionsPages';

export default async function AiSuggestionsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <AiSuggestionsHubPage companyId={companyId} />;
}
