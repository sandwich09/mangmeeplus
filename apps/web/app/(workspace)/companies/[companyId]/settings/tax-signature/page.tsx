import { redirect } from 'next/navigation';
import { shopHasSystemWhtCertificates } from '@/features/expenses/expense-wht-certificates.logic';
import { fetchServerSession } from '@/common/auth/server-session';
import { TaxSignatureSettingsPage } from '@/features/tax/TaxSignatureSettingsPage';

export default async function TaxSignaturePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!shopHasSystemWhtCertificates(session?.entitledFeatureKeys)) redirect(`/companies/${companyId}/expenses/wht-certificates`);
  return <TaxSignatureSettingsPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
