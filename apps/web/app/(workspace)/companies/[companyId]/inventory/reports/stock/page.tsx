import { StockReportPageClient } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';

export default async function StockReportPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session?.permissions.includes('inventory.report.read')) return <ForbiddenState />;
  return <StockReportPageClient companyId={companyId} />;
}
