import { ScanPageClient } from '@/features/inventory/InventoryPages';

export default async function ScanPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <ScanPageClient companyId={companyId} />;
}
