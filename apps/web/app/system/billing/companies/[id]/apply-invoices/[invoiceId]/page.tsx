import BillingApplyInvoicesPage from '@/features/billing-admin/BillingApplyInvoicesPage';
export default async function Page({params}:{params:Promise<{id:string;invoiceId:string}>}) {const {id,invoiceId}=await params;return <BillingApplyInvoicesPage companyId={id} invoiceId={invoiceId}/>;}
