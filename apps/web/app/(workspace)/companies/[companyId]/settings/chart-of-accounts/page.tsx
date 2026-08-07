import { fetchServerSession } from '@/common/auth/server-session';
import { ChartOfAccountsSettingsPage } from '@/features/ledger/ChartOfAccountsSettingsPage';

export default async function ChartOfAccountsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <ChartOfAccountsSettingsPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
