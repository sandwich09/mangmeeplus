import { LedgerReportsPage } from '@/features/ledger/LedgerReportsPage';

export default async function JournalPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <LedgerReportsPage companyId={companyId} />;
}
