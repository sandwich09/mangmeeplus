import { ProductCreatePageClient } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';

export default async function NewProductPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const permissions = session?.permissions ?? [];
  const canManage = canSeeRoute('/inventory/products/new', permissions) && permissions.includes('inventory.product.manage');
  if (!canManage) return <ForbiddenState />;
  return <ProductCreatePageClient companyId={companyId} canManage />;
}
