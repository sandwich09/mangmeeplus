import { ExpenseCaptureGroupPage } from '@/features/expenses/capture/ExpenseCaptureGroupPage';

export default async function ExpenseCaptureGroupRoute({
  params,
}: {
  params: Promise<{ companyId: string; groupId: string }>;
}) {
  const { companyId, groupId } = await params;
  return <ExpenseCaptureGroupPage companyId={companyId} groupId={groupId} />;
}
