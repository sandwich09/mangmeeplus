'use client';

import { useId } from 'react';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useBranchFilter } from './WorkspaceScope';
import { branchDisplayName } from './branch-scope-label.logic';

export function useTransactionCreateBranchId(): string {
  const filter = useBranchFilter();
  if (filter?.branches.some((branch) => branch.id === filter.branchId)) return filter.branchId;
  return filter?.branches.length === 1 ? filter.branches[0]!.id : '';
}

/** The all-branches read filter must never become a transaction's source branch. */
export function TransactionBranchField({ value }: { value: string }) {
  const id = useId();
  const locale = useWorkspaceLocale();
  const filter = useBranchFilter();
  return (
    <div className="mb-4 space-y-2">
      <label htmlFor={id} className="block text-base font-semibold text-gray-900">
        {t('transaction.source_branch', locale)} <span aria-hidden="true">*</span>
      </label>
      <select id={id} required value={value} onChange={(event) => filter?.setBranchId(event.target.value)}
        disabled={!filter?.branches.length || filter.locked}
        aria-describedby={`${id}-help`}
        className="min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:max-w-md">
        <option value="">{t('transaction.source_branch_required', locale)}</option>
        {filter?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branchDisplayName(branch, locale)}</option>)}
      </select>
      <p id={`${id}-help`} className="text-sm text-gray-600">{t('transaction.source_branch_help', locale)}</p>
      {filter?.scopeFailed && <button type="button" onClick={filter.reloadScope} className="min-h-11 font-semibold text-brand-700">{t('shell.scope.load_failed', locale)}</button>}
    </div>
  );
}
