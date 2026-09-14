import BillingAdjustmentsPage from '@/features/billing/BillingAdjustmentsPage';
export default async function Page({params}:{params:Promise<{id:string;invoiceId:string}>}) {
  const {id,invoiceId}=await params;return <BillingAdjustmentsPage key={`${id}:${invoiceId}`} companyId={id} invoiceId={invoiceId} admin/>;
}
