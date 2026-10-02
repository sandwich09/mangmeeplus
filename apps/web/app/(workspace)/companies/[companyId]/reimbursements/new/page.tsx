import { ReimbursementCreatePage } from '@/features/reimbursements/ReimbursementCreatePage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function NewReimbursementPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  // Capture appendix §13.4: "เตรียมใบเบิก" carries the source it was pressed on. The page asks the
  // server whether that expense may be claimed and says so either way; the id alone grants nothing.
  const query = searchParams ? await searchParams : {};
  const expenseId = typeof query['expenseId'] === 'string' ? query['expenseId'] : undefined;
  // The hub hides the entry point without this permission; the URL is reachable regardless, and
  // the create endpoint requires it, so the page says so instead of 403-ing after a filled form.
  return (
    <ReimbursementCreatePage
      companyId={companyId}
      canPrepareForOthers={(session?.permissions ?? []).includes('reimbursement.finance_review')}
      canEditEmployees={(session?.permissions ?? []).includes('access.employee.update')}
      userId={session?.userId ?? ''}
      canCreate={(session?.permissions ?? []).includes('reimbursement.create')}
      {...(expenseId ? { sourceExpenseId: expenseId } : {})}
    />
  );
}
