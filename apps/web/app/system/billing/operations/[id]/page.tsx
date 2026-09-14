import Link from 'next/link';
import BillingOperationPanel from '@/features/billing-admin/BillingOperationPanel';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8"><h1 className="text-2xl font-bold">คำสั่งตรวจสอบการชำระเงิน</h1>
    <Link href="/system/billing" className="inline-block underline">กลับหน้าดูแลการชำระเงิน</Link>
    <BillingOperationPanel operationId={(await params).id} /></main>;
}
