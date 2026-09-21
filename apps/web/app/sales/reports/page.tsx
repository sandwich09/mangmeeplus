import { redirect } from 'next/navigation';
import SalesReportsPage from '@/features/sales-console/SalesReportsPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { SALES_HOME_PATH } from '@/common/auth/session-gate.logic';

// `sales.report.read` is what the endpoint checks, so the page fails closed on the same grant
// rather than letting a เซลล์ without it open an empty screen (same shape as `/sales/team`).
export default async function SalesReportsRoute() {
  const result = await fetchServerSessionResult();
  if (result.status !== 'signed_in' || !result.session.permissions.includes('sales.report.read')) {
    redirect(SALES_HOME_PATH);
  }
  return <SalesReportsPage />;
}
