import BillingConfigurationImpactPage from '@/features/billing-admin/BillingConfigurationImpactPage';
export default async function Page({params}:{params:Promise<{id:string}>}) {
  return <BillingConfigurationImpactPage operationId={(await params).id}/>;
}
