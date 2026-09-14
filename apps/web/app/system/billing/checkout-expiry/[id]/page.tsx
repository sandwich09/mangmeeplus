import BillingCheckoutPage from '@/features/billing-admin/BillingCheckoutPage';
export default async function Page({params}:{params:Promise<{id:string}>}){const p=await params;return <BillingCheckoutPage key={JSON.stringify(p)} operationId={p.id}/>;}
