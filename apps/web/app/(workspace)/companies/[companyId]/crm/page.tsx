import { CrmWorkspacePage } from '@/features/crm/CrmPages';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function CrmPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <CrmWorkspacePage companyId={companyId} permissions={session?.permissions ?? []} />;
}
