import { fetchServerSession } from '@/common/auth/server-session';
import { canOpenDisbursementVoucherWeb } from '@/features/expenses/disbursement-voucher-entry.logic';
import { DisbursementVoucherListPage } from '@/features/expenses/disbursement-vouchers/DisbursementVoucherListPage';

export default async function DisbursementVouchersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <DisbursementVoucherListPage companyId={companyId} permissions={session?.permissions ?? []}
    entryOpen={canOpenDisbursementVoucherWeb(session, companyId)} />;
}
