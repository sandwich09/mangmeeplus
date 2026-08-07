import { IndividualPermissionsPrototypePage } from '@/features/employee-access/IndividualPermissionsPrototypePage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function SettingsAccessOverviewPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  // Layout already bounced signed-out visitors; permissions gate which controls are editable.
  const session = await fetchServerSession(companyId);
  return <IndividualPermissionsPrototypePage companyId={companyId} viewerPermissions={session?.permissions ?? []} />;
}
