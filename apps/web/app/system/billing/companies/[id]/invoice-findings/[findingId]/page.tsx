import BillingInvoiceFindingPage from '@/features/billing-admin/BillingInvoiceFindingPage';
export default async function Page({params}:{params:Promise<{id:string;findingId:string}>}) {const {id,findingId}=await params;return <BillingInvoiceFindingPage companyId={id} findingId={findingId}/>;}
