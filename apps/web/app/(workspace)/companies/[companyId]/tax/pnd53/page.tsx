import { redirect } from 'next/navigation';
export default async function Pnd53Route({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  redirect(`/companies/${companyId}/tax/withholding`);
}
