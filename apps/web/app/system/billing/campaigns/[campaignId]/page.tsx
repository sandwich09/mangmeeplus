import BillingCampaignDetailPage from '@/features/billing-admin/BillingCampaignDetailPage';
export default async function Page({ params }: { params: Promise<{ campaignId: string }> }) {
  return <BillingCampaignDetailPage campaignId={(await params).campaignId} />;
}
