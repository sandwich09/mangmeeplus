import { LineOaSettingsPage } from '@/features/crm-inbox/LineOaSettingsPage';

export default async function LineOaSettingsRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <LineOaSettingsPage companyId={companyId} />;
}
