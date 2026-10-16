import type { BillingStatus } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { errorStatus } from './billing-error-text';

/**
 * The block of choices on the package page while a payment of this shop is unfinished, in flight or being checked (round 3 of the promotion
 * work: four loose buttons with no order, no reason and no sign of which one a buyer needs). The page computes the plain flags it always
 * computed and only draws what this returns: ONE block with a title for the state, an opening sentence that says what is waiting, and the
 * choices in the order a buyer most likely wants them; captions only add cautions the labels cannot carry.
 *
 * Only the first choice is the green button, the second is the normal one, and a choice that gives something up (ending the payment) is
 * quiet and last. What a choice DOES (its handler, its API call, when it can be pressed) stays in the page; nothing here decides that.
 * Plain Thai: no id, enum key or code on screen. "เดิม" as the old package is said only when the shop has one.
 */
export type PendingPaymentInput = {
  /** `BillingStatus.paymentState`. FAILED also means "the last charge failed" (a past-due subscription), not only a Checkout that failed. */
  paymentState: BillingStatus['paymentState'];
  /** The status names an attempt (`status.attemptId`): a purchase of this shop is in flight. */
  hasAttempt: boolean;
  /** `awaitingStripe`: back from the payment page and the first answer is still pending. */
  awaiting: boolean;
  /** Back from the payment page after finishing there (not by its back button) and no answer came: the buyer may well have paid. */
  unconfirmed: boolean;
  /** `canEndCheckout` / `canResumePayment` / `oneTapCancel`: the page's own flags for the open Checkout. */
  canEnd: boolean; canResume: boolean; oneTap: boolean;
  /** `hasPaymentToCheck`: the check-the-result control exists. */
  canCheck: boolean;
  /** The provider has the money and the package is not applied yet (paid, then applying or held). */
  moneyReceived: boolean;
  held?: boolean;
  deferred?: boolean;
  /** A promotion's renewal is still being set up after the payment (`promotionBlock.checking`). */
  renewalSetup: boolean;
  /** The return page's own attempt failed. */
  failed: boolean;
  /** The page can show its existing package chooser; absence of this permission alone says nothing about why. */
  canPurchase?: boolean;
  /** Explicit sales-closed facts from the status read, never inferred from missing permission. */
  salesClosed?: boolean;
  /** The shop has a package of its own now: only then can a sentence speak of the package it keeps. */
  hasPackage: boolean;
  /** The name of the promotion right reserved for this payment, if one is. */
  reservedPromotion: string | null;
};

export type PendingStepKey = 'continue' | 'check' | 'cancel';
export type PendingStep = { key: PendingStepKey; label: string; caption: string[]; emphasis: 'primary' | 'secondary' | 'quiet' };
export type PendingKind = 'OPEN' | 'WAITING' | 'RECEIVED' | 'CHECKING' | 'FAILED' | 'RECHECK';
export type PendingPayment = {
  kind: PendingKind;
  /**
   * While a payment waits, is paid but not applied, or has a definite failure the block LEADS the card and its title IS the card's heading: this text replaces the
   * page's own heading chain (which said "checking" for a page that waits for the buyer) and is said once, nowhere else. null = the page's own heading stands (it is about the package).
   */
  heading: string | null;
  /** The block's own title, for the kinds whose card heading is about something else (RECEIVED, FAILED, RECHECK); null when the heading or the card already says it. */
  title: string | null;
  intro: string[];
  steps: PendingStep[];
  /**
   * A payment of this shop is open, awaited, received or being checked. Then the block is the single place that says so: the generic "choose a package" button, the invitation to buy,
   * the amber "still checking" alert and a no-package box that would say nothing more than the badge give way to it.
   */
  inFlight: boolean;
  /** The reserved promotion right is said in `intro`, so the separate green box says nothing more. */
  showsReservedPromotion: boolean;
  tone: 'attention' | 'ok' | 'neutral';
};

