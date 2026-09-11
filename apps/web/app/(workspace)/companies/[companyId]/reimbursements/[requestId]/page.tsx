import { redirect } from 'next/navigation';

/** Preserve direct links sent by LINE; the permission-checked detail lives in the hub drawer. */
export default async function ReimbursementPage({ params }: {
  params: Promise<{ companyId: string; requestId: string }>;
}) {
  const { companyId, requestId } = await params;
  redirect(`/companies/${encodeURIComponent(companyId)}/reimbursements?focus=${encodeURIComponent(requestId)}`);
}
