import BillingRefundPage from '@/features/billing-admin/BillingRefundPage';
export default async function Page({params}:{params:Promise<{id:string;invoiceId:string}>}){const {id,invoiceId}=await params;return <BillingRefundPage key={`${id}:${invoiceId}`} companyId={id} invoiceId={invoiceId}/>;}
