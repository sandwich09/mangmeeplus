import { HOME_THEME_MANAGE_PERMISSION } from '@watchdog-bms/contracts';
import { fetchServerSession } from '@/common/auth/server-session';
import SystemAccessDenied from '@/features/auth/SystemAccessDenied';
import HomeThemeSettingsPage from '@/features/system-home-theme/HomeThemeSettingsPage';

export default async function HomeThemeRoute() {
  const session = await fetchServerSession();
  if (!session?.roles.includes('SYSTEM_ADMIN') || !session.permissions.includes(HOME_THEME_MANAGE_PERMISSION)) return <SystemAccessDenied />;
  return <HomeThemeSettingsPage />;
}
