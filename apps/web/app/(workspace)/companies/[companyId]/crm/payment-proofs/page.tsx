import { PaymentProofReviewPage } from '@/features/crm-inbox/PaymentProofReviewPage';

export default async function CrmPaymentProofsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <PaymentProofReviewPage companyId={companyId} />;
}
