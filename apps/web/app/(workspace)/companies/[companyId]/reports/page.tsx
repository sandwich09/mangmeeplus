import { ReportsWorkspacePage } from '@/features/reports/ReportsWorkspacePage';

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <ReportsWorkspacePage companyId={companyId} />;
}