export const PENDING_TEXT = {
  titleOpen: 'มีรายการจ่ายเงินที่ยังไม่เสร็จ',
  titleReceived: 'ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ',
  titleLast: 'ผลการจ่ายเงินล่าสุด',
  /** The heading while the first answer after the payment page is awaited (it was the line of the no-package box), and while an attempt is being checked (it was the card's own heading). */
  headingWaiting: 'กำลังรอผลการจ่ายเงิน',
  headingChecking: 'กำลังตรวจสอบรายการจ่ายเงิน',
  /** The region's name when the block shows no heading and no title of its own. */
  regionName: 'ตรวจผลการจ่ายเงิน',
  labelContinue: 'จ่ายต่อ',
  /** The buyer's own claim, used where the check is the second choice and the payment is unpaid as far as the system knows. */
  labelPaidCheck: 'จ่ายแล้ว ตรวจผลการจ่ายเงิน',
  labelCheck: 'ตรวจผลการจ่ายเงิน',
  labelCancel: 'ยกเลิกรายการนี้',
  /** The two-step end, kept: the provider is asked before a new purchase can start. */
  confirmEnd: 'ยกเลิกรายการจ่ายนี้?',
  confirmDetail: 'ระบบตรวจผลรายการเดิมก่อน จึงเริ่มรายการใหม่ได้',
  headingUnknown: 'ยังไม่ทราบผลการจ่ายเงิน',
  unknownDetail: 'ตรวจผลรายการเดิมก่อน เพื่อไม่ให้จ่ายซ้ำ',
  confirmYes: 'ยกเลิกรายการนี้',
  confirmNo: 'ไม่ยกเลิก',
  /** The one sentence of the amber alert for a payment in flight, for the (rare) moment no block says it: it names the button that alert really has. */
  alertCheckoutPending: 'ระบบกำลังตรวจรายการจ่ายเงินเดิมกับผู้ให้บริการรับเงิน กรุณารอสักครู่แล้วกดตรวจสถานะล่าสุด',
} as const;

/** What the page's old "ยังยืนยันผลไม่ได้ …" paragraph said besides what the block says: where to go when checking does not settle it. Said once, in the block. */
const CONTACT = 'ถ้าตรวจแล้วยังไม่ชัดเจน ให้ติดต่อทีมงานพร้อมเลขอ้างอิง';
const OPEN_INTRO = {
  PENDING: 'เปิดหน้าจ่ายเงินไว้แล้ว แต่ระบบยังไม่ได้รับผลการจ่ายเงิน',
  ACTION_REQUIRED: 'การจ่ายเงินรายการนี้ยังต้องทำขั้นตอนเพิ่มที่หน้าจ่ายเงิน',
  OTHER: 'มีหน้าจ่ายเงินที่เปิดค้างอยู่',
} as const;
const reservedSentence = (name: string) => `จองสิทธิ์โปรโมชั่น ${name} ไว้ให้รายการนี้แล้ว สิทธิ์เริ่มใช้เมื่อจ่ายเงินสำเร็จ`;
const PACKAGE_KEPT = 'แพ็กเกจที่ใช้อยู่ไม่เปลี่ยน';
const RIGHT_BACK = 'สิทธิ์โปรโมชั่นที่จองไว้จะถูกคืน เลือกใช้ใหม่ได้ถ้าโปรโมชั่นยังเปิดอยู่';

