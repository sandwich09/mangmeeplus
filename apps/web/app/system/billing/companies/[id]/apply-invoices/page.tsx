import BillingApplyInvoicesPage from '@/features/billing-admin/BillingApplyInvoicesPage';
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <BillingApplyInvoicesPage companyId={id}/>;}
