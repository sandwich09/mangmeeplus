'use client';

import { useId } from 'react';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
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
      {/* Not a <label htmlFor>: ThemedSelect's trigger is a <summary>, which `for` cannot bind to.
          The name reaches assistive tech through aria-label instead. */}
      <div className="block text-base font-semibold text-gray-900">
        {t('transaction.source_branch', locale)} <span aria-hidden="true">*</span>
      </div>
      {/* Owner report 2026-08-29 (UAT): this was a bare native <select>, so it drew the OS popup on
          the upload page while every other field on it is themed. ThemedSelect is the app's drop-in
          replacement — same value/onChange/<option> shape, own themed list.
          Tagged so a blocked create panel can send the person straight here — see the notice in
          ExpensesPages: a disabled fieldset cannot explain itself.
          `!` on the invalid border on purpose: `.mangmee-input` is unlayered, so a plain layered
          utility loses to its own border no matter the source order (same reason the CSS needs
          `.mangmee-input-icon-end`). */}
      <div data-transaction-branch-select="" className="sm:max-w-md">
        <ThemedSelect id={id} required value={value} onChange={(event) => filter?.setBranchId(event.target.value)}
          disabled={!filter?.branches.length || filter.locked}
          aria-label={t('transaction.source_branch', locale)}
          aria-describedby={`${id}-help`}
          aria-invalid={invalid || undefined}
          className={invalid ? '!border-error-500 ring-1 ring-error-200' : ''}>
          <option value="">{t('transaction.source_branch_required', locale)}</option>
          {filter?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branchDisplayName(branch, locale)}</option>)}
        </ThemedSelect>
      </div>
      <p id={`${id}-help`} className={invalid ? 'text-sm font-medium text-error-600' : 'text-sm text-gray-600'}>{t('transaction.source_branch_help', locale)}</p>
      {filter?.scopeFailed && <button type="button" onClick={filter.reloadScope} className="min-h-11 font-semibold text-brand-700">{t('shell.scope.load_failed', locale)}</button>}
    </div>
  );
}
