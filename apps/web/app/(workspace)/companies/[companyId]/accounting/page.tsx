import { AccountingHubPage } from '@/features/accounting-documents/AccountingPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function AccountingPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <AccountingHubPage companyId={companyId} permissions={session?.permissions ?? []} viewerUserId={session?.userId} />;
}
