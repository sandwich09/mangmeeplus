import SalesTeamPage from '@/features/sales-console/SalesTeamPage';

// The /system layout already fails closed for everyone who is not a SYSTEM_ADMIN (billing
// delegates only reach /system/billing), so the PII scope needs no second gate here.
// `/system` hands each page the bare column, so every other /system page brings this container.
// Without it the team list sat flush against the left edge of a phone.
export default function SystemSalesTeamRoute() {
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><SalesTeamPage scope="admin" /></main>;
}
