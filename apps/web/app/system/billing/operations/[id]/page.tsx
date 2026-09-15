import Link from 'next/link';
import BillingOperationPanel from '@/features/billing-admin/BillingOperationPanel';
export default async function Page({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<{batch?:string|string[]}> }) {
  const value=(await searchParams).batch,batch=typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)?value:null;
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8"><h1 className="text-2xl font-bold">คำสั่งตรวจสอบการชำระเงิน</h1>
    <Link href="/system/billing" className="inline-block underline">กลับหน้าดูแลการชำระเงิน</Link>
    {batch&&<Link href={`/system/billing/batches/${batch}`} className="inline-block min-h-11 rounded-lg border p-3">กลับงานตรวจหลายบริษัท</Link>}
    <BillingOperationPanel operationId={(await params).id} /></main>;
}
