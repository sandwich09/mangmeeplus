import { PermissionMatrixPrototypePage } from '@/features/employee-access/PermissionMatrixPrototypePage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function SettingsPermissionsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  // Layout already bounced signed-out visitors; permissions gate which controls are editable
  // (same contract as the sibling access-overview page).
  const session = await fetchServerSession(companyId);
  return <PermissionMatrixPrototypePage companyId={companyId} viewerPermissions={session?.permissions ?? []} />;
}
