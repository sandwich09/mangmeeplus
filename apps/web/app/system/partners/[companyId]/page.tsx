import PartnerDetailPage from '@/features/system-partners/PartnerDetailPage';

export default async function SystemPartnerDetailRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <PartnerDetailPage companyId={companyId} />;
}
