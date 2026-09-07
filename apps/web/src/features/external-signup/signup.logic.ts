import {
  CURRENT_LEGAL_DOCUMENTS,
  PLAN_TIER_PRESETS,
  SIGNUP_TRIAL_TIER_KEY,
  SIGNUP_TRIAL_WARMUP_SLIPS,
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

// ── What signing up gets you ──

/**
/**
 * Owner 2026-09-05: self-signup stopped selling a tier. Every applicant gets the same free trial
 * the LINE-first signup gives, so the four priced cards — and the monthly price sitting next to a
 * free-trial badge — are gone. They described a purchase nobody was being asked to make.
 *
 * The numbers are quoted from the shared preset rather than restated, so a change to the trial
 * cannot leave this page promising the old one.
 */
const TRIAL_PRESET = PLAN_TIER_PRESETS[SIGNUP_TRIAL_TIER_KEY];

export const SIGNUP_TRIAL_DAYS = 30;

export const SIGNUP_TRIAL_HEADLINE =
  `ทดลองใช้ฟรี ${SIGNUP_TRIAL_DAYS} วัน ให้ AI อ่านรูปใบเสร็จได้ ${TRIAL_PRESET.monthlySlipLimit} ครั้ง`;

/** The initial allowance equals the monthly trial limit from the shared preset. */
export const SIGNUP_TRIAL_WARMUP = `อ่านได้ ${SIGNUP_TRIAL_WARMUP_SLIPS} ครั้งต่อเดือนตั้งแต่วันแรก`;

/** What happens at the end of it. Never implies a card, a renewal, or a charge. */
export const SIGNUP_TRIAL_AFTER =
  'เมื่อครบกำหนด ติดต่อทีมงานเพื่อเลือกแพ็กเกจ ไม่มีการตัดเงินอัตโนมัติ';

/**
 * Still sent with the form: it is the key the server's allowlist accepts and what the admin queue
 * shows. The applicant is no longer shown a choice, because there is not one — and R02 made this
 * name the free trial that is actually provisioned rather than the paid tier it used to name.
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
  // One wording for one rule, shared with the profile page and the API's invalid_phone_number.
  else if (!isThaiMobile(phone)) errors.phoneNumber = 'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678';

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

/**
 * Server rejections that name ONE field the applicant can fix. The MX check is the whole reason
 * this exists: the API answers `email_domain_has_no_mx` — an English code with no Thai sentence
 * behind it — so the shared translator (rightly refusing unknown diagnostics) told the applicant to
 * reload the page for a typo only they can correct.
 */
const FIELD_REJECTIONS: Record<string, { field: keyof SignupFormValues; message: string }> = {
  email_domain_has_no_mx: { field: 'contactEmail', message: 'ไม่พบโดเมนอีเมลนี้ ตรวจตัวสะกดอีกครั้ง' },
};

export function signupFieldRejection(
  error: unknown,
): { field: keyof SignupFormValues; message: string } | null {
  const raw = error as { code?: unknown; message?: unknown } | null | undefined;
  // The API puts the code in `message`; anything routed through the BFF carries it in `code`.
  for (const candidate of [raw?.code, raw?.message]) {
    if (typeof candidate !== 'string') continue;
    const rejection = FIELD_REJECTIONS[candidate.trim()];
    if (rejection) return rejection;
  }
  return null;
}

/**
 * R07: `submit-company-signup.use-case` receives the payload DURABLY before it checks MX, so a 422
 * leaves a row keyed by the idempotency key holding the mistyped address's payload hash. Re-sending
 * the corrected form under that same key is `external_signup_payload_conflict`, and the applicant
 * is stuck on the form for good.
 *
 * 400/422 is the one class of answer that proves the server FINISHED with this payload, so the
 * correction is a new submission and earns a new key. Everything else — a network error, a 5xx, a
 * 429, a timeout — leaves the outcome unknown, and there the key must survive or a second tap
 * opens a second application.
 */
export function rotateSignupKeyAfter(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return status === 400 || status === 422;
}

/**
 * R11: a load that failed for a reason which says nothing about the thing being loaded. The status
 * page called every failure a wrong link and the claim page called every failure a dead token — so
 * an API restart, a rate limit or a lost connection retired a link that was perfectly good. No
 * answer at all (a network error carries no status) is transient by definition.
 */
export function isTransientLoadFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

/** Submit order, so "focus the first error" means the first one the applicant would reach. */
const SIGNUP_FIELD_ORDER: readonly (keyof SignupFormValues)[] = [
  'companyName', 'ownerFirstName', 'ownerLastName', 'contactEmail', 'phoneNumber', 'businessType',
  'vatRegistered', 'taxId',
];

export function firstSignupErrorField(errors: SignupFieldErrors): keyof SignupFormValues | null {
  return SIGNUP_FIELD_ORDER.find((field) => errors[field]) ?? null;
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
  // R11: the letter bounced, so the AWAITING_CLAIM sentence ("ไปให้แล้ว") was telling the applicant
  // to keep checking a mailbox nothing reached. The resend button is rendered in this state.
  EMAIL_FAILED: {
    title: 'ส่งอีเมลไม่สำเร็จ',
    body: `อีเมลส่งไปไม่ถึง กดขอส่งใหม่ได้เลย หากอีเมลพิมพ์ผิด โทร ${SIGNUP_SUPPORT_PHONE} ให้ทีมงานแก้ให้`,
    tone: 'warning',
  },
  // R11: the mailbox is proved and the shop is being built. READY put a "log in" button in front
  // of an account that had no company behind it yet.
  //
  // F9: nothing polls this page, so it may not say it will update on its own — that left the
  // applicant watching a screen that would never change. The refresh is the honest instruction.
  PREPARING: {
    title: 'กำลังเปิดร้านให้',
    body: 'ยืนยันอีเมลเรียบร้อยแล้ว ระบบกำลังเปิดร้านให้ อีกสักครู่กดรีเฟรชหน้านี้เพื่อดูสถานะล่าสุด',
    tone: 'info',
  },
  // R11: nothing retries this by itself, so "ยังไม่ต้องทำอะไรเพิ่ม" pointed at a queue nobody works.
  PREPARING_FAILED: {
    title: 'เปิดร้านติดขัด',
    body: `การเปิดร้านติดขัด ทีมงานกำลังดูให้ ต้องการให้เร่ง โทร ${SIGNUP_SUPPORT_PHONE}`,
    tone: 'error',
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

/**
 * F8: the free-trial line is a promise about a shop that is on its way. Beside "we did not approve
 * this", "the build stopped" or "this expired" it is an advert on a dead end — and on the last two
 * it reads as if the trial were already running.
 */
export function showsTrialNotice(status: PublicSignupStatusKey): boolean {
  return status !== 'REJECTED' && status !== 'PREPARING_FAILED' && status !== 'EXPIRED';
}

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

/**
 * Exactly the rule the claim endpoint enforces
 * (`SignupClaimSetPasswordDto`: 3–40, `[A-Za-z0-9._-]`). The page used to check only that the box
 * was non-empty, so a Thai or spaced username reached the server and came back as a 400 the
 * applicant could not read — after they had typed a password twice.
 */
export const CLAIM_USERNAME_MIN = 3;
export const CLAIM_USERNAME_MAX = 40;
const CLAIM_USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
export const CLAIM_USERNAME_HINT =
  `${CLAIM_USERNAME_MIN}–${CLAIM_USERNAME_MAX} ตัว ใช้ภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง`;

export function validateClaimPassword(username: string, password: string, confirmPassword: string): ClaimPasswordErrors {
  const errors: ClaimPasswordErrors = {};
  const trimmedUsername = username.trim();
  if (!trimmedUsername) errors.username = 'กรุณากรอกชื่อผู้ใช้';
  else if (trimmedUsername.length < CLAIM_USERNAME_MIN || trimmedUsername.length > CLAIM_USERNAME_MAX
    || !CLAIM_USERNAME_PATTERN.test(trimmedUsername)) {
    errors.username = `ชื่อผู้ใช้ต้องมี ${CLAIM_USERNAME_HINT}`;
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.password = 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษร และตัวเลข';
  }
  if (!confirmPassword) errors.confirmPassword = 'กรุณากรอกรหัสผ่านอีกครั้ง';
  else if (password !== confirmPassword) errors.confirmPassword = 'รหัสผ่านสองช่องไม่ตรงกัน';
  return errors;
}
