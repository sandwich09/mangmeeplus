import BillingCheckoutPage from '@/features/billing-admin/BillingCheckoutPage';
export default async function Page({params}:{params:Promise<{id:string;attemptId:string}>}){const p=await params;return <BillingCheckoutPage key={JSON.stringify(p)} companyId={p.id} attemptId={p.attemptId}/>;}
