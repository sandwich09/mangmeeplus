import type { BillingStatus } from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import { errorStatus } from './billing-error-text';

/**
 * The block of choices on the package page while a payment of this shop is unfinished, in flight or being checked (round 3 of the promotion
 * work: four loose buttons with no order, no reason and no sign of which one a buyer needs). The page computes the plain flags it always
 * computed and only draws what this returns: ONE block with a title for the state, an opening sentence that says what is waiting, and the
 * choices in the order a buyer most likely wants them, each with a line that says what it does and when to use it.
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
  /** A promotion's renewal is still being set up after the payment (`promotionBlock.checking`). */
  renewalSetup: boolean;
  /** The return page's own attempt failed. */
  failed: boolean;
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
  /** null: the card already says it (waiting for the first answer), so the block adds no heading of its own. */
  title: string | null;
  intro: string[];
  steps: PendingStep[];
  /** The generic "choose a package" button must not show while a payment of this shop is open or in flight. */
  hideChoosePackage: boolean;
  /** The no-package box's invitation to start a purchase, and what stands there instead (null = nothing). */
  hidePurchaseHint: boolean;
  pointer: string | null;
  /** The reserved promotion right is said in `intro`, so the separate green box says nothing more. */
  showsReservedPromotion: boolean;
  tone: 'attention' | 'ok' | 'neutral';
};

export const PENDING_TEXT = {
  titleOpen: 'มีรายการชำระเงินที่ยังไม่เสร็จ',
  titleReceived: 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ',
  titleChecking: 'กำลังตรวจรายการชำระเงิน',
  titleLast: 'ผลการชำระเงินล่าสุด',
  /** The region's name when the block shows no heading of its own. */
  regionName: 'ตรวจผลการชำระเงิน',
  labelContinue: 'ชำระเงินต่อ',
  /** The buyer's own claim, used where the check is the second choice and the payment is unpaid as far as the system knows. */
  labelPaidCheck: 'ชำระแล้ว ตรวจผลการชำระเงิน',
  labelCheck: 'ตรวจผลการชำระเงิน',
  labelCancelNew: 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่',
  labelCancel: 'ยกเลิกรายการนี้',
  /** The two-step end, kept: the provider is asked before a new purchase can start. */
  confirmEnd: 'ยกเลิกรายการนี้ใช่ไหม? ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงินก่อน จึงเริ่มเลือกแพ็กเกจใหม่ได้',
  confirmYes: 'ยืนยันยกเลิกรายการนี้',
  confirmNo: 'ยังไม่ยกเลิก',
} as const;

const OPEN_INTRO = {
  PENDING: 'เปิดหน้าชำระเงินไว้แล้ว แต่ระบบยังไม่ได้รับผลการชำระเงิน',
  UNKNOWN: 'ระบบยังยืนยันผลการชำระเงินรายการนี้ไม่ได้',
  ACTION_REQUIRED: 'การชำระเงินรายการนี้ยังต้องทำขั้นตอนเพิ่มที่หน้าชำระเงิน',
  FAILED: 'ระบบแจ้งว่าการเก็บเงินครั้งล่าสุดไม่สำเร็จ และหน้าชำระเงินนี้ยังเปิดค้างอยู่',
  UNCONFIRMED: 'กลับจากหน้าชำระเงินแล้ว แต่ระบบยังยืนยันผลการชำระเงินไม่ได้',
  OTHER: 'มีหน้าชำระเงินที่เปิดค้างอยู่',
} as const;
const reservedSentence = (name: string) => `จองสิทธิ์โปรโมชั่น ${name} ไว้ให้รายการนี้แล้ว สิทธิ์เริ่มใช้เมื่อชำระเงินสำเร็จ`;
const PACKAGE_KEPT = 'แพ็กเกจที่ใช้อยู่ไม่เปลี่ยน';
const RIGHT_BACK = 'สิทธิ์โปรโมชั่นที่จองไว้จะถูกคืน เลือกใช้ใหม่ได้ถ้าโปรโมชั่นยังเปิดอยู่';

