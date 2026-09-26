import { isBillingCustomerRecoveryPath } from '@watchdog-bms/contracts';
import type { PlanLockReason, PlanTermNotice } from './plan-term.api';

export const PLAN_TERM_RENEW_PHONE = '098-256-5628';
export const PLAN_TERM_CONTACT_EMAIL = 'contact@mangmeeplus.com';

export type PlanTermView = 'none' | 'warning-banner' | 'renewal-page';

/**
 * What the shell does with the term notice (P29 §4B, §5):
 * - the yellow warning is for members whose permissions allow them to manage the package;
 * - an ended term sends everyone to the renewal page, because no data operation is possible;
 * - no term row (`null`) is a grandfathered company with unlimited use, not an expiry.
 */
export function planTermView(notice: PlanTermNotice | null, alreadyOnRenewalPage = false): PlanTermView {
  if (!notice) return 'none';
  if (notice.derivedState === 'EXPIRED') return alreadyOnRenewalPage ? 'none' : 'renewal-page';
  if (notice.derivedState === 'WARNING' && (notice.canManagePlan ?? notice.isOwner)) return 'warning-banner';
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

// ---- Locked shell (Owner 2026-09-20: no trial, so a shop is locked until it buys a package) ----

/**
 * Every path a locked shop may open (spec §12 เว็บลูกค้า): the settings hub and the owner's own
 * profile, the package page with its return/invoice pages, and the renewal page itself. One list
 * for the two gates that must agree — the sidebar the locked shell renders and the redirect in
 * `PlanTermBanner` — so a menu can never offer a page the guard bounces.
 */
export function isLockedShellPath(pathname: string, companyId: string): boolean {
  const base = `/companies/${encodeURIComponent(companyId)}`;
  return pathname === `${base}/settings` || pathname === `${base}/settings/profile`
    || isRenewalPath(pathname) || isBillingCustomerRecoveryPath(pathname, companyId);
}

/** An API build without `lockReason` means the P29 case it always described: a term that ran out. */
export function planLockReason(source: { lockReason?: PlanLockReason } | null | undefined): PlanLockReason {
  return source?.lockReason ?? 'trial_ended';
}

/**
 * The one wording table for a locked shop (spec R2/R10), read by the shell banner, the renewal
 * page and the package page. A shop that never had a package is told it has none to renew.
 */
export const PLAN_LOCK_COPY: Record<PlanLockReason, { banner: string; title: string; body: string }> = {
  no_package: {
    banner: 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ · เลือกแพ็กเกจเพื่อเริ่มใช้งาน',
    title: 'ยังไม่มีแพ็กเกจ',
    body: 'เลือกแพ็กเกจเพื่อเริ่มใช้งาน ข้อมูลร้านและการตั้งค่าของคุณอยู่ครบ',
  },
  trial_ended: {
    banner: 'แพ็กเกจของร้านหมดอายุแล้ว · เลือกแพ็กเกจเพื่อใช้งานต่อ',
    title: 'แพ็กเกจหมดอายุแล้ว',
    body: 'ข้อมูลทั้งหมดยังอยู่ครบ ไม่มีอะไรหาย เมื่อเลือกแพ็กเกจแล้วใช้งานต่อได้ทันที',
  },
};

/** The single next step for both reasons: there is nothing to renew any more, only to choose. */
export const PLAN_LOCK_CTA = 'เลือกแพ็กเกจ';

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
