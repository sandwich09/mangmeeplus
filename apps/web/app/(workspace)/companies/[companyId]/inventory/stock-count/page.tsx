import { MovementFormPageClient } from '@/features/inventory/InventoryPages';

export default async function StockCountPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <MovementFormPageClient companyId={companyId} defaultAction="COUNT" />;
}
