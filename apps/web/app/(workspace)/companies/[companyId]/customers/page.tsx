import { redirect } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';
import { CustomersPrototypePage } from '@/features/crm/CustomersPrototypePage';

export default async function CustomersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/customers`)}`);
  return <CustomersPrototypePage companyId={companyId} permissions={session.permissions} roles={session.roles} />;
}
