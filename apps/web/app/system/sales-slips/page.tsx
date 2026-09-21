import SalesSlipsPage from '@/features/sales-console/SalesSlipsPage';

// `/system` already fails closed for everyone who is not a SYSTEM_ADMIN, and hands each page the
// bare column — so this route only supplies the container every other /system page brings.
export default function SystemSalesSlipsRoute() {
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><SalesSlipsPage /></main>;
}
