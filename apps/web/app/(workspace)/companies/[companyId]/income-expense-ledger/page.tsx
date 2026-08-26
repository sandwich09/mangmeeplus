import { fetchServerSession } from '@/common/auth/server-session';
import { IncomeExpenseLedgerPage } from '@/features/accounting-documents/IncomeExpenseLedgerPage';
import { requireRoutePermission } from '@/features/web-core-workspace/route-permission-guard';

export default async function LedgerPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const forbidden = requireRoutePermission(session, '/income-expense-ledger');
  if (forbidden) return forbidden;
  return <IncomeExpenseLedgerPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
