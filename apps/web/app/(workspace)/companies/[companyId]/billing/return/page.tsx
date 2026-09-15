import BillingPage from '@/features/billing/BillingPage';
export default async function CompanyBillingReturnRoute({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ attempt?: string | string[] }> }) {
  const { companyId } = await params;
  const { attempt } = await searchParams;
  const attemptId = typeof attempt === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attempt) ? attempt : null;
  return <BillingPage key={`${companyId}:${attemptId}`} companyId={companyId} returning returnAttemptId={attemptId} />;
}
