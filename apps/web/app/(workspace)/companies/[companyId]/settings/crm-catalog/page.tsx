import { ProductsPageClient } from '@/features/inventory/InventoryPages';
import { redirect } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function CrmCatalogPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/settings/crm-catalog`)}`);
  return <ProductsPageClient companyId={companyId} basePath={`/companies/${companyId}/settings/crm-catalog`} canManage={session.permissions.includes('inventory.product.manage')} />;
}
