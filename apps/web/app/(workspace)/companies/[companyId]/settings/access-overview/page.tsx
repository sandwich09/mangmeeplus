import { IndividualPermissionsPrototypePage } from '@/features/employee-access/IndividualPermissionsPrototypePage';
import { canOpenDisbursementVoucherWeb } from '@/features/expenses/disbursement-voucher-entry.logic';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function SettingsAccessOverviewPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/access-overview');
  if (forbidden) return forbidden;
  return <IndividualPermissionsPrototypePage disbursementEntryOpen={canOpenDisbursementVoucherWeb(session, companyId)} companyId={companyId} viewerPermissions={session?.permissions ?? []} viewerUserId={session?.userId} viewerBranchIds={session?.scopes?.branchIds} />;
}
