import PartnerDetailPage from '@/features/system-partners/PartnerDetailPage';
import { fetchServerSession } from '@/common/auth/server-session';

/** The one value in a search param that could be more than one: a repeated key arrives as array. */
const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

export default async function SystemPartnerDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  // line-support-request-spec-th §2.2.4: the "เปิดหน้าร้าน" link from the support inbox carries the
  // request being answered (and the asker's hash fragment, §3), so the message box can reply to the
  // PERSON waiting rather than only to the shop's owners. Read here rather than with
  // `useSearchParams`, which would need a Suspense boundary around a page that is otherwise static.
  searchParams: Promise<{ support?: string | string[]; asker?: string | string[] }>;
}) {
  const [{ companyId }, query, session] = await Promise.all([params, searchParams, fetchServerSession()]);
  return (
    <PartnerDetailPage
      key={companyId}
      companyId={companyId}
      canManageMembers={session?.permissions.includes('system.partner_member.manage') ?? false}
      canEditIdentity={session?.permissions.includes('system.identity_reconciliation.resolve') ?? false}
      supportRequestId={first(query.support)}
      supportAskerRef={first(query.asker)}
    />
  );
}
