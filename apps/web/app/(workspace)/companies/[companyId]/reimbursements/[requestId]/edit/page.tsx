import { ReimbursementCreatePage } from '@/features/reimbursements/ReimbursementCreatePage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function EditReimbursementPage({
  params,
}: {
  params: Promise<{ companyId: string; requestId: string }>;
}) {
  const { companyId, requestId } = await params;
  const session = await fetchServerSession(companyId);
  return (
    <ReimbursementCreatePage
      companyId={companyId}
      canPrepareForOthers={(session?.permissions ?? []).includes('reimbursement.finance_review')}
      canEditEmployees={(session?.permissions ?? []).includes('access.employee.update')}
      userId={session?.userId ?? ''}
      requestId={requestId}
      canCreate={false}
      canUpdate={(session?.permissions ?? []).some(permission => ['reimbursement.update_own_draft', 'reimbursement.finance_review'].includes(permission))}
    />
  );
}
