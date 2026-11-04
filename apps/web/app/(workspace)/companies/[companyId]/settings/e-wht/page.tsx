import { redirect } from 'next/navigation';
import { EWhtSettingsPage } from '@/features/expenses/EWhtSettingsPage';
import { fetchServerSession } from '@/common/auth/server-session';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function ExpenseEWhtSettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (session?.freeExpenseDrafts) redirect(`/companies/${companyId}/expenses`);
  const forbidden = requireRoutePermission(session, '/settings/e-wht');
  if (forbidden) return forbidden;
  return <EWhtSettingsPage companyId={companyId} />;
}
