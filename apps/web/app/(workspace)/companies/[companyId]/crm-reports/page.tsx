import { redirect } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';
import { CrmReportsPrototypePage } from '@/features/crm/CrmReportsPrototypePage';

export default async function CrmReportsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/crm-reports`)}`);
  return <CrmReportsPrototypePage companyId={companyId} permissions={session.permissions} />;
}
