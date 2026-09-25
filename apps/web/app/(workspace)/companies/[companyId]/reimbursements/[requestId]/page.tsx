import { ReimbursementJourneyPage } from '@/features/reimbursements/ReimbursementJourneyPage';
import { fetchServerSession } from '@/common/auth/server-session';

/** One claim's journey page: the target of LINE, notification, and hub-row links (spec §11, §12). */
export default async function ReimbursementPage({ params }: {
  params: Promise<{ companyId: string; requestId: string }>;
}) {
  const { companyId, requestId } = await params;
  const session = await fetchServerSession(companyId);
  return (
    <ReimbursementJourneyPage
      companyId={companyId}
      requestId={requestId}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      roles={session?.roles ?? []}
    />
  );
}
