import { UserGuidePage } from '@/features/user-guide/UserGuidePage';
import { buildGettingStartedGuide } from '@/features/user-guide/getting-started-guide.content';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function GettingStartedUserGuideRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  return <UserGuidePage guide={buildGettingStartedGuide(companyId, session?.permissions ?? [], session ? session.entitledFeatureKeys ?? null : [])} />;
}
