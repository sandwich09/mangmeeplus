import { redirect } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';
import { InboxPrototypePage } from '@/features/crm-inbox/InboxPrototypePage';

export default async function CompanyInboxPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/inbox`)}`);
  return <InboxPrototypePage companyId={companyId} userId={session.userId} permissions={session.permissions} />;
}
