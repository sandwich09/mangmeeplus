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
      userId={session?.userId ?? ''}
      requestId={requestId}
      canCreate={false}
      canUpdate={(session?.permissions ?? []).includes('reimbursement.update_own_draft')}
    />
  );
}
