import BillingConfigurationPage from '@/features/billing-admin/BillingConfigurationPage';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <BillingConfigurationPage operationId={(await params).id} />;
}
