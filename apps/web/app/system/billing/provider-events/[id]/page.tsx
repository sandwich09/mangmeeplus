import BillingProviderEventsPage from '@/features/billing-admin/BillingProviderEventsPage';
export default async function Page({params}:{params:Promise<{id:string}>}) { return <BillingProviderEventsPage eventId={(await params).id}/>; }
