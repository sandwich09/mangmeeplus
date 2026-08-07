import { fetchServerSession } from '@/common/auth/server-session';
import { TaxCodeSettingsPage } from '@/features/tax/TaxCodeSettingsPage';

export default async function TaxCodesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <TaxCodeSettingsPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
