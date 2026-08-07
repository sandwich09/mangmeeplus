import type { BranchRecord } from '../models/branch.model';

const VALID_CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;
const VALID_TAX_CODE_PATTERN = /^[0-9]{5}$/;

export function validateBranchCode(code: string): string | null {
  if (!code || !VALID_CODE_PATTERN.test(code)) {
    return 'Branch code must be 1-20 uppercase alphanumeric characters, underscores, or hyphens.';
  }
  return null;
}

export function validateTaxBranchCode(code: string): string | null {
  if (!VALID_TAX_CODE_PATTERN.test(code)) {
    return 'Tax branch code must be 5 digits.';
  }
  return null;
}

export function canArchiveBranch(branch: BranchRecord, activeHeadOfficeCount: number): string | null {
  if (branch.type === 'HEAD_OFFICE' && activeHeadOfficeCount <= 1) {
    return 'Cannot archive the only active head office branch.';
  }
  return null;
}

export function resolveBranchIds(
  mode: 'ALL_BRANCHES' | 'SELECTED_BRANCHES' | 'DEFAULT_BRANCH_ONLY',
  selectedBranchIds: string[],
  defaultBranchId: string | undefined,
): string[] | undefined {
  switch (mode) {
    case 'ALL_BRANCHES':
      return undefined; // undefined means unrestricted
    case 'SELECTED_BRANCHES':
      return selectedBranchIds;
    case 'DEFAULT_BRANCH_ONLY':
      return defaultBranchId ? [defaultBranchId] : [];
  }
}

// Enforcement helpers for RequestContext.scopes.branchIds (10D).
// Rule: undefined scope = unrestricted; records with branchId null are company-central and visible to everyone.

export type BranchScopes = { branchIds?: string[] };

/** True when the given branch (or null = company-central) is readable/writable under the scope. */
export function isBranchInScope(scopes: BranchScopes, branchId: string | null | undefined): boolean {
  if (!scopes.branchIds) return true;
  if (branchId === null || branchId === undefined) return true;
  return scopes.branchIds.includes(branchId);
}

/**
 * Prisma where fragment for branch-scoped reads.
 * Returns {} when unrestricted; otherwise matches scoped branches plus company-central (null) rows.
 */
export function branchScopeWhere(scopes: BranchScopes): Record<string, unknown> {
  if (!scopes.branchIds) return {};
  return { OR: [{ branchId: { in: scopes.branchIds } }, { branchId: null }] };
}

/**
 * Branch a new record should be tagged with.
 * Explicit input wins (caller must have asserted scope). Branch-restricted creators fall back to
 * scopes.branchIds[0] — the permission resolver orders the membership default branch first, so
 * this is "default branch when in scope, else first scoped branch". Unrestricted creators default
 * to company-central (null).
 */
export function resolveCreateBranchId(
  scopes: BranchScopes,
  explicitBranchId: string | null | undefined,
): string | null {
  if (explicitBranchId) return explicitBranchId;
  if (!scopes.branchIds || scopes.branchIds.length === 0) return null;
  return scopes.branchIds[0]!;
}
