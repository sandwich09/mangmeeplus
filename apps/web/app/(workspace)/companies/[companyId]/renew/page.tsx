import { COMPANY_PROFILE_SETTINGS_PATH } from '@watchdog-bms/contracts';
import { fetchServerSession } from '@/common/auth/server-session';
import CompanyTermExpiredPage from '@/features/plan-term/CompanyTermExpiredPage';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';

export default async function CompanyRenewRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <CompanyTermExpiredPage key={companyId} companyId={companyId}
    canOpenProfile={canSeeRoute(COMPANY_PROFILE_SETTINGS_PATH, session?.permissions ?? [])} />;
}
