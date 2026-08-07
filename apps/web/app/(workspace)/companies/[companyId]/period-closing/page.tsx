import { PlannedModulePage } from '@/features/web-core-workspace/components/PlannedModulePage';

export default async function PeriodClosingPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <PlannedModulePage companyId={companyId} moduleName="ปิดงวด" />;
}
