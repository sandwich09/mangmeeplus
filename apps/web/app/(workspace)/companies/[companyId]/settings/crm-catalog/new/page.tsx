import { ProductCreatePageClient } from '@/features/inventory/InventoryPages';
import { redirect } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function CrmCatalogCreatePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/companies/${companyId}/settings/crm-catalog/new`)}`);
  if (!session.permissions.includes('inventory.product.manage')) redirect(`/companies/${companyId}/settings/crm-catalog`);
  return <ProductCreatePageClient companyId={companyId} basePath={`/companies/${companyId}/settings/crm-catalog`} canManage />;
}
