import { redirect } from 'next/navigation';
import SalesTeamPage from '@/features/sales-console/SalesTeamPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { SALES_HOME_PATH } from '@/common/auth/session-gate.logic';

// `sales.team.manage` is the หัวหน้า's grant; a plain เซลล์ has no team page to open.
export default async function SalesTeamRoute() {
  const result = await fetchServerSessionResult();
  if (result.status !== 'signed_in' || !result.session.permissions.includes('sales.team.manage')) {
    redirect(SALES_HOME_PATH);
  }
  return <SalesTeamPage scope="lead" />;
}
