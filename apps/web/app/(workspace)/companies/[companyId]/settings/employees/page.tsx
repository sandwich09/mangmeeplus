import { AddEmployeePrototypePage } from '@/features/employee-access/AddEmployeePrototypePage';
import { fetchServerSession } from '@/common/auth/server-session';

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
  return <AddEmployeePrototypePage companyId={companyId} editEmployeeId={edit} viewerPermissions={session?.permissions ?? []} />;
}
