import { NotificationRulesPage } from '@/features/dashboard-notifications/NotificationPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function SettingsNotificationRulesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <NotificationRulesPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
