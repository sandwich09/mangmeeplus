import { ReimbursementPayoutAccountPage } from '@/features/reimbursements/ReimbursementPayoutAccountPage';
import { fetchServerSession } from '@/common/auth/server-session';

/** "บัญชีรับเงินคืนของฉัน": the signed-in member's own default payout account. */
export default async function ReimbursementPayoutAccountRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  // The API requires the same permission; the page says so instead of failing on save.
  return <ReimbursementPayoutAccountPage companyId={companyId} canManage={(session?.permissions ?? []).includes('reimbursement.create')} />;
}
