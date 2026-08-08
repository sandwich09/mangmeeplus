import { ProductsPageClient } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const { companyId } = await params;
  await searchParams;
  const session = await fetchServerSession(companyId);
  const permissions = session?.permissions ?? [];
  if (!canSeeRoute('/inventory/products', permissions) || !permissions.includes('inventory.product.read')) return <ForbiddenState />;
  return <ProductsPageClient companyId={companyId} canManage={permissions.includes('inventory.product.manage')} />;
}
