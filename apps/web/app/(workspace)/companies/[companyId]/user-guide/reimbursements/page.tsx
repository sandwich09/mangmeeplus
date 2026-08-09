import { UserGuidePage } from '@/features/user-guide/UserGuidePage';
import { buildReimbursementGuide } from '@/features/user-guide/reimbursement-guide.content';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ReimbursementUserGuideRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  // The manual itself is open to everyone; the session only decides which shortcut buttons
  // are offered, so nobody is sent to a tab their permissions would hide.
  const session = await fetchServerSession(companyId);
  return (
    <UserGuidePage
      guide={buildReimbursementGuide(companyId, session?.permissions ?? [], session?.roles ?? [])}
    />
  );
}