export function pendingPayment(input: PendingPaymentInput): PendingPayment | null {
  const reserved = input.reservedPromotion, reservedLine = reserved ? [reservedSentence(reserved)] : [];
  const check = (emphasis: PendingStep['emphasis'], label: string, caption: string[]): PendingStep => ({ key: 'check', label, caption, emphasis });

  // Back from the payment page and the first answer is still pending: the heading says it (it was a gray box of the no-package card, and the block's own opening line for a shop with a
  // package); the block adds that the page checks by itself, and the one check control.
  if (input.awaiting) return { kind: 'WAITING', heading: PENDING_TEXT.headingWaiting, title: null, tone: 'neutral', inFlight: true, showsReservedPromotion: !!reserved,
    intro: ['ระบบตรวจให้อัตโนมัติ ไม่ต้องจ่ายซ้ำ', ...reservedLine],
    steps: input.canCheck ? [check('primary', PENDING_TEXT.labelCheck, [])] : [] };

  // The provider has the money (paid, then applying or held) or a promotion's renewal is being set up: one check, never a way to pay again and never
  // a way to throw the payment away. (The API never opens a Checkout that can be ended on top of a paid one; this keeps the words true if a state ever did.)
  // A renewal being set up is already said by the promotion's own box ("จ่ายแล้ว … ไม่ต้องจ่ายซ้ำ"), so only received money carries the title.
  if (input.moneyReceived || input.renewalSetup) return { kind: 'RECEIVED', heading: input.moneyReceived && !input.deferred ? input.held ? 'ได้รับเงินแล้ว ทีมงานกำลังตรวจสอบ' : PENDING_TEXT.titleReceived : null, title: null, tone: 'ok', intro: input.moneyReceived ? ['ไม่ต้องจ่ายซ้ำ'] : [], inFlight: true,
    showsReservedPromotion: false, steps: input.canCheck ? [check('primary', PENDING_TEXT.labelCheck, [])] : [] };

  // An open payment page: continue it, check it, or end it.
  if (input.canEnd) {
    const state = input.paymentState;
    const checkFirst = state === 'UNKNOWN' || input.unconfirmed;
    const said = state === 'ACTION_REQUIRED' ? OPEN_INTRO.ACTION_REQUIRED
      : state === 'PENDING' || state === 'FAILED' ? OPEN_INTRO.PENDING : OPEN_INTRO.OTHER;
    // The page's old "ยังยืนยันผลไม่ได้ …" paragraph said this beside the block, whatever the state; the team is the way out where the answer never came.
    const intro = checkFirst ? PENDING_TEXT.unknownDetail : said;
    // Money is never asked for twice: the way back to the payment page exists only while nothing is known to be paid.
    const resume = input.canResume && state !== 'PAID';
    const lead = checkFirst ? 'check' : resume ? 'continue' : 'check';
    const steps: PendingStep[] = [];
    const checkStep = input.canCheck ? check(lead === 'check' ? 'primary' : 'secondary',
      lead === 'check' || state !== 'PENDING' ? PENDING_TEXT.labelCheck : PENDING_TEXT.labelPaidCheck,
      []) : null;
    const continueStep: PendingStep | null = resume ? { key: 'continue', label: PENDING_TEXT.labelContinue, emphasis: lead === 'continue' ? 'primary' : 'secondary',
      caption: lead !== 'continue' ? ['ใช้เมื่อแน่ใจว่ายังไม่ได้จ่าย เปิดหน้าจ่ายเงินเดิมเพื่อจ่ายให้เสร็จ'] : [] } : null;
    for (const step of lead === 'check' ? [checkStep, continueStep] : [continueStep, checkStep]) if (step) steps.push(step);
    // Giving the payment up is quiet and last. One tap for an unpaid page; the confirmation stays for an outcome that is unknown or needs action.
    steps.push({ key: 'cancel', emphasis: 'quiet', label: PENDING_TEXT.labelCancel,
      caption: [...(reserved ? [input.oneTap && !input.unconfirmed ? RIGHT_BACK : `ถ้ายังไม่ได้จ่าย ${RIGHT_BACK}`] : []), ...(input.hasPackage ? [PACKAGE_KEPT] : [])] });
    return { kind: 'OPEN', heading: checkFirst ? PENDING_TEXT.headingUnknown : PENDING_TEXT.titleOpen, title: null, tone: 'attention', intro: [intro, ...(input.unconfirmed ? [CONTACT] : []), ...reservedLine], steps, inFlight: true, showsReservedPromotion: !!reserved };
  }

  if (!input.canCheck) return null;

  // An attempt is being checked and there is nothing to continue or end yet (the page is not created, or the outcome is unknown). The heading says "checking"; the intro says what that
  // asks of the buyer (do not start another) without saying "checking" again.
  if (input.hasAttempt && ((input.unconfirmed && input.paymentState !== 'PAID') || ['PENDING', 'UNKNOWN', 'ACTION_REQUIRED'].includes(input.paymentState))) {
    const sure = input.paymentState === 'UNKNOWN' || input.unconfirmed;
    return { kind: 'CHECKING', heading: sure ? PENDING_TEXT.headingUnknown : PENDING_TEXT.headingChecking, title: null, tone: 'neutral', inFlight: true, showsReservedPromotion: !!reserved,
      intro: [sure ? PENDING_TEXT.unknownDetail : 'ระบบถามผู้ให้บริการรับเงินอยู่ ยังไม่ต้องเริ่มรายการใหม่', ...(input.unconfirmed ? [CONTACT] : []), ...reservedLine],
      steps: [check('primary', PENDING_TEXT.labelCheck, [])] };
  }

  // Only the return attempt can establish a failed purchase; a historic subscription charge cannot.
  const failed = input.failed, retry = failed && input.canPurchase;
  return { kind: failed ? 'FAILED' : 'RECHECK', heading: failed ? 'จ่ายเงินไม่สำเร็จ' : null, title: failed ? null : PENDING_TEXT.titleLast, tone: 'neutral', inFlight: false, showsReservedPromotion: false,
    intro: retry ? ['เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้'] : failed && input.salesClosed ? ['ยังไม่เปิดรับการจ่ายเงินใหม่ ลองอีกครั้งภายหลัง'] : [],
    steps: retry ? [] : [check('secondary', PENDING_TEXT.labelCheck, [])] };
}

/**
 * Answers that say the payment on screen is no longer the one in progress: a Checkout that was never started and has been ended (its promotion
 * right given back), a request to end it that found it changed meanwhile, or no such open payment any more. The banner says so, and the page
 * reads the status again in place so the block and its buttons go away instead of offering the same refused button again.
 * Not here: "still being checked" answers (BILLING_CHECKOUT_PENDING, BILLING_PURCHASE_PENDING) — that payment is not over.
 */
export const PAYMENT_OVER_CODES: readonly string[] = ['BILLING_CHECKOUT_NOT_STARTED', 'CONTROL_PREVIEW_STALE'];
export function paymentIsOver(error: unknown): boolean {
  const code = apiErrorCode(error);
  return (!!code && PAYMENT_OVER_CODES.includes(code)) || errorStatus(error) === 404;
}
