import SalesEventBatchPage from '@/features/sales-console/SalesEventBatchPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';

export default async function SalesEventBatchRoute({ params }: { params: Promise<{ batchId: string }> }) {
  const [{ batchId }, result] = await Promise.all([params, fetchServerSessionResult()]);
  return <SalesEventBatchPage batchId={batchId}
    canManageEvents={result.status === 'signed_in' && result.session.permissions.includes('sales.event.manage')} />;
}
