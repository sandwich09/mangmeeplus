import { ProductDetailPageClient } from '@/features/inventory/InventoryPages';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; productId: string }>;
}) {
  const { companyId, productId } = await params;
  return <ProductDetailPageClient companyId={companyId} productId={productId} />;
}
