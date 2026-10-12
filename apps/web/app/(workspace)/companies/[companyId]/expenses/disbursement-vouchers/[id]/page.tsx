import { fetchServerSession } from '@/common/auth/server-session';
import { DisbursementVoucherDocumentPage } from '@/features/expenses/disbursement-vouchers/DisbursementVoucherDocumentPage';

export default async function DisbursementVoucherPage({ params }: { params: Promise<{ companyId: string; id: string }> }) {
  const { companyId, id } = await params;
  const session = await fetchServerSession(companyId);
  return <DisbursementVoucherDocumentPage companyId={companyId} id={id} permissions={session?.permissions ?? []} viewerUserId={session?.userId ?? null} />;
}
