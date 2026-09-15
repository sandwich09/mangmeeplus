import BillingBatchPage from '@/features/billing-admin/BillingBatchPage';
export default async function Page({params}:{params:Promise<{id:string}>}){return <BillingBatchPage batchId={(await params).id}/>;}
