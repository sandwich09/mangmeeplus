import { SubstituteReceiptSettingsPage } from '@/features/expenses/SubstituteReceiptSettingsPage';

export default async function SubstituteReceiptPolicyPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return <SubstituteReceiptSettingsPage companyId={companyId} />;
}
