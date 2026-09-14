import BillingDeliveryPanel from '@/features/billing-admin/BillingDeliveryPanel';
import {notFound} from 'next/navigation';
export default async function Page({params}:{params:Promise<{id:string;deliveryId:string}>}){
  const {id,deliveryId}=await params;
  // The route parameter retains the encoded colon in an email:<outboxId> reference.
  let reference:string;try{reference=decodeURIComponent(deliveryId);}catch{notFound();}
  return <BillingDeliveryPanel companyId={id} deliveryId={reference}/>;
}
