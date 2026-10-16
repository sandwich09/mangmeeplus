// Single source of truth for every branch-scope label (spec R1): a label states what the query did,
// never a constant typed into a component.
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { statusOf } from '@/common/i18n/error-message.logic';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { BranchOption } from './workspace-scope.api';

/** The shape `BranchFilterProvider` publishes, narrowed to what a label needs. */
export type BranchScopeContext = {
  branches: readonly BranchOption[];
  /** '' = all branches in scope */
  branchId: string;
  locked: boolean;
};

export function branchDisplayName(branch: BranchOption, locale: SupportedLocale): string {
  return `${branch.name}${branch.type === 'HEAD_OFFICE' ? t('branch.suffix.head_office', locale) : ''}`;
}

/**
 * `null` while the context is unresolved, after a failed lookup, or when there is no branch to name —
 * a missing label is honest, a confident wrong one is not (spec R3).
 */
export function branchScopeLabel(context: BranchScopeContext | null, locale: SupportedLocale): string | null {
  if (!context || context.branches.length === 0) return null;
  const selected = context.locked ? context.branches[0] : context.branches.find((b) => b.id === context.branchId);
  return selected ? branchDisplayName(selected, locale) : t('branch.scope.all', locale);
}

/**
 * A 403 caused by the branch the UI asked for (spec R9), which the provider self-heals. A 403 with
 * no branch selected is an ordinary permission error and keeps the page's own inline treatment.
 */
export function isBranchScope403(error: unknown, selectedBranchId: string | undefined): boolean {
  return Boolean(selectedBranchId) && statusOf(error) === 403;
}

/** Ignore legacy shop-only keys: a shared device must not carry another person's choice. */
export function branchStorageKeys(companyId: string, userId: string) {
  return {
    filter: `watchdog.branchFilter.${companyId}.${userId}`,
    lastChosen: `watchdog.lastChosenBranch.${companyId}.${userId}`,
  };
}
