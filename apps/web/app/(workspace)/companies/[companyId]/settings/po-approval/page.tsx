import { PoApprovalSettingsPage } from '@/features/employee-access/PoApprovalSettingsPage';

export default async function PoApprovalPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <PoApprovalSettingsPage companyId={companyId} />;
}
