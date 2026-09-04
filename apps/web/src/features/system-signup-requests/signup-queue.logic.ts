// Pure presentation rules for the auto-register review queue (P10 Flow B, spec §4C/§4D).
// Kept out of the page so the state/hint/filter decisions stay testable under `pnpm test`.

import type { AdminSignupQueueItemDto } from '@watchdog-bms/contracts';

/** Chip tone; the page owns the Tailwind classes for each. */
export type ChipTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export type Chip = { label: string; tone: ChipTone };

/** Number of idle days after approval before the queue nudges the admin to phone the applicant. */
const IDLE_WARNING_DAYS = 3;

const STATE_CHIP: Record<string, Chip> = {
  PENDING_REVIEW: { label: 'รออนุมัติ', tone: 'info' },
  EMAIL_PENDING: { label: 'ส่งเมลแล้ว รอตั้งรหัส', tone: 'neutral' },
  EMAIL_FAILED: { label: 'เมลตีกลับ', tone: 'danger' },
  EXPIRED: { label: 'ลิงก์หมดอายุ', tone: 'warning' },
  REJECTED: { label: 'ปฏิเสธแล้ว', tone: 'neutral' },
  PROVISIONING_FAILED: { label: 'เปิดร้านไม่สำเร็จ กดอนุมัติเพื่อลองใหม่', tone: 'danger' },
  COMPLETED: { label: 'เปิดใช้งานแล้ว', tone: 'success' },
};

/** P10-L: the source decides what approving DOES, so the page has to be able to ask. */
export function isLineSignup(item: AdminSignupQueueItemDto): boolean {
  return item.source === 'line-oa';
}

/** `state` is a plain string in the contract, so an unknown value must still render. */
export function signupStateChip(state: string): Chip {
  return STATE_CHIP[state] ?? { label: state, tone: 'neutral' };
}

/**
 * Idle-since-approval nudge (spec §4D ③). Shown from 3 days so the admin can call the
 * phone number on the form before the link expires.
 */
export function signupIdleChip(item: AdminSignupQueueItemDto): Chip | null {
  const days = item.daysSinceApproval;
  if (days === undefined || days < IDLE_WARNING_DAYS) return null;
  return { label: `ยังไม่เริ่มใช้งาน ${days} วัน`, tone: 'warning' };
}

/**
 * Dedupe/deliverability hints (spec §4C). These are advisory only — the real attach decision
 * happens on the claim page, so the copy says what will happen, never asks the admin to choose.
 */
export function signupHintChips(item: AdminSignupQueueItemDto): Chip[] {
  const chips: Chip[] = [];
  if (item.emailMatchesExistingUser) {
    chips.push({ label: 'อีเมลตรงกับบัญชีเดิม ระบบจะผูกให้ตอนยืนยัน', tone: 'info' });
  }
  if (item.taxIdMatchesCompanyName) {
    chips.push({ label: `เลขภาษีตรงกับ ${item.taxIdMatchesCompanyName}`, tone: 'warning' });
  }
  if (item.mxValid === true) chips.push({ label: 'โดเมนอีเมลตรวจแล้ว', tone: 'neutral' });
  if (item.mxValid === false) chips.push({ label: 'โดเมนอีเมลมีปัญหา', tone: 'danger' });
  return chips;
}

/** Business-type / VAT / tax id, joined only for the parts the applicant actually filled in. */
export function signupBusinessSummary(item: AdminSignupQueueItemDto): string {
  const parts = [item.businessType, item.vatRegistered === undefined ? undefined : item.vatRegistered ? 'จด VAT' : 'ไม่จด VAT', item.taxId];
  const shown = parts.filter((p): p is string => Boolean(p));
  return shown.length ? shown.join(' · ') : '—';
}

export function canApproveSignup(state: string, item?: AdminSignupQueueItemDto): boolean {
  if (state === 'PENDING_REVIEW') return true;
  // P10-L: for a LINE application, approving a failed provisioning IS the retry — the API accepts
  // it and the fence makes it idempotent. The queue said so on the chip before it allowed it.
  return state === 'PROVISIONING_FAILED' && item !== undefined && isLineSignup(item);
}

/** Only a LINE application can be suspended: spec §3.7 is about stopping an auto-approved shop. */
export function canSuspendSignup(item: AdminSignupQueueItemDto): boolean {
  return isLineSignup(item) && item.state !== 'SUSPENDED' && item.state !== 'REJECTED';
}

/** Approval survives an expired link (spec §4D ②) — reissue is the way back, never a re-application. */
export function canReissueSignup(state: string): boolean {
  return state === 'EMAIL_PENDING' || state === 'EMAIL_FAILED' || state === 'EXPIRED';
}

export type SignupQueueTab = 'ALL' | 'PENDING_REVIEW' | 'AWAITING_CLAIM' | 'PROBLEM';

export const SIGNUP_QUEUE_TABS: { key: SignupQueueTab; label: string }[] = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PENDING_REVIEW', label: 'รออนุมัติ' },
  { key: 'AWAITING_CLAIM', label: 'รอตั้งรหัส' },
  { key: 'PROBLEM', label: 'มีปัญหา' },
];

export function filterSignupQueue(
  items: AdminSignupQueueItemDto[],
  tab: SignupQueueTab,
): AdminSignupQueueItemDto[] {
  if (tab === 'ALL') return items;
  if (tab === 'PENDING_REVIEW') return items.filter((i) => i.state === 'PENDING_REVIEW');
  if (tab === 'AWAITING_CLAIM') return items.filter((i) => i.state === 'EMAIL_PENDING' && !i.emailDeliveryFailed);
  // A bounce flag counts as a problem even if the state has not flipped to EMAIL_FAILED yet, and a
  // provisioning that failed is the most actionable problem of the lot.
  return items.filter((i) => i.state === 'EMAIL_FAILED' || i.state === 'EXPIRED'
    || i.state === 'PROVISIONING_FAILED' || i.emailDeliveryFailed);
}
