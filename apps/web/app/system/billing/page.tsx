import BillingAdminPage from '@/features/billing-admin/BillingAdminPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';
export default async function Page() {
  const result = await fetchServerSessionResult();
  return <BillingAdminPage userId={result.status === 'signed_in' ? result.session.userId : ''} />;
}
