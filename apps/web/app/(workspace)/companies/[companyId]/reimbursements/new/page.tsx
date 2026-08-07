import { ReimbursementCreatePage } from '@/features/reimbursements/ReimbursementCreatePage';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function NewReimbursementPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  // The hub hides the entry point without this permission; the URL is reachable regardless, and
  // the create endpoint requires it, so the page says so instead of 403-ing after a filled form.
  return (
    <ReimbursementCreatePage
      companyId={companyId}
      canCreate={(session?.permissions ?? []).includes('reimbursement.create')}
    />
  );
}
