import SalesDemoLinksPage from '@/features/sales-console/SalesDemoLinksPage';

// Owner 2026-11-09: the admin manages demo links from their own menu. `/system` hands each page the
// bare column, so this route brings the same container as /system/sales-team.
export default function SystemDemoLinksRoute() {
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><SalesDemoLinksPage /></main>;
}
