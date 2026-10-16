import { fetchServerSession } from '@/common/auth/server-session';
import { WithholdingPage } from '@/features/tax/WithholdingPage';
export default async function WithholdingRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <WithholdingPage companyId={companyId} permissions={session?.permissions ?? []} />;
}
