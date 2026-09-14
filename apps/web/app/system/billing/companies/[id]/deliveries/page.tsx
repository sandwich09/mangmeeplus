import BillingDeliveryPanel from '@/features/billing-admin/BillingDeliveryPanel';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BillingDeliveryPanel companyId={id}/>;}
