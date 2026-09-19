import { ExpenseCaptureListPage } from '@/features/expenses/capture/ExpenseCaptureListPage';

export default async function ExpenseCaptureListRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <ExpenseCaptureListPage companyId={companyId} />;
}
