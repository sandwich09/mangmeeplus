// Pure presentation rules for the auto-register review queue (P10 Flow B, spec §4C/§4D).
// Kept out of the page so the state/hint/filter decisions stay testable under `pnpm test`.

import type { AdminSignupQueueItemDto, CompanyBusinessCategory } from '@watchdog-bms/contracts';

/** Chip tone; the page owns the Tailwind classes for each. */
export type ChipTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export type Chip = { label: string; tone: ChipTone };

/** Number of idle days after approval before the queue nudges the admin to phone the applicant. */
const IDLE_WARNING_DAYS = 3;

const STATE_CHIP: Record<string, Chip> = {
  RECEIVED: { label: 'รับคำขอแล้ว ต้องทำขั้นตอนรับต่อ', tone: 'warning' },
  VALIDATED: { label: 'ตรวจข้อมูลแล้ว ต้องทำขั้นตอนรับต่อ', tone: 'warning' },
  PENDING_REVIEW: { label: 'รออนุมัติ', tone: 'info' },
  EMAIL_PENDING: { label: 'ส่งเมลแล้ว รอตั้งรหัส', tone: 'neutral' },
  EMAIL_FAILED: { label: 'เมลตีกลับ', tone: 'danger' },
  EXPIRED: { label: 'ลิงก์หมดอายุ', tone: 'warning' },
  REJECTED: { label: 'ปฏิเสธแล้ว', tone: 'neutral' },
  PROVISIONING_FAILED: { label: 'เปิดร้านไม่สำเร็จ กดอนุมัติเพื่อลองใหม่', tone: 'danger' },
  READY: { label: 'เปิดร้านแล้ว รอปิดงาน กดอนุมัติเพื่อปิดงาน', tone: 'warning' },
  COMPLETED: { label: 'เปิดใช้งานแล้ว', tone: 'success' },
};

/**
 * Why the last provisioning stopped, for the rows on the "มีปัญหา" tab. Only codes an admin can act
 * on are mapped — an unknown one stays silent rather than putting a machine string in front of an
 * operator, and the state chip already says "เปิดร้านไม่สำเร็จ".
 */
const FAILURE_CHIP: Record<string, Chip> = {
  line_identity_already_linked: {
    label: 'LINE นี้ผูกกับบัญชีอื่นอยู่ ต้องปลดการเชื่อมก่อนจึงเปิดร้านได้',
    tone: 'danger',
  },
  line_identity_disabled: {
    label: 'LINE นี้ถูกปิดใช้งานอยู่ ต้องเปิดใช้งานก่อนจึงเปิดร้านได้',
    tone: 'danger',
  },
};

/** Owner 2026-09-05: how the shop this applicant already had stands today. */
const PRIOR_COMPANY_STATE_TH: Record<string, string> = {
  ACTIVE: 'ใช้งานอยู่',
  EXPIRED: 'หมดอายุ',
  CLOSED: 'ปิดอยู่',
};

