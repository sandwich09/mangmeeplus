import { DiscountPolicyPage } from '@/features/employee-access/DiscountPolicyPage';

export default async function DiscountPolicyRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <DiscountPolicyPage companyId={companyId} />;
}
