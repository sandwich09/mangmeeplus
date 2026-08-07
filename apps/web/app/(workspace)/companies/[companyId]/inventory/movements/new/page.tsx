import { MovementFormPageClient } from '@/features/inventory/InventoryPages';

export default async function NewMovementPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <MovementFormPageClient companyId={companyId} />;
}
