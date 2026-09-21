import SalesDealFormPage from '@/features/sales-console/SalesDealFormPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';

export default async function SalesDealRoute({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, result] = await Promise.all([params, fetchServerSessionResult()]);
  return <SalesDealFormPage dealId={id} canApprove={result.status === 'signed_in' && result.session.permissions.includes('sales.deal.approve')} />;
}
