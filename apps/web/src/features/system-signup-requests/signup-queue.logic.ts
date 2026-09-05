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
  READY: { label: 'เปิดร้านแล้ว รอปิดงาน กดอนุมัติเพื่อปิดงาน', tone: 'warning' },
  COMPLETED: { label: 'เปิดใช้งานแล้ว', tone: 'success' },
};

/** P10-L: the source decides what approving DOES, so the page has to be able to ask. */
export function isLineSignup(item: AdminSignupQueueItemDto): boolean {
  return item.source === 'line-oa';
}

/**
 * `state` is a plain string in the contract, so an unknown value must still render. PROVISIONING
 * reads two ways and the difference is the whole point: still running (wait) versus abandoned
 * (act). The server decides which — it owns the clock the fence uses.
 */
export function signupStateChip(state: string, item?: AdminSignupQueueItemDto): Chip {
  if (state === 'PROVISIONING') {
    return item?.staleProvisioning
      ? { label: 'เปิดร้านค้างอยู่ กดปิดงานเพื่อทำต่อ', tone: 'danger' }
      : { label: 'กำลังเปิดร้าน', tone: 'info' };
  }
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
  // P10-L §8: this LINE account already belongs to somebody, so approving adds a shop to THEIR
  // account instead of creating a new one. The operator's next click depends on knowing which.
  if (item.attachesToExistingAccount) {
    chips.push({ label: 'LINE นี้มีบัญชีอยู่แล้ว จะเพิ่มเป็นร้านที่ 2', tone: 'info' });
  }
  if (item.taxIdMatchesCompanyName) {
    chips.push({ label: `เลขภาษีตรงกับ ${item.taxIdMatchesCompanyName}`, tone: 'warning' });
  }
  // Review A-01: the number on the form already reaches a shop of ours — most often one an admin
  // opened by hand for the same person. Advisory: the operator calls, the system decides nothing.
  if (item.phoneMatchesCompanyName) {
    chips.push({ label: `อาจซ้ำกับร้าน ${item.phoneMatchesCompanyName}`, tone: 'warning' });
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
  // P10-L: for a LINE application, approving is also the RECOVERY. PROVISIONING_FAILED retries;
  // READY means the shop was built and the last step did not land, so approving closes it. Both
  // are idempotent behind the fence, and both leave the customer's LINE account locked until done.
  if (item === undefined || !isLineSignup(item)) return false;
  if (state === 'PROVISIONING_FAILED' || state === 'READY') return true;
  // An abandoned run is the third recovery. A live one is not: the API answers 200 with the row
  // still PROVISIONING (its idempotency path), so a button here would promise a close-out that
  // did not happen — the same shape of lie the READY chip used to tell.
  return state === 'PROVISIONING' && item.staleProvisioning === true;
}

/** Rejecting only makes sense before a decision: the API answers 409 in every other state. */
export function canRejectSignup(state: string): boolean {
  return state === 'PENDING_REVIEW';
}

/** What the approve button DOES here, so the operator is not told "approve" for a recovery. */
export function approveLabel(state: string): string {
  if (state === 'PROVISIONING_FAILED') return 'ลองเปิดร้านอีกครั้ง';
  if (state === 'READY' || state === 'PROVISIONING') return 'ปิดงาน';
  return 'อนุมัติ';
}

/** True when approving CLOSES a shop that already exists rather than deciding a new application. */
export function isFinishingStrandedRow(state: string): boolean {
  return state === 'PROVISIONING_FAILED' || state === 'READY' || state === 'PROVISIONING';
}

/** Only a LINE application can be suspended: spec §3.7 is about stopping an auto-approved shop. */
export function canSuspendSignup(item: AdminSignupQueueItemDto): boolean {
  if (!isLineSignup(item)) return false;
  // Never while the shop exists but the application has not closed. SUSPENDED is terminal, so
  // suspending here strands a shop whose trial guards may never have run — an UNLIMITED shop, with
  // the application shut behind it — and frees the LINE account to apply again. On a live run it
  // also races the attempt still in flight. The one action those rows offer is the close-out.
  //
  // The API refuses both states under its own lock (`suspend_not_allowed_in_flight`); this only
  // keeps the page from offering a button that 409s.
  if (item.state === 'PROVISIONING' || item.state === 'READY') return false;
  return item.state !== 'SUSPENDED' && item.state !== 'REJECTED';
}

/** True when suspending leaves a shop already standing, so the copy must not imply it stops it. */
export function suspendLeavesShopRunning(state: string): boolean {
  return state === 'PROVISIONING_FAILED' || state === 'COMPLETED';
}

/** Approval survives an expired link (spec §4D ②) — reissue is the way back, never a re-application. */
export function canReissueSignup(state: string): boolean {
  return state === 'EMAIL_PENDING' || state === 'EMAIL_FAILED' || state === 'EXPIRED';
}

/**
 * P10-L §8: rejecting a LINE application defaults to TELLING the applicant, the opposite of the
 * web form's default. Flow B stays silent because the address is unproven and an unsolicited email
 * would make the platform a spam cannon; a LINE application has no address at all — its rejection
 * travels back down the chat the person opened, where silence is just a shop wondering forever.
 */
export function rejectNotifyDefault(item: AdminSignupQueueItemDto): boolean {
  return isLineSignup(item);
}

/** What the notify toggle promises, since the two sources travel on different rails. */
export function rejectNotifyLabel(item: AdminSignupQueueItemDto): string {
  return isLineSignup(item) ? 'แจ้งทางไลน์' : 'ส่งอีเมลแจ้งผู้สมัคร';
}

export type SignupQueueTab = 'ALL' | 'PENDING_REVIEW' | 'AWAITING_CLAIM' | 'PROBLEM' | 'AUTO_APPROVED' | 'PACKAGE_CHANGE';

/** Review B-09 / §8: 14 days of what AUTO_FREE let through, for after-the-fact review. */
export const AUTO_APPROVED_REVIEW_DAYS = 14;

export const SIGNUP_QUEUE_TABS: { key: SignupQueueTab; label: string }[] = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PENDING_REVIEW', label: 'รออนุมัติ' },
  { key: 'AWAITING_CLAIM', label: 'รอตั้งรหัส' },
  { key: 'PROBLEM', label: 'มีปัญหา' },
  { key: 'AUTO_APPROVED', label: `อนุมัติอัตโนมัติ ${AUTO_APPROVED_REVIEW_DAYS} วัน` },
  { key: 'PACKAGE_CHANGE', label: 'คำขอเปลี่ยนแพ็กเกจ' },
];

/** The two tabs that read their own endpoint rather than filtering the main queue. */
export function tabLoadsOwnList(tab: SignupQueueTab): boolean {
  return tab === 'AUTO_APPROVED' || tab === 'PACKAGE_CHANGE';
}

export function filterSignupQueue(
  items: AdminSignupQueueItemDto[],
  tab: SignupQueueTab,
): AdminSignupQueueItemDto[] {
  if (tab === 'ALL') return items;
  if (tab === 'PENDING_REVIEW') return items.filter((i) => i.state === 'PENDING_REVIEW');
  if (tab === 'AWAITING_CLAIM') return items.filter((i) => i.state === 'EMAIL_PENDING' && !i.emailDeliveryFailed);
  // A bounce flag counts as a problem even if the state has not flipped to EMAIL_FAILED yet, and a
  // provisioning that failed is the most actionable problem of the lot. An ABANDONED run belongs
  // here too — it is the one an operator most needs to find — while a live one is not a problem.
  return items.filter((i) => i.state === 'EMAIL_FAILED' || i.state === 'EXPIRED'
    || i.state === 'PROVISIONING_FAILED' || i.state === 'READY'
    || (i.state === 'PROVISIONING' && i.staleProvisioning === true)
    || i.emailDeliveryFailed);
}
