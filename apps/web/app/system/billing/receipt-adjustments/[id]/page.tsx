import BillingReceiptAdjustmentsPage from '@/features/billing-admin/BillingReceiptAdjustmentsPage';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BillingReceiptAdjustmentsPage key={id} operationId={id}/>;}
