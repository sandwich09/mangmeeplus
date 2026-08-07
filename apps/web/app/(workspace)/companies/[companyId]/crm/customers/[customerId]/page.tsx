import { Customer360Page } from '@/features/crm/Customer360Page';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function CrmCustomer360({
  params,
}: {
  params: Promise<{ companyId: string; customerId: string }>;
}) {
  const { companyId, customerId } = await params;
  const session = await fetchServerSession(companyId);
  return <Customer360Page companyId={companyId} customerId={customerId} permissions={session?.permissions ?? []} />;
}
