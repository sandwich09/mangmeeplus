import BillingPlanAdjustmentsPage from '@/features/billing-admin/BillingPlanAdjustmentsPage';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BillingPlanAdjustmentsPage key={id} operationId={id}/>;}
