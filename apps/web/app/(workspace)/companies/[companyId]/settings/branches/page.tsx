import BranchSettingsPage from '@/features/branch-settings/BranchSettingsPage';

export default async function SettingsBranchesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <BranchSettingsPage companyId={companyId} />;
}
