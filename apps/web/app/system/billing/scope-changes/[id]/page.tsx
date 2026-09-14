import BillingScopesPage from '@/features/billing-admin/BillingScopesPage';
export default async function Page({params}:{params:Promise<{id:string}>}) { const {id}=await params; return <BillingScopesPage operationId={id}/>; }
