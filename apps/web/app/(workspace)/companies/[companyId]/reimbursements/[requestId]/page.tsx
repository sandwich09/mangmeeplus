import { ReimbursementJourneyPage } from '@/features/reimbursements/ReimbursementJourneyPage';
import { fetchServerSession } from '@/common/auth/server-session';

/** One claim's journey page: the target of LINE, notification, and hub-row links (spec §11, §12). */
export default async function ReimbursementPage({ params, searchParams }: {
  params: Promise<{ companyId: string; requestId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
      // `?pay=1`: the finance queue's quick pay on a phone, where the payment form is never a dialog.
      payOnOpen={(searchParams ? await searchParams : {})['pay'] === '1'}
    />
  );
}
