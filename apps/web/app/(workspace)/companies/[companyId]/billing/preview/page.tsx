import { notFound } from 'next/navigation';
import { fetchServerSession } from '@/common/auth/server-session';
import BillingPreviewPage from '@/features/billing/BillingPreviewPage';

export const dynamic = 'force-dynamic';
export default async function LocalBillingPreview({ params }: { params: Promise<{ companyId: string }> }) {
  if (process.env.NODE_ENV !== 'development' || process.env.APP_ENV !== 'local') notFound();
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  if (!session?.roles.includes('OWNER')) notFound();
  return <BillingPreviewPage companyId={companyId} />;
}
