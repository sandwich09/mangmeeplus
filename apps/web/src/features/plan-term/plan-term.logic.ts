import type { PlanTermNotice } from './plan-term.api';

export const PLAN_TERM_RENEW_PHONE = '098-256-5628';
export const PLAN_TERM_CONTACT_EMAIL = 'contact@mangmeeplus.com';

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

// ---- Sidebar card (Owner 2026-08-31: the warning lives in the sidebar, user-collapsible) ----

export type WarningBucket = '7' | '3' | '1';

/** Which ladder step the remaining time falls in — mirrors the 7/3/1 notification ladder. */
export function warningBucket(daysLeft: number): WarningBucket {
  if (daysLeft > 3) return '7';
  if (daysLeft > 1) return '3';
  return '1';
}

/**
 * Collapsed only while the stored bucket matches the current one: collapsing at 7 days stays
 * collapsed through that window, then the card re-opens by itself at 3 days and again at 1 day —
 * three reminders at most, never a nag on every visit.
 */
export function cardCollapsed(storedBucket: string | null, current: WarningBucket): boolean {
  return storedBucket === current;
}

/** Fill of the time-left bar, out of the 7-day warning window. Clamped so a sliver stays visible. */
export function warningProgressPercent(daysLeft: number): number {
  return Math.min(100, Math.max(6, Math.round((daysLeft / 7) * 100)));
}
