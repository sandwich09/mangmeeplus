// ─── Tax reviewer role enforcement ────────────────────────────────────────────
//
// GAP-04: the company's `CompanyTaxProfile.taxReviewerRole` gates who may perform
// mark-filed / resolve-review-issue. OWNER always overrides. When the profile row
// is missing or the field is null, the effective reviewer role falls back to
// 'ACCOUNTANT' (matching the controller default).

/** Effective reviewer role: the configured value, or 'ACCOUNTANT' when unset. */
export function effectiveTaxReviewerRole(reviewerRole: string | null | undefined): string {
  const trimmed = reviewerRole?.trim();
  return trimmed ? trimmed : 'ACCOUNTANT';
}

/**
 * Returns undefined when the caller may act as tax reviewer (OWNER present, or the
 * caller holds the effective reviewer role); otherwise a message naming the role.
 */
export function taxReviewerViolation(roles: readonly string[], reviewerRole: string | null | undefined): string | undefined {
  const effective = effectiveTaxReviewerRole(reviewerRole);
  if (roles.includes('OWNER')) return undefined;
  if (roles.includes(effective)) return undefined;
  return `Tax reviewer role '${effective}' is required to perform this action`;
}
