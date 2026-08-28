'use client';

import { useId } from 'react';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { useBranchFilter } from './WorkspaceScope';
import { branchDisplayName } from './branch-scope-label.logic';

/**
 * Which branch a NEW record belongs to, given the workspace's read filter. A company with exactly one
 * branch never has to answer this — the single branch is the answer. With several, the all-branches
 * filter is a reporting view and deliberately does NOT become a source branch, so this returns ''
 * and the create panel stays disabled until a real branch is picked. Owner report 2026-08-28: that
 * disabled panel used to explain nothing, which read as a broken upload button.
 */
export function transactionCreateBranchId(
  branches: ReadonlyArray<{ id: string }>,
  filterBranchId: string | undefined,
): string {
  if (branches.some((branch) => branch.id === filterBranchId)) return filterBranchId!;
  return branches.length === 1 ? branches[0]!.id : '';
}

export function useTransactionCreateBranchId(): string {
  const filter = useBranchFilter();
  return transactionCreateBranchId(filter?.branches ?? [], filter?.branchId);
}

/** The all-branches read filter must never become a transaction's source branch. */
export function TransactionBranchField({ value, invalid = false }: { value: string; invalid?: boolean }) {
  const id = useId();
  const locale = useWorkspaceLocale();
  const filter = useBranchFilter();
  return (
    <div className="mb-4 space-y-2">
      <label htmlFor={id} className="block text-base font-semibold text-gray-900">
        {t('transaction.source_branch', locale)} <span aria-hidden="true">*</span>
      </label>
      {/* Tagged so a blocked create panel can send the person straight here — see the notice in
          ExpensesPages: a disabled fieldset cannot explain itself. */}
      <select id={id} data-transaction-branch-select="" required value={value} onChange={(event) => filter?.setBranchId(event.target.value)}
        disabled={!filter?.branches.length || filter.locked}
        aria-describedby={`${id}-help`}
        aria-invalid={invalid || undefined}
        className={`min-h-12 w-full rounded-xl border bg-white px-3 py-2 text-base text-gray-900 focus-visible:outline-none focus-visible:ring-2 sm:max-w-md ${
          invalid ? 'border-error-500 ring-1 ring-error-200 focus-visible:ring-error-500' : 'border-gray-300 focus-visible:ring-brand-500'
        }`}>
        <option value="">{t('transaction.source_branch_required', locale)}</option>
        {filter?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branchDisplayName(branch, locale)}</option>)}
      </select>
      <p id={`${id}-help`} className={invalid ? 'text-sm font-medium text-error-600' : 'text-sm text-gray-600'}>{t('transaction.source_branch_help', locale)}</p>
      {filter?.scopeFailed && <button type="button" onClick={filter.reloadScope} className="min-h-11 font-semibold text-brand-700">{t('shell.scope.load_failed', locale)}</button>}
    </div>
  );
}
