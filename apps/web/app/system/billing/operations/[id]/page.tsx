import BillingOperationPanel from '@/features/billing-admin/BillingOperationPanel';

const uuid = (value: string | string[] | undefined) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ? value : null;

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string | string[]; issue?: string | string[]; queue?: string | string[]; cursor?: string | string[] }>;
}) {
  const query = await searchParams, issue = uuid(query.issue), batch = uuid(query.batch);
  // Navigation context only. Detail reads/actions still use the authorized operation endpoint.
  const filter = new URLSearchParams();
  if (typeof query.queue === 'string' && ['UNASSIGNED', 'OVERDUE'].includes(query.queue)) filter.set('queue', query.queue);
  const cursor = uuid(query.cursor);
  if (cursor) filter.set('cursor', cursor);
  const returnHref = issue ? `/system/billing/issues/${issue}${filter.size ? `?${filter}` : ''}` : batch ? `/system/billing/batches/${batch}` : undefined;
  return <main className="mx-auto max-w-7xl space-y-6 break-words p-4 sm:p-8">
    <header className="space-y-2"><p className="text-sm text-gray-500">การชำระเงิน</p><h1 className="text-2xl font-bold text-gray-900">รายละเอียดการดำเนินการ</h1><p className="text-base text-gray-600">ผลตรวจและขั้นตอนถัดไปของรายการนี้</p></header>
    <BillingOperationPanel operationId={(await params).id} returnHref={returnHref} returnLabel={issue ? 'กลับไปหน้าปัญหา' : batch ? 'กลับงานตรวจหลายบริษัท' : undefined} />
  </main>;
}
