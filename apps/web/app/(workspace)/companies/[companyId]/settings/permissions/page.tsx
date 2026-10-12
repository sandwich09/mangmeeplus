import { PermissionMatrixPrototypePage } from '@/features/employee-access/PermissionMatrixPrototypePage';
import { canOpenDisbursementVoucherWeb } from '@/features/expenses/disbursement-voucher-entry.logic';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function SettingsPermissionsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/permissions');
  if (forbidden) return forbidden;
  return <PermissionMatrixPrototypePage disbursementEntryOpen={canOpenDisbursementVoucherWeb(session, companyId)} companyId={companyId} viewerPermissions={session?.permissions ?? []} />;
}
