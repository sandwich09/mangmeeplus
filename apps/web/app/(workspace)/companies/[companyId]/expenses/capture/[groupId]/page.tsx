import { fetchServerSession } from '@/common/auth/server-session';
import { ExpenseCaptureGroupPage } from '@/features/expenses/capture/ExpenseCaptureGroupPage';

export default async function ExpenseCaptureGroupRoute({
  params,
}: {
  params: Promise<{ companyId: string; groupId: string }>;
}) {
  const { companyId, groupId } = await params;
  // The payer question needs to know who is asking, and the tax review is `expense.review` only;
  // the server re-checks both, so this only decides what the page offers, never what it may do.
  const session = await fetchServerSession(companyId);
  return (
    <ExpenseCaptureGroupPage
      companyId={companyId}
      groupId={groupId}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
    />
  );
}
