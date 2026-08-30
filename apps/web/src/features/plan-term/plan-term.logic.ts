import type { PlanTermNotice } from './plan-term.api';

export const PLAN_TERM_RENEW_PHONE = '098-256-5628';

export type PlanTermView = 'none' | 'warning-banner' | 'renewal-page';

/**
 * What the shell does with the term notice (P29 §4B, §5):
 * - the yellow warning is OWNER-only — staff are not shown the company's package dates at all;
 * - an ended term sends everyone to the renewal page, because no data operation is possible;
 * - no term row (`null`) is a grandfathered company with unlimited use, not an expiry.
 */
export function planTermView(notice: PlanTermNotice | null, alreadyOnRenewalPage = false): PlanTermView {
  if (!notice) return 'none';
  if (notice.derivedState === 'EXPIRED') return alreadyOnRenewalPage ? 'none' : 'renewal-page';
  if (notice.derivedState === 'WARNING' && notice.isOwner) return 'warning-banner';
  return 'none';
}

/** `/companies/<id>/…` → the company's renewal page; null when the path names no company. */
export function renewalPathFor(pathname: string): string | null {
  const companyId = /^\/companies\/([^/]+)/.exec(pathname)?.[1];
  return companyId ? `/companies/${companyId}/renew` : null;
}

export function isRenewalPath(pathname: string): boolean {
  return /^\/companies\/[^/]+\/renew\/?$/.test(pathname);
}
