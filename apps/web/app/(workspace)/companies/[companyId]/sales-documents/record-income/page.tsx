import { RecordIncomePage } from '@/features/accounting-documents/RecordIncomePage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function RecordIncomeRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <RecordIncomePage companyId={companyId} permissions={session?.permissions ?? []} />;
}
