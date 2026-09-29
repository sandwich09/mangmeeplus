import SalesEventsPage from '@/features/sales-console/SalesEventsPage';
import { fetchServerSessionResult } from '@/common/auth/server-session';

// Every sales role opens this page: a เซลล์ to show the QR of a batch they were given, a หัวหน้าทีม
// (and SYSTEM_ADMIN) to set batches up. `sales.event.manage` only decides whether "สร้าง" is offered;
// the API refuses the command itself to anyone without it.
export default async function SalesEventsRoute() {
  const result = await fetchServerSessionResult();
  return <SalesEventsPage canManage={result.status === 'signed_in' && result.session.permissions.includes('sales.event.manage')} />;
}
