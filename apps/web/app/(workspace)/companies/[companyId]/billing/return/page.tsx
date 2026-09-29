import { COMPANY_PROFILE_SETTINGS_PATH } from '@watchdog-bms/contracts';
import { fetchServerSession } from '@/common/auth/server-session';
import BillingPage from '@/features/billing/BillingPage';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';
export default async function CompanyBillingReturnRoute({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ attempt?: string | string[] }> }) {
  const { companyId } = await params;
  const { attempt } = await searchParams;
  const attemptId = typeof attempt === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attempt) ? attempt : null;
  const session = await fetchServerSession(companyId);
  return <BillingPage key={`${companyId}:${attemptId}`} companyId={companyId} returning returnAttemptId={attemptId}
    canOpenProfile={canSeeRoute(COMPANY_PROFILE_SETTINGS_PATH, session?.permissions ?? [])} />;
}
