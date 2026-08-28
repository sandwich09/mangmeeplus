import BranchSettingsPage from '@/features/branch-settings/BranchSettingsPage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function SettingsBranchesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <BranchSettingsPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
