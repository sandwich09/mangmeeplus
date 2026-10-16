import { CompanyProfilePage } from '@/features/company-profile/CompanyProfilePage';
import { fetchServerSession } from '@/common/auth/server-session';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function AccountPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect('/login');
  return <CompanyProfilePage key={companyId} companyId={companyId} permissions={session.permissions} accountOnly />;
}
