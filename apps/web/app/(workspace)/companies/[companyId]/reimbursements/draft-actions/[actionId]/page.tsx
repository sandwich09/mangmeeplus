import { ReimbursementDraftActionPage } from '@/features/reimbursements/ReimbursementDraftActionPage';

export default async function ReimbursementDraftPreviewRoute({ params }: {
  params: Promise<{ companyId: string; actionId: string }>;
}) {
  const { companyId, actionId } = await params;
  return <ReimbursementDraftActionPage companyId={companyId} actionId={actionId} />;
}
