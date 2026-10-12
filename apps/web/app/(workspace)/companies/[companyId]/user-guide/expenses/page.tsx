import { UserGuidePage } from '@/features/user-guide/UserGuidePage';
import { buildExpensesGuide } from '@/features/user-guide/expenses-guide.content';
import { withDisbursementVoucherGuide } from '@/features/user-guide/disbursement-voucher-guide.content';
import { withManualEntryNotEnabled } from '@/features/user-guide/expenses-guide-manual-entry';
import { manualExpenseWebEntryShown } from '@/features/expenses/manual-expense-entry.logic';
import { fetchServerSession } from '@/common/auth/server-session';

export default async function ExpensesUserGuideRoute({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  // Content for all, shortcut buttons by permission — same rule as the other manuals.
  const session = await fetchServerSession(companyId);
  const guide = buildExpensesGuide(companyId, session?.permissions ?? []);
  // A company that does not show the manual-entry menu: the shortcut goes and the section says so.
  // Applied to the result — the guide file itself is pinned by hash for the LINE answer pack.
  return <UserGuidePage guide={withDisbursementVoucherGuide(manualExpenseWebEntryShown(session) ? guide : withManualEntryNotEnabled(guide), companyId, session)} />;
}
