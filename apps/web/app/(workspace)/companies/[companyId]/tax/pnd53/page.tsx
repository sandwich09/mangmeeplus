import { fetchServerSession } from '@/common/auth/server-session';
import { Pnd53Page } from '@/features/tax/Pnd53Page';

export default async function Pnd53Route({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <Pnd53Page companyId={companyId} permissions={session?.permissions ?? []} />;
}
