import { AccountsPayableHubPage } from '@/features/accounts-payable/AccountsPayablePages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function AccountsPayablePage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <AccountsPayableHubPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
