import { PlannedModulePage } from '@/features/web-core-workspace/components/PlannedModulePage';

export default async function SalesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <PlannedModulePage companyId={companyId} moduleName="การขาย" />;
}
