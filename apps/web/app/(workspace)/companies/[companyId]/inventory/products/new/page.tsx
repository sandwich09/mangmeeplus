import { ProductCreatePageClient } from '@/features/inventory/InventoryPages';

export default async function NewProductPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <ProductCreatePageClient companyId={companyId} />;
}
