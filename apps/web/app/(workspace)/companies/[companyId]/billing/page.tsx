import { COMPANY_PROFILE_SETTINGS_PATH } from '@watchdog-bms/contracts';
import { fetchServerSession } from '@/common/auth/server-session';
import BillingPage from '@/features/billing/BillingPage';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';
export default async function CompanyBillingRoute({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ collection?: string | string[] }> }) {
  const { companyId } = await params;
  const { collection } = await searchParams;
  const collectionId = typeof collection === 'string' && /^[a-f0-9-]{36}$/i.test(collection) ? collection : undefined;
  const previewHref = process.env.NODE_ENV === 'development' && process.env.APP_ENV === 'local' ? `/companies/${encodeURIComponent(companyId)}/billing/preview` : undefined;
  const session = await fetchServerSession(companyId);
  return <BillingPage key={companyId} companyId={companyId} collectionId={collectionId} previewHref={previewHref}
    canOpenProfile={canSeeRoute(COMPANY_PROFILE_SETTINGS_PATH, session?.permissions ?? [])} />;
}
