import {
  CURRENT_LEGAL_DOCUMENTS,
  PLAN_TIER_PRESETS,
  SIGNUP_TRIAL_TIER_KEY,
  SIGNUP_TRIAL_WARMUP_SLIPS,
  type PlanTierKey,
  type PublicSignupStatusKey,
  type SignupOfferKey,
} from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';

/**
 * What the consent checkbox records. Pinned to the legal artifacts the form links to, so a new
 * terms/privacy release changes the stored consent version without anyone remembering to.
 */
export const SIGNUP_CONSENT_VERSION =
  `terms-${CURRENT_LEGAL_DOCUMENTS.terms.version}-privacy-${CURRENT_LEGAL_DOCUMENTS.privacy.version}`;

export const SIGNUP_SUPPORT_PHONE = '098-256-5628';
export const SIGNUP_SUPPORT_EMAIL = 'contact@mangmeeplus.com';

// ── Offer cards (spec §3A, Billing §8 catalog 2026-08-30) ──

export type SignupOfferCard = {
  tierKey: PlanTierKey;
  /** What submit sends. Only the PRO trial is accepted by the server this round. */
  offerKey: SignupOfferKey;
  nameTh: string;
  priceLabel: string;
  /** Selectable cards carry the trial badge; the rest are priced previews of the real journey. */
  selectable: boolean;
  badge?: string;
  /** Read by assistive technology as the reason the control is unavailable. */
  unavailableReason?: string;
};

const UNAVAILABLE_REASON = 'ยังไม่เปิดให้สมัครแพ็กเกจนี้ทางออนไลน์ เร็ว ๆ นี้';

function limitsLabel(tierKey: PlanTierKey): string {
  const preset = PLAN_TIER_PRESETS[tierKey];
  return `${preset.branchLimit} สาขา · ${preset.employeeLimit} คน · อ่านสลิป ${preset.monthlySlipLimit} ใบ/เดือน`;
}

export const SIGNUP_OFFERS: readonly SignupOfferCard[] = [
  { tierKey: 'STARTER_249', offerKey: 'STARTER_249', nameTh: 'เริ่มต้น', priceLabel: '฿249 / เดือน', selectable: false, unavailableReason: UNAVAILABLE_REASON },
  { tierKey: 'BASIC_499', offerKey: 'BASIC_499', nameTh: 'เติบโต', priceLabel: '฿499 / เดือน', selectable: false, unavailableReason: UNAVAILABLE_REASON },
  // F1: the card names the tier provisioning actually writes. It used to advertise PRO — 5 branches,
  // 10 staff, 100 receipts, ฿999 — for a shop that opens on 1/2/15 with a first-week ceiling.
  { tierKey: SIGNUP_TRIAL_TIER_KEY, offerKey: 'FREE_TRIAL', nameTh: 'ทดลองใช้ฟรี', priceLabel: 'ฟรี 30 วัน', selectable: true },
  { tierKey: 'ENTERPRISE_1999', offerKey: 'ENTERPRISE_1999', nameTh: 'ธุรกิจ', priceLabel: '฿1,999 / เดือน', selectable: false, unavailableReason: UNAVAILABLE_REASON },
];

export function offerLimitsLabel(card: SignupOfferCard): string {
  return limitsLabel(card.tierKey);
}

/**
 * Review F17. P10-L §9 holds a brand-new trial shop to a tighter receipt ceiling for its first
 * week. Telling people afterwards is how "the app is broken" support calls start, so the card says
 * it up front. Owner copy rule: no plus sign in user-facing text.
 */
export function offerWarmupNote(card: SignupOfferCard): string | undefined {
  if (card.tierKey !== SIGNUP_TRIAL_TIER_KEY) return undefined;
  return `สัปดาห์แรกอ่านได้ ${SIGNUP_TRIAL_WARMUP_SLIPS} ใบ`;
}

/**
 * The one offer the form submits. Owner 2026-09-05: no package is chosen at signup, so this names
 * the free trial the applicant actually gets rather than the PRO package it used to be sold as.
 */
export const SELECTABLE_OFFER_KEY: SignupOfferKey = 'FREE_TRIAL';

// ── Form validation ──

export type SignupFormValues = {
  companyName: string;
  ownerFirstName: string;
  ownerLastName: string;
  contactEmail: string;
  phoneNumber: string;
  businessType: string;
  vatRegistered: boolean;
  taxId: string;
};

export type SignupFieldErrors = Partial<Record<keyof SignupFormValues, string>>;

/**
 * Deliberately loose: a shop owner's address only has to be plausible here, because the server
 * checks the domain's MX records and answers 422 for a real typo (spec §3). Rejecting valid
 * addresses locally would block a signup the server would have accepted.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

/** Thai mobile number: exactly 10 digits starting with 0, however the user spaced or dashed it. */
export function isThaiMobile(value: string): boolean {
  return /^0\d{9}$/.test(value.replace(/[^0-9]/g, ''));
}

/** What the field may hold, so `isThaiMobile` and `maxLength` cannot drift apart. */
export const MOBILE_DIGITS = 10;

/**
 * Owner UAT 2026-08-31: the field accepted an 11th digit and only complained after submit. Typing
 * is capped at the same 10 digits the validation demands, and the separators the user may paste in
 * are dropped rather than eating into the cap.
 */
export function clampMobileInput(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, MOBILE_DIGITS);
}

