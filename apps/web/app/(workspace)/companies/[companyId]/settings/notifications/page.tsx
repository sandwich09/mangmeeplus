import { NotificationPreferencesPage } from '@/features/dashboard-notifications/NotificationPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function SettingsNotificationsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <NotificationPreferencesPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
