import ExecutiveReportPage from '@/features/executive-reports/ExecutiveReportPage';
export default async function Page({ params }: { params: Promise<{ targetCompanyId: string }> }) {
  const { targetCompanyId } = await params;
  return <ExecutiveReportPage section="detail" targetCompanyId={targetCompanyId} />;
}
