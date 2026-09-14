import BillingRefundPage from '@/features/billing-admin/BillingRefundPage';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BillingRefundPage key={id} operationId={id}/>;}
