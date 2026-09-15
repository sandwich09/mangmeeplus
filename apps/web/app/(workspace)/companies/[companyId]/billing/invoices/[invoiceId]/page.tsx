import BillingAdjustmentsPage from '@/features/billing/BillingAdjustmentsPage';
export default async function Page({params}:{params:Promise<{companyId:string;invoiceId:string}>}) {
  const {companyId,invoiceId}=await params;return <BillingAdjustmentsPage key={`${companyId}:${invoiceId}`} companyId={companyId} invoiceId={invoiceId}/>;
}
