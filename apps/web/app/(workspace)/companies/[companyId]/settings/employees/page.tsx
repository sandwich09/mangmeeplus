import { AddEmployeePrototypePage } from '@/features/employee-access/AddEmployeePrototypePage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function SettingsEmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { companyId } = await params;
  const { edit } = await searchParams;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/settings/employees');
  if (forbidden) return forbidden;
  return (
    <AddEmployeePrototypePage companyId={companyId} editEmployeeId={edit} viewerUserId={session?.userId} />
  );
}
