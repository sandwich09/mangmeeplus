import BillingProviderScansPage from '@/features/billing-admin/BillingProviderScansPage';
export default async function Page({params}:{params:Promise<{id:string}>}) { return <BillingProviderScansPage scanId={(await params).id}/>; }
