import { ProductDetailPageClient } from '@/features/inventory/InventoryPages';
import { redirect } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function CrmCatalogDetailPage({ params }: { params: Promise<{ companyId: string; productId: string }> }) {
  const { companyId, productId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/settings/crm-catalog/${productId}`)}`);
  return <ProductDetailPageClient companyId={companyId} productId={productId} canManage={session.permissions.includes('inventory.product.manage')} catalogMode />;
}
