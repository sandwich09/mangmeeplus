import { THAI_SYSTEM_ROLE_NAMES, isBillingCustomerRecoveryPath } from '@watchdog-bms/contracts';
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
export function planTermView(notice: PlanTermNotice | null, alreadyOnRenewalPage = false, freeExpenseDrafts = false): PlanTermView {
  if (!notice) return 'none';
  if (notice.derivedState === 'EXPIRED' && notice.freeExpenseDrafts === true && freeExpenseDrafts) return 'none';
  if (notice.derivedState === 'EXPIRED') return alreadyOnRenewalPage ? 'none' : 'renewal-page';
  if (notice.derivedState === 'WARNING' && (notice.canManagePlan ?? notice.isOwner)) return 'warning-banner';
  return 'none';
}

/** Free source-draft access is an explicit exception to the expired-term workspace lock. */
export function shouldUseLockedWorkspace(notice: PlanTermNotice | null, sessionFreeExpenseDrafts = false): boolean {
  return notice?.derivedState === 'EXPIRED' && !(notice.freeExpenseDrafts === true && sessionFreeExpenseDrafts);
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
    || pathname === `${base}/account`
    || isRenewalPath(pathname) || isBillingCustomerRecoveryPath(pathname, companyId);
}

/** An API build without `lockReason` means the P29 case it always described: a term that ran out. */
export function planLockReason(source: { lockReason?: PlanLockReason } | null | undefined): PlanLockReason {
  return source?.lockReason ?? 'trial_ended';
}

/** Who can act when the reader cannot: the one clause both `staff` lines are built from. */
const STAFF_WHO = `ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจเลือกแพ็กเกจ`;

/**
 * The one wording table for a locked shop (spec R2/R10), read by the shell banner, the renewal
 * page and the package page. A shop that never had a package is told it has none to renew.
 * `staff` is for a member who cannot buy (review 2026-09-29): it says who can, since a hint with
 * no button under it was a dead end — and never "พักการใช้งาน" for a shop that is only unpaid.
 * `staffNext` is the same line without what is the matter, for the renewal page: its title has
 * already said that, and the same sentence stood twice on one screen.
 */
export const PLAN_LOCK_COPY: Record<PlanLockReason, { banner: string; title: string; body: string; staff: string; staffNext: string }> = {
  no_package: {
    banner: 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ · เลือกแพ็กเกจเพื่อเริ่มใช้งาน',
    title: 'ยังไม่มีแพ็กเกจ',
    body: 'เลือกแพ็กเกจเพื่อเริ่มใช้งาน ข้อมูลร้านและการตั้งค่าของคุณอยู่ครบ',
    staff: `ร้านนี้ยังไม่มีแพ็กเกจ ${STAFF_WHO}เพื่อเริ่มใช้งาน`,
    staffNext: `${STAFF_WHO}เพื่อเริ่มใช้งาน`,
  },
  trial_ended: {
    banner: 'แพ็กเกจของร้านหมดอายุแล้ว · เลือกแพ็กเกจเพื่อใช้งานต่อ',
    title: 'แพ็กเกจหมดอายุแล้ว',
    body: 'เลือกแพ็กเกจแล้วใช้งานต่อได้ทันที ข้อมูลยังอยู่ครบ',
    staff: `แพ็กเกจของร้านหมดอายุแล้ว ${STAFF_WHO}เพื่อใช้งานต่อ`,
    staffNext: `${STAFF_WHO}เพื่อใช้งานต่อ`,
  },
};

/** The single next step for both reasons: there is nothing to renew any more, only to choose. */
export const PLAN_LOCK_CTA = 'เลือกแพ็กเกจ';

/**
 * RV30 fallback: the package page reloads a shell that is still locked after a purchase applied.
 * Once per attempt ACROSS page loads (`unlock-reload:<attemptId>` in sessionStorage), so a notice
 * that keeps lagging cannot reload the page forever. Storage that throws or is missing answers
 * false: no reload beats a reload loop, and the shell's own focus/visibility re-reads still unlock it.
 */
export function claimUnlockReload(storage: () => Pick<Storage, 'getItem' | 'setItem'>, attemptId: string): boolean {
  try {
    const store = storage(), key = `unlock-reload:${attemptId}`;
    if (store.getItem(key)) return false;
    store.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

/** D3: the warning is one row; no stored collapse state. */
export function planTermReminderText(daysLeft: number): string {
  return daysLeft < 0 ? 'แพ็กเกจหมดอายุแล้ว' : daysLeft === 0 ? 'แพ็กเกจหมดอายุวันนี้' : `เหลืออีก ${daysLeft} วัน`;
}

export function cardRenewalRunning(status: Pick<import('@watchdog-bms/contracts').BillingStatus, 'renewalMode' | 'subscriptionState' | 'cancelAtPeriodEnd'>): boolean {
  return status.renewalMode === 'CARD_AUTO' && status.subscriptionState === 'active' && !status.cancelAtPeriodEnd;
}
