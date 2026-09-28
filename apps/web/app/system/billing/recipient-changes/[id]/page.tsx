import BillingRecipientAdminPage from '@/features/billing-admin/BillingRecipientAdminPage';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BillingRecipientAdminPage key={id} operationId={id}/>;}
