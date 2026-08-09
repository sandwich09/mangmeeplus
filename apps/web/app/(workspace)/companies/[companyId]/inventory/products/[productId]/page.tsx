import { ProductDetailPageClient } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; productId: string }>;
}) {
  const { companyId, productId } = await params;
  const session = await fetchServerSession(companyId);
  const permissions = session?.permissions ?? [];
  if (!canSeeRoute(`/inventory/products/${productId}`, permissions) || !permissions.includes('inventory.product.read')) return <ForbiddenState />;
  return <ProductDetailPageClient
    companyId={companyId}
    productId={productId}
    canManage={permissions.includes('inventory.product.manage')}
    canManageLabels={permissions.includes('inventory.label.manage')}
    canReadBalances={permissions.includes('inventory.report.read')}
    canReadMovements={permissions.includes('inventory.movement.read')}
  />;
}
