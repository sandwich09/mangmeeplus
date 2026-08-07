import { MovementsPageClient } from '@/features/inventory/InventoryPages';

export default async function MovementsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <MovementsPageClient companyId={companyId} />;
}
