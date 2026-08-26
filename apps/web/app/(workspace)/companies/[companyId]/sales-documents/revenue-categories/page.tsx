import { RevenueCategoryPanel } from '@/features/accounting-documents/RevenueCategoryPanel';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';

export default async function RevenueCategoriesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session?.permissions.includes('accounting.revenue_category.manage')) return <ForbiddenState />;
  return <RevenueCategoryPanel companyId={companyId} />;
}
