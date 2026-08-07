import { ProductsPageClient } from '@/features/inventory/InventoryPages';

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const { companyId } = await params;
  await searchParams;
  return <ProductsPageClient companyId={companyId} />;
}
