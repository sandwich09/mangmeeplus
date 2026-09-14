import BillingAdminPage from '@/features/billing-admin/BillingAdminPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const result = await fetchServerSessionResult();
  return <BillingAdminPage companyId={(await params).id} userId={result.status === 'signed_in' ? result.session.userId : ''} />;
}
