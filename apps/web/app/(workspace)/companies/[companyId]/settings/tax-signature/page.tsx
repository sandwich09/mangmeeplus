import { fetchServerSession } from '@/common/auth/server-session';
import { TaxSignatureSettingsPage } from '@/features/tax/TaxSignatureSettingsPage';

export default async function TaxSignaturePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <TaxSignatureSettingsPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
