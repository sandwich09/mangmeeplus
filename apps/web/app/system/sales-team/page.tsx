import SalesTeamPage from '@/features/sales-console/SalesTeamPage';

// The /system layout already fails closed for everyone who is not a SYSTEM_ADMIN (billing
// delegates only reach /system/billing), so the PII scope needs no second gate here.
export default function SystemSalesTeamRoute() {
  return <SalesTeamPage scope="admin" />;
}
