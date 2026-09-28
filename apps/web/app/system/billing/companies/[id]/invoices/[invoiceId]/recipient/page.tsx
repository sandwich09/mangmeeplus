import BillingRecipientAdminPage from '@/features/billing-admin/BillingRecipientAdminPage';
export default async function Page({params}:{params:Promise<{id:string;invoiceId:string}>}){const {id,invoiceId}=await params;return <BillingRecipientAdminPage key={`${id}:${invoiceId}`} companyId={id} invoiceId={invoiceId}/>;}