export function pendingPayment(input: PendingPaymentInput): PendingPayment | null {
  const reserved = input.reservedPromotion, reservedLine = reserved ? [reservedSentence(reserved)] : [];
  const none = { hideChoosePackage: false, hidePurchaseHint: false, pointer: null, showsReservedPromotion: false };
  const check = (emphasis: PendingStep['emphasis'], label: string, caption: string[]): PendingStep => ({ key: 'check', label, caption, emphasis });

  // Back from the payment page and the first answer is still pending: the card already says "รอผล … ไม่ต้องชำระซ้ำ" for a shop with no package, so the
  // block adds no heading and no repeat of it; the one check control is all that is left.
  if (input.awaiting) return { kind: 'WAITING', title: null, tone: 'neutral', hideChoosePackage: true, hidePurchaseHint: true, pointer: null, showsReservedPromotion: !!reserved,
    intro: [...(input.hasPackage ? ['กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน ระบบตรวจผลให้อัตโนมัติ ไม่ต้องชำระซ้ำ'] : []), ...reservedLine],
    steps: input.canCheck ? [check('secondary', PENDING_TEXT.labelCheck, ['กดเมื่ออยากให้ตรวจผลทันที'])] : [] };

  // The provider has the money (paid, then applying or held) or a promotion's renewal is being set up: one quiet check, never a way to pay again and never
  // a way to throw the payment away. (The API never opens a Checkout that can be ended on top of a paid one; this keeps the words true if a state ever did.)
  if (input.moneyReceived || input.renewalSetup) return { kind: 'RECEIVED', title: PENDING_TEXT.titleReceived, tone: 'ok', intro: [], hideChoosePackage: true, hidePurchaseHint: true,
    pointer: PENDING_TEXT.titleReceived, showsReservedPromotion: false, steps: input.canCheck ? [check('secondary', PENDING_TEXT.labelCheck, ['กดเมื่ออยากตรวจผลล่าสุด'])] : [] };

  // An open payment page: continue it, check it, or end it.
  if (input.canEnd) {
    const state = input.paymentState;
    const checkFirst = state === 'UNKNOWN' || input.unconfirmed;
    const intro = state === 'UNKNOWN' ? OPEN_INTRO.UNKNOWN : input.unconfirmed ? OPEN_INTRO.UNCONFIRMED : state === 'ACTION_REQUIRED' ? OPEN_INTRO.ACTION_REQUIRED
      : state === 'FAILED' ? OPEN_INTRO.FAILED : state === 'PENDING' ? OPEN_INTRO.PENDING : OPEN_INTRO.OTHER;
    // Money is never asked for twice: the way back to the payment page exists only while nothing is known to be paid.
    const resume = input.canResume && state !== 'PAID';
    const lead = checkFirst ? 'check' : resume ? 'continue' : 'check';
    const steps: PendingStep[] = [];
    const checkStep = input.canCheck ? check(lead === 'check' ? 'primary' : 'secondary',
      lead === 'check' || state !== 'PENDING' ? PENDING_TEXT.labelCheck : PENDING_TEXT.labelPaidCheck,
      lead === 'check' ? [checkFirst ? 'ระบบยังยืนยันผลจากผู้ให้บริการรับชำระเงินไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ' : 'ให้ระบบถามผู้ให้บริการรับชำระเงินอีกครั้งว่ามีผลล่าสุดหรือไม่']
        : [state === 'ACTION_REQUIRED' ? 'กดเมื่อทำขั้นตอนที่หน้าชำระเงินเสร็จแล้วแต่หน้านี้ยังไม่เปลี่ยน' : 'กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน']) : null;
    const continueStep: PendingStep | null = resume ? { key: 'continue', label: PENDING_TEXT.labelContinue, emphasis: lead === 'continue' ? 'primary' : 'secondary',
      caption: [lead !== 'continue' ? 'ใช้เมื่อแน่ใจว่ายังไม่ได้ชำระ เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'
        : state === 'ACTION_REQUIRED' ? 'เปิดหน้าชำระเงินเดิมเพื่อทำขั้นตอนที่เหลือให้เสร็จ' : state === 'FAILED' ? 'เปิดหน้าชำระเงินเดิมเพื่อลองชำระอีกครั้ง' : 'เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'] } : null;
    for (const step of lead === 'check' ? [checkStep, continueStep] : [continueStep, checkStep]) if (step) steps.push(step);
    // Giving the payment up is quiet and last. One tap for an unpaid page; the confirmation stays for an outcome that is unknown or needs action.
    steps.push({ key: 'cancel', emphasis: 'quiet', label: input.oneTap ? PENDING_TEXT.labelCancelNew : PENDING_TEXT.labelCancel,
      caption: [input.oneTap ? 'รายการเดิมจะถูกยกเลิก' : 'ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงินก่อน จึงเลือกแพ็กเกจใหม่ได้',
        ...(reserved ? [input.oneTap ? RIGHT_BACK : `ถ้ายังไม่ได้ชำระ ${RIGHT_BACK}`] : []), ...(input.hasPackage ? [PACKAGE_KEPT] : [])] });
    return { kind: 'OPEN', title: PENDING_TEXT.titleOpen, tone: 'attention', intro: [intro, ...reservedLine], steps, hideChoosePackage: true, hidePurchaseHint: true,
      pointer: 'มีรายการชำระเงินที่ยังไม่เสร็จ ดูตัวเลือกด้านล่าง', showsReservedPromotion: !!reserved };
  }

  if (!input.canCheck) return null;

  // An attempt is being checked and there is nothing to continue or end yet (the page is not created, or the outcome is unknown).
  if (input.hasAttempt && ['PENDING', 'UNKNOWN', 'ACTION_REQUIRED'].includes(input.paymentState)) {
    const sure = input.paymentState === 'UNKNOWN' || input.unconfirmed;
    return { kind: 'CHECKING', title: PENDING_TEXT.titleChecking, tone: 'neutral', hideChoosePackage: true, hidePurchaseHint: true, showsReservedPromotion: !!reserved,
      pointer: 'กำลังตรวจรายการชำระเงิน ยังไม่ต้องเริ่มรายการใหม่',
      intro: ['ระบบกำลังตรวจรายการชำระเงินนี้กับผู้ให้บริการรับชำระเงิน ยังไม่ต้องเริ่มรายการใหม่', ...reservedLine],
      steps: [check(sure ? 'primary' : 'secondary', PENDING_TEXT.labelCheck, [sure ? 'ระบบยังยืนยันผลไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ' : 'กดเพื่อให้ระบบตรวจผลล่าสุดกับผู้ให้บริการรับชำระเงิน'])] };
  }

  // Nothing is in flight; the check control stays, with a sentence that is true whatever happened before. The way to a new purchase stays too.
  const failed = input.paymentState === 'FAILED' || input.failed;
  return { kind: failed ? 'FAILED' : 'RECHECK', title: PENDING_TEXT.titleLast, tone: 'neutral', ...none,
    intro: failed ? ['ผู้ให้บริการรับชำระเงินแจ้งว่าการเก็บเงินครั้งล่าสุดไม่สำเร็จ'] : [],
    steps: [check('secondary', PENDING_TEXT.labelCheck, [failed ? 'กดเมื่อจ่ายเงินแล้ว เพื่อตรวจผลล่าสุดอีกครั้ง' : 'ให้ระบบถามผู้ให้บริการรับชำระเงินอีกครั้งว่ามีผลล่าสุดหรือไม่'])] };
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
