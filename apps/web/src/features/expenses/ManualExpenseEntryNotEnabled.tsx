'use client';

import Link from 'next/link';
import { MangmeeCard } from '@/common/components/mangmee';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { btnClass, ghostClass } from './ExpensesUi';
import { canAccessExpenseTab, type ExpenseCapabilities } from './expenses.model';

/**
 * What the manual expense page shows to a holder of `expense.create` while the company does not
 * show that page (manual-expense-web-entry-flag spec §7.1, §8). A screen state, not a refusal: the
 * server answered 200 and the API would still take the save, so nothing here speaks of permission.
 * Only the ways on that this reader may open are offered. With none, the business owner is the one to
 * ask: the reader lacks the rights to upload and to open the list, and only the owner can grant every
 * right. The owner, who already holds every right the package allows, is sent to the team instead:
 * only the platform's admin switches this page on for a shop.
 */
export function ManualExpenseEntryNotEnabled({ companyId, caps, readerIsOwner = false }: { companyId: string; caps: ExpenseCapabilities; readerIsOwner?: boolean }) {
  const locale = useWorkspaceLocale();
  const canUpload = canAccessExpenseTab('upload', caps);
  const canList = canAccessExpenseTab('list', caps);
  return (
    <MangmeeCard className="space-y-4 p-5">
      <h2 className="text-base font-semibold text-gray-900">{t('expenses.manual_entry_not_enabled', locale)}</h2>
      {canUpload || canList ? (
        <div className="flex flex-wrap gap-2">
          {canUpload && <Link className={btnClass} href={`/companies/${companyId}/expenses/upload`}>{t('expenses.tab_upload', locale)}</Link>}
          {canList && <Link className={ghostClass} href={`/companies/${companyId}/expenses`}>{t('expenses.manual_entry_go_list', locale)}</Link>}
        </div>
      ) : (
        <p className="text-sm text-gray-600">{t(readerIsOwner ? 'expenses.manual_entry_contact_team' : 'expenses.manual_entry_contact_owner', locale)}</p>
      )}
    </MangmeeCard>
  );
}
