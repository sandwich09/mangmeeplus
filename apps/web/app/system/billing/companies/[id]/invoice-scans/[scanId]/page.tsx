import BillingProviderScansPage from '@/features/billing-admin/BillingProviderScansPage';
export default async function Page({params}:{params:Promise<{id:string;scanId:string}>}) {const {id,scanId}=await params;return <BillingProviderScansPage companyId={id} scanId={scanId}/>;}
