import { LocationsPageClient } from '@/features/inventory/InventoryPages';

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <LocationsPageClient companyId={companyId} />;
}
