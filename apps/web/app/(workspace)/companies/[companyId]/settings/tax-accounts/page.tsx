import { fetchServerSession } from '@/common/auth/server-session';
import { TaxAccountSettingsPage } from '@/features/tax/TaxAccountSettingsPage';

export default async function TaxAccountsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <TaxAccountSettingsPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
