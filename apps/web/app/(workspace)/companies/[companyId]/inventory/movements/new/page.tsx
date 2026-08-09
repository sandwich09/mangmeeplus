import { MovementFormPageClient, type MovementAction } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';

export default async function NewMovementPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const permissions = session?.permissions ?? [];
  const allowedActions: MovementAction[] = [
    ...(permissions.includes('inventory.movement.create') ? ['STOCK_IN', 'STOCK_OUT', 'TRANSFER'] as const : []),
    ...(permissions.includes('inventory.stock_count.create') ? ['COUNT'] as const : []),
    ...(permissions.includes('inventory.movement.adjust') ? ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] as const : []),
  ];
  if (allowedActions.length === 0) return <ForbiddenState />;
  return <MovementFormPageClient companyId={companyId} allowedActions={allowedActions} />;
}
