import { ForbiddenState } from '@/common/components/state';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';
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
  if (!canSeeRoute('/ai-suggestions', session?.permissions ?? [])) return <ForbiddenState titleAs="h1" packageAvailable={session?.availablePermissions ? canSeeRoute('/ai-suggestions', session.availablePermissions) : undefined} isOwner={session?.roles.includes('OWNER')} action={<BackLink href={`/companies/${companyId}/dashboard`} label="กลับไปหน้าแรก" />} />;
  return <AiSuggestionsHubPage companyId={companyId} permissions={session?.permissions ?? []} canOpenManualExpense={canOpenManualWeb(session, companyId)} />;
}
