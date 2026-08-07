import { BankingHubPage } from '@/features/banking/BankingPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function BankingPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <BankingHubPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
