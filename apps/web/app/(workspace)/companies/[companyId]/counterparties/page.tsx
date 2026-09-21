import { fetchServerSession } from '@/common/auth/server-session';
import { CounterpartiesPage } from '@/features/counterparties/CounterpartiesPage';

export default async function CounterpartiesRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <CounterpartiesPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
