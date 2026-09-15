import BillingSettlementPage from '@/features/billing-admin/BillingSettlementPage';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BillingSettlementPage runId={id}/>;}
