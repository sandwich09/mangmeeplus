import { fetchServerSession } from '@/common/auth/server-session';
import { DisbursementVoucherDraftPage } from '@/features/expenses/disbursement-vouchers/DisbursementVoucherDraftPage';

export default async function DisbursementVoucherNewPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ draft?: string | string[]; expenseId?: string | string[] }>;
}) {
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  const session = await fetchServerSession(companyId);
  return <DisbursementVoucherDraftPage companyId={companyId} permissions={session?.permissions ?? []}
    viewerUserId={session?.userId ?? null}
    entryOpen={session?.disbursementVoucherWebEntry === true} draftId={typeof query.draft === 'string' ? query.draft : undefined}
    expenseId={typeof query.expenseId === 'string' ? query.expenseId : undefined} />;
}
