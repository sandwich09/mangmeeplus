import { UserGuidePage } from '@/features/user-guide/UserGuidePage';
import { buildExpensesGuide } from '@/features/user-guide/expenses-guide.content';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ExpensesUserGuideRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  // Content for all, shortcut buttons by permission — same rule as the other manuals.
  const session = await fetchServerSession(companyId);
  return <UserGuidePage guide={buildExpensesGuide(companyId, session?.permissions ?? [])} />;
}
