import { fetchServerSession } from '@/common/auth/server-session';
import { CounterpartyDetailPage } from '@/features/counterparties/CounterpartyDetailPage';

export default async function CounterpartyRoute({
  params,
}: {
  params: Promise<{ companyId: string; counterpartyId: string }>;
}) {
  const { companyId, counterpartyId } = await params;
  const session = await fetchServerSession(companyId);
  return (
    <CounterpartyDetailPage
      companyId={companyId}
      counterpartyId={counterpartyId}
      permissions={session?.permissions ?? []}
    />
  );
}
