import { MovementsPageClient } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';

export default async function MovementsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const permissions = session?.permissions ?? [];
  if (!permissions.includes('inventory.movement.read')) return <ForbiddenState />;
  const canCreate = ['inventory.movement.create', 'inventory.stock_count.create', 'inventory.movement.adjust']
    .some((permission) => permissions.includes(permission));
  return <MovementsPageClient companyId={companyId} canCreate={canCreate} />;
}
