import CompanyTermExpiredPage from '@/features/plan-term/CompanyTermExpiredPage';

export default async function CompanyRenewRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <CompanyTermExpiredPage key={companyId} companyId={companyId} />;
}
