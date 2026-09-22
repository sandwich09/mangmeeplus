import SalesDealFormPage from '@/features/sales-console/SalesDealFormPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';

// The layout already proved the session; this read only decides whether the approve/reject buttons
// are rendered at all. The API refuses either way (D2: a เซลล์ may not approve, even their own).
export default async function NewSalesDealRoute({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const result = await fetchServerSessionResult();
  const { companyId } = await searchParams;
  return <SalesDealFormPage companyId={companyId} canApprove={result.status === 'signed_in' && result.session.permissions.includes('sales.deal.approve')} />;
}