export function validateSignupForm(values: SignupFormValues): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  if (!values.companyName.trim()) errors.companyName = 'กรุณากรอกชื่อร้านหรือบริษัท';
  if (!values.ownerFirstName.trim()) errors.ownerFirstName = 'กรุณากรอกชื่อ';
  if (!values.ownerLastName.trim()) errors.ownerLastName = 'กรุณากรอกนามสกุล';

  const email = values.contactEmail.trim();
  if (!email) errors.contactEmail = 'กรุณากรอกอีเมล';
  else if (!looksLikeEmail(email)) errors.contactEmail = 'รูปแบบอีเมลไม่ถูกต้อง เช่น somchai@gmail.com';

  const phone = values.phoneNumber.trim();
  // Required on the form even though the contract allows it to be absent: when the approval email
  // bounces, this number is the only way anyone can reach the applicant (spec §4D).
  if (!phone) errors.phoneNumber = 'กรุณากรอกเบอร์โทรมือถือ';
  else if (!isThaiMobile(phone)) errors.phoneNumber = 'เบอร์โทรมือถือต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0';

  const taxId = values.taxId.replace(/[^0-9]/g, '');
  if (values.vatRegistered && taxId && taxId.length !== 13) {
    errors.taxId = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
  }

  return errors;
}

const THAI_LETTER = /[฀-๿]/;

/**
 * The public signup forms are the one surface that shows a server sentence verbatim, and only when
 * the server already wrote it in Thai for this applicant — the MX rejection names the mistyped
 * domain, which the shared translator (rightly refusing to display unknown English diagnostics)
 * would replace with a generic "reload the page" the user cannot act on. English operator text
 * still falls through to the reviewed copy.
 */
export function signupSubmitErrorMessage(error: unknown): string {
  const raw = (error as { message?: unknown } | null | undefined)?.message;
  const serverThai = typeof raw === 'string' && THAI_LETTER.test(raw) ? raw.trim() : '';
  return serverThai || apiErrorMessage(error);
}

// ── Status page copy (spec §3 allowlist — coarse states only, never internal review detail) ──

export type SignupStatusCopy = { title: string; body: string; tone: 'info' | 'success' | 'warning' | 'error' };

const STATUS_COPY: Record<PublicSignupStatusKey, SignupStatusCopy> = {
  CHECKING: {
    title: 'กำลังตรวจสอบคำขอ',
    body: 'ระบบกำลังตรวจข้อมูลที่คุณส่งมา ยังไม่ต้องทำอะไรเพิ่ม',
    tone: 'info',
  },
  PENDING_REVIEW: {
    title: 'รอทีมงานตรวจสอบ',
    body: 'คำขอเข้าคิวตรวจสอบแล้ว เมื่ออนุมัติ เราจะส่งอีเมลให้ตั้งรหัสผ่าน',
    tone: 'info',
  },
  AWAITING_CLAIM: {
    title: 'อนุมัติแล้ว รอตั้งรหัสผ่าน',
    body: 'เราส่งอีเมลพร้อมลิงก์ตั้งรหัสผ่านไปให้แล้ว กรุณาตรวจกล่องจดหมาย และเมลขยะ',
    tone: 'success',
  },
  READY: {
    title: 'เปิดใช้งานแล้ว',
    body: 'ร้านของคุณพร้อมใช้งาน เข้าสู่ระบบด้วยชื่อผู้ใช้ และรหัสผ่านที่ตั้งไว้ได้เลย',
    tone: 'success',
  },
  REJECTED: {
    title: 'คำขอนี้ยังไม่ผ่านการตรวจสอบ',
    body: `หากต้องการสอบถามเพิ่มเติม โทร ${SIGNUP_SUPPORT_PHONE}`,
    tone: 'error',
  },
  EXPIRED: {
    title: 'ลิงก์ตั้งรหัสผ่านหมดอายุแล้ว',
    body: 'คำขอของคุณยังอยู่ กดขอลิงก์ใหม่ได้เลย เราจะส่งอีเมลให้อีกครั้ง',
    tone: 'warning',
  },
};

/**
 * Spec §4D ④: 30 days after approval the request is swept out of the main queue and the applicant
 * can no longer resend to themselves. The approval still stands and an admin can always reissue, so
 * this says who to call — it never tells them to apply again.
 */
const EXPIRED_NEEDS_STAFF_COPY: SignupStatusCopy = {
  title: 'คำขอหมดอายุแล้ว',
  body: `คำขอหมดอายุ ติดต่อ ${SIGNUP_SUPPORT_PHONE} หรืออีเมล ${SIGNUP_SUPPORT_EMAIL} เพื่อเปิดใช้อีกครั้ง`,
  tone: 'warning',
};

export function signupStatusCopy(
  status: PublicSignupStatusKey,
  /** From `PublicSignupStatusDto.canResendClaim`. Default keeps the self-serve wording. */
  canResendClaim = true,
): SignupStatusCopy {
  // Without this the page kept offering "กดขอลิงก์ใหม่ได้เลย" next to a button that is no longer
  // rendered — the one state where the honest answer is a phone number.
  if (status === 'EXPIRED' && !canResendClaim) return EXPIRED_NEEDS_STAFF_COPY;
  return STATUS_COPY[status] ?? STATUS_COPY.CHECKING;
}

// ── Claim page ──

export type ClaimPasswordErrors = { username?: string; password?: string; confirmPassword?: string };

/** Mirrors the hint under the field: at least 8 characters, with letters and digits. */
export function validateClaimPassword(username: string, password: string, confirmPassword: string): ClaimPasswordErrors {
  const errors: ClaimPasswordErrors = {};
  if (!username.trim()) errors.username = 'กรุณากรอกชื่อผู้ใช้';
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.password = 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษร และตัวเลข';
  }
  if (!confirmPassword) errors.confirmPassword = 'กรุณากรอกรหัสผ่านอีกครั้ง';
  else if (password !== confirmPassword) errors.confirmPassword = 'รหัสผ่านสองช่องไม่ตรงกัน';
  return errors;
}
