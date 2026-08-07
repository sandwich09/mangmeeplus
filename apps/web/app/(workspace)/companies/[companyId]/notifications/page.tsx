import { NotificationCenterPage } from '@/features/dashboard-notifications/NotificationPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <NotificationCenterPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