export function signupFailureChip(item: AdminSignupQueueItemDto): Chip | null {
  return (item.failureCode ? FAILURE_CHIP[item.failureCode] : undefined) ?? null;
}

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
  if (item.reviewResolution === 'PLAN_REVIEW') {
    chips.push({ label: 'รอจัดแพ็กเกจ ยังไม่เปิดร้าน', tone: 'warning' });
  }
  if (item.reviewResolution === 'REQUEST_INFO') {
    chips.push({ label: 'รอข้อมูลจากลูกค้า', tone: 'warning' });
  }
  if (item.reviewResolution === 'RETURN_EXISTING') {
    chips.push({ label: 'จบด้วยการกลับร้านเดิม ไม่สร้างร้านใหม่', tone: 'success' });
  }
  // A LINE signup's email is unverified shop contact data, not an account identity. Only the
  // verified web-email flow may promise that an address match will attach an existing account.
  if (!isLineSignup(item) && item.emailMatchesExistingUser) {
    chips.push({ label: 'อีเมลตรงกับบัญชีเดิม ระบบจะผูกให้ตอนยืนยัน', tone: 'info' });
  }
  if (item.priorRejectedRequestId) {
    chips.push({ label: `สมัครใหม่หลังถูกปฏิเสธ · คำขอเดิม ${item.priorRejectedRequestId}`, tone: 'warning' });
  }
  if (item.emailPreviouslyUsed) {
    chips.push({ label: 'อีเมลเคยใช้แล้ว — ตรวจร้านเดิมก่อนอนุมัติ', tone: 'warning' });
  }
  // P10-L §8: this LINE account already belongs to somebody, so approving adds a shop to THEIR
  // account instead of creating a new one. The operator's next click depends on knowing which.
  if (item.attachesToExistingAccount) {
    chips.push({ label: 'LINE นี้มีบัญชีอยู่แล้ว จะเพิ่มเป็นร้านที่ 2', tone: 'info' });
  }
  // Owner 2026-09-05: a repeat free trial. Approving is still allowed — this only puts the shop
  // this LINE account already had in front of the operator BEFORE the button, not after.
  if (item.priorCompanyName) {
    const state = PRIOR_COMPANY_STATE_TH[item.priorCompanyState ?? ''] ?? 'ไม่ทราบสถานะ';
    chips.push({ label: `LINE นี้เคยมีร้าน: ${item.priorCompanyName} (${state})`, tone: 'warning' });
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

/**
 * R10. `businessType` is free text in the applicant's own language and the PDPA health tripwire
 * reads the closed enum, so "คลินิก" mapped to OTHER and the safeguard never fired for the people
 * it exists for. When the mapping could not read what the applicant wrote, the reviewer — who is
 * looking straight at that word — has to say which category it is. Nothing guesses from the text.
 *
 * An empty `businessType` is not a failed mapping: OTHER is then the true answer, and asking would
 * be asking the operator to invent one.
 */
export function requiresCategoryChoice(item: AdminSignupQueueItemDto): boolean {
  return (item.businessCategory ?? 'OTHER') === 'OTHER' && Boolean(item.businessType?.trim());
}

/**
 * F2: what stops an approval, and what does not. The first cut refused OTHER outright whenever the
 * mapping had failed — but EVERY Thai answer maps to OTHER, so a shop that genuinely is "other"
 * ("ร้านตัดผม") could not be approved at all. The reviewer confirms that choice instead: the
 * tripwire still gets a decision rather than a default, and the honest answer stays reachable.
 */
export function approveBlockedOnCategory(
  item: AdminSignupQueueItemDto,
  chosen: string,
  confirmedOther: boolean,
): boolean {
  return requiresCategoryChoice(item) && chosen === 'OTHER' && !confirmedOther;
}

/** Same wording the manual onboarding form uses, so one category reads the same in both places. */
export const BUSINESS_CATEGORY_LABELS: Record<CompanyBusinessCategory, string> = {
  RETAIL: 'ค้าปลีก (Retail)',
  TRADING: 'ค้าส่ง / เทรดดิ้ง (Trading / wholesale)',
  SERVICE: 'บริการทั่วไป (General service)',
  CLINIC: 'คลินิก / สถานพยาบาล (Clinic)',
  WELLNESS_SPA: 'สปา / เวลเนส (Spa / wellness)',
  MEDICAL_RETAIL: 'ร้านขายยา / เวชภัณฑ์ (Pharmacy / medical retail)',
  OTHER: 'อื่น ๆ (Other)',
};

/** Business-type / VAT / tax id, joined only for the parts the applicant actually filled in. */
export function signupBusinessSummary(item: AdminSignupQueueItemDto): string {
  const parts = [item.businessType, item.vatRegistered === undefined ? undefined : item.vatRegistered ? 'จด VAT' : 'ไม่จด VAT', item.taxId];
  const shown = parts.filter((p): p is string => Boolean(p));
  return shown.length ? shown.join(' · ') : '—';
}

export function canApproveSignup(state: string, item?: AdminSignupQueueItemDto): boolean {
  if (state === 'PENDING_REVIEW') return true;
  // Review F2: retrying a failed provisioning is offered on BOTH sources. A Flow B applicant who
  // claimed their link and then hit a failure has a spent token and no way back — resend and
  // reissue both refuse from this state — so this button is the only thing that opens their shop.
  if (state === 'PROVISIONING_FAILED') return true;
  // P10-L: for a LINE application, approving is also the RECOVERY. READY means the shop was built
  // and the last step did not land, so approving closes it. Idempotent behind the fence, and it
  // leaves the customer's LINE account locked until done.
  if (item === undefined || !isLineSignup(item)) return false;
  if (state === 'READY') return true;
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
export function approveLabel(state: string, item?: AdminSignupQueueItemDto): string {
  if (state === 'PROVISIONING_FAILED') return 'ลองเปิดร้านอีกครั้ง';
  if (state === 'READY' || state === 'PROVISIONING') return 'ปิดงาน';
  if (item && isLineSignup(item)) return 'เลือกผลคำขอ';
  return 'อนุมัติ';
}

/** Intake stopped after the request was saved; this resumes validation rather than approving past it. */
export function canRetrySignupIntake(item: AdminSignupQueueItemDto): boolean {
  return isLineSignup(item) && (item.state === 'RECEIVED' || item.state === 'VALIDATED');
}

/** True when approving CLOSES a shop that already exists rather than deciding a new application. */
export function isFinishingStrandedRow(state: string): boolean {
  return state === 'PROVISIONING_FAILED' || state === 'READY' || state === 'PROVISIONING';
}

/**
 * Only a LINE application can be suspended: spec §3.7 is about stopping an auto-approved shop.
 *
 * READY is never offered — the shop EXISTS and the application has not closed, so suspending
 * strands an ACTIVE company whose trial guards may never have run and frees the LINE account to
 * apply again. The action a READY row wants is the close-out.
 *
 * PROVISIONING is offered in exactly ONE case, the same one the API allows under its own lock
 * (plan note, L-C): an ABANDONED attempt that never stamped a `companyId`. That stamp happens
 * inside the company transaction, so no company id means nothing was built and nothing can be
 * stranded — and without the button that row is a dead end whose only other exit is opening a shop
 * the operator has already decided not to want. A live run, or an abandoned one that DID build a
 * shop, still shows only the close-out.
 */
export function canSuspendSignup(item: AdminSignupQueueItemDto): boolean {
  if (!isLineSignup(item)) return false;
  if (item.state === 'READY') return false;
  if (item.state === 'PROVISIONING') return isAbandonedEmptyAttempt(item);
  return item.state !== 'SUSPENDED' && item.state !== 'REJECTED';
}

/** The one suspendable PROVISIONING row: given up on by the clock, and with no shop behind it. */
export function isAbandonedEmptyAttempt(item: AdminSignupQueueItemDto): boolean {
  return item.state === 'PROVISIONING' && item.staleProvisioning === true && !item.companyId;
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

export type SignupQueueTab =
  | 'ALL' | 'PENDING_REVIEW' | 'AWAITING_CLAIM' | 'PROBLEM' | 'ARCHIVED'
  | 'AUTO_APPROVED' | 'PACKAGE_CHANGE';

/** Review B-09 / §8: 14 days of what AUTO_FREE let through, for after-the-fact review. */
export const AUTO_APPROVED_REVIEW_DAYS = 14;

export const SIGNUP_QUEUE_TABS: { key: SignupQueueTab; label: string }[] = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PENDING_REVIEW', label: 'รออนุมัติ' },
  { key: 'AWAITING_CLAIM', label: 'รอตั้งรหัส' },
  { key: 'PROBLEM', label: 'มีปัญหา' },
  // R13: a rejected, suspended or expired application appeared on no list at all, so "where did
  // that application go" had no answer anywhere in the console.
  { key: 'ARCHIVED', label: 'ปิดไปแล้ว' },
  // Owner 2026-09-06 read "อนุมัติอัตโนมัติ 14 วัน" as "auto approval lasts 14 days". It never did: this
  // tab is the after-the-fact review list of shops AUTO_FREE opened in the last 14 days; the mode
  // itself stays on until the environment's deploy config turns it off.
  { key: 'AUTO_APPROVED', label: `เปิดให้อัตโนมัติ (ย้อนหลัง ${AUTO_APPROVED_REVIEW_DAYS} วัน)` },
  { key: 'PACKAGE_CHANGE', label: 'คำขอเปลี่ยนแพ็กเกจ' },
];

/** The two tabs that read their own endpoint rather than filtering the main queue. */
export function tabLoadsOwnList(tab: SignupQueueTab): boolean {
  return tab === 'AUTO_APPROVED' || tab === 'PACKAGE_CHANGE';
}

// R13: what each tab holds is decided by the API now (`queueWhere` in signup-admin-queue.use-case),
// because filtering here could only ever filter the page that happened to arrive — which is how a
// tab came to report "no applications in this group" over a backlog the database was holding.

/**
 * F4: whether "ไม่มีคำขอในกลุ่มนี้" is TRUE. It is a claim about the database, so it may only be
 * made when the server counted this tab and counted zero. An empty screen with no count behind it
 * is a load that did not answer — the same sentence would then mean the opposite of what it says.
 */
export function queueEmptyForReal(
  visible: readonly AdminSignupQueueItemDto[],
  counts: Record<string, number> | null,
  tab: SignupQueueTab,
): boolean {
  if (visible.length > 0) return false;
  return counts?.[tab] === 0;
}
