import BillingConfigurationChecksPage from '@/features/billing-admin/BillingConfigurationChecksPage';
export default async function Page({params}:{params:Promise<{id:string}>}){return <BillingConfigurationChecksPage checkId={(await params).id}/>;}
