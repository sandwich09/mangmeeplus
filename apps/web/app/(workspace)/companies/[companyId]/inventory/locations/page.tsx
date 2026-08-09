import { LocationsPageClient } from '@/features/inventory/InventoryPages';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const permissions = session?.permissions ?? [];
  if (!permissions.includes('inventory.location.read')) return <ForbiddenState />;
  return <LocationsPageClient companyId={companyId} canManage={permissions.includes('inventory.location.manage')} canManageLabels={permissions.includes('inventory.label.manage')} />;
}
