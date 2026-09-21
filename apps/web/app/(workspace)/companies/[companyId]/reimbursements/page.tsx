import { redirect } from 'next/navigation';
import { ReimbursementsHubPage } from '@/features/reimbursements/ReimbursementsPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ReimbursementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId } = await params;
  // Links sent before the journey page existed (`?focus=`, `?tab=…&focus=`) open that claim's page.
  const focus = (searchParams ? await searchParams : {})['focus'];
  if (typeof focus === 'string' && focus) {
    redirect(`/companies/${encodeURIComponent(companyId)}/reimbursements/${encodeURIComponent(focus)}`);
  }
  const session = await fetchServerSession(companyId);
  return (
    <ReimbursementsHubPage
      companyId={companyId}
      userId={session?.userId ?? ''}
      permissions={session?.permissions ?? []}
      roles={session?.roles ?? []}
    />
  );
}
