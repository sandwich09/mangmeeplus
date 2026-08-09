import { MovementFormPageClient } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';

export default async function StockCountPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session?.permissions.includes('inventory.stock_count.create')) return <ForbiddenState />;
  return <MovementFormPageClient companyId={companyId} defaultAction="COUNT" allowedActions={['COUNT']} />;
}
