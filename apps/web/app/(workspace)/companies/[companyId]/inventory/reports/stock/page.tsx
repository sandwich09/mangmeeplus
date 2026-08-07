import { StockReportPageClient } from '@/features/inventory/InventoryPages';

export default async function StockReportPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <StockReportPageClient companyId={companyId} />;
}
