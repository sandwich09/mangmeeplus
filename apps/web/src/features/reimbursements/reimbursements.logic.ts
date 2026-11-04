// Pure client-side helpers for the reimbursement forms (mirror server rules for UX only).

import {
  REIMBURSEMENT_PROJECTION_VOIDED_MESSAGE,
  REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS, REIMBURSEMENT_DUPLICATE_BLOCK_LABEL, reimbursementDuplicateWait, reimbursementDuplicateReasonText as sharedDuplicateReasonText, reimbursementDuplicateBlockNotice as sharedDuplicateBlockNotice, EXPENSE_VOID_REASON_MIN_LENGTH, REIMBURSEMENT_PAYMENT_SLIP_MAX_FILES, REIMBURSEMENT_SYSTEM_WAIT_LABEL, isReimbursementClaimApprover,
  reimbursementIncurredDateError, reimbursementPaymentSlipRequired, todayCivilDate, isFuturePaymentDate, PAYMENT_DATE_IN_FUTURE,
  reimbursementPaymentReferenceRequired as paymentReferenceRequired, REIMBURSEMENT_PAYMENT_REFERENCE_TEXT,
  TAX_FORM_SHORT_NAMES,
  type ReimbursementHubBucket, type ReimbursementHubSummary,
} from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage, translateApiError as sharedTranslateApiError } from '@/common/api/api-error-message';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth } from '@/common/i18n/thai-date';
import {
  claimStatusBadge, claimReturnedText, CLAIM_SIGN_LABEL, CLAIM_SIGNATURE_ROLE_LABELS, claimSignAction, CURRENT_DESK_LABELS, DUPLICATE_STATUS_LABELS, currentDeskText, ERROR_CODE_LABELS,
  canUploadSignedCopy, canVoidRecordedPayment, claimIsBeingCancelled, claimSignatureSlots, eligibleSignatureRoles, paymentDeskText, reimbursementOwnActions,
  POLICY_TAB_LABEL, SELF_APPROVAL_SWITCH_LABEL,
  type ClaimSignatureRole,
} from './reimbursements.model';
import { payoutComparableText } from './reimbursement-payout.logic';
// The payment step's side of the payout (kept as its own imports, apart from the blocks above).
import { looksLikeAccountNumber, maskedPayoutAccount, reimbursementPaymentHowText, type ReimbursementPaymentRule } from '@watchdog-bms/contracts';
import { PAYMENT_VOIDED_LABEL } from './reimbursements.model';
import {
  MISMATCH_REASON_HAS_ACCOUNT_NUMBER, MISMATCH_REASON_REQUIRED, PAID_DIFFERENTLY_LABEL, PAYER_CONFIRMATION_REQUIRED, REQUESTER_SELF_ATTESTED, type PaymentFormPayout,
} from './reimbursement-payout.logic';
// The payout account correction round (payout spec §14): its own imports, apart from the blocks above.
import {
  PAYOUT_METHOD_TEXT, SIGNED_COPY_BEFORE_CORRECTION_LABEL, payoutCorrectionAccountText, payoutCorrectionAnsweredText, payoutCorrectionSentBackText, payoutKindHeldAt, payoutRoundAnswer,
  payoutRoundTexts,
} from './reimbursement-payout.logic';
// The words of a round are the contracts' own, chosen there from what the claim holds and from what was answered.
import { REIMBURSEMENT_PAYOUT_ROUND_TEXTS, reimbursementPayoutRoundApproverNote, reimbursementPayoutRoundApproves, reimbursementPayoutRoundStatus } from '@watchdog-bms/contracts';

/**
 * The API answers with stable error codes, sometimes several joined by commas
 * (`validateLines` returns a list). Translate what we know — this feature's own
 * codes first, then the shared cross-feature map — and pass anything else
 * through the shared safe fallback so implementation details never reach the screen.
 */
export function errorMessage(
  raw: string,
  source: unknown = Object.assign(new Error(raw), { kind: 'unknown' }),
): string {
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return apiErrorMessage(source);
  return parts.map((part) => ERROR_CODE_LABELS[part] ?? cancellationRefusalText(part) ?? translateApiError(part)
    ?? apiErrorMessage(parts.length === 1 ? source : Object.assign(new Error(part), { kind: 'unknown' }))).join(' · ');
}

// ---- A cancellation that cannot go through, or has not completed (audit B3) ----

/** "ก.ย. 2569" for an accounting period key such as 2026-09; nothing for a key this page cannot read. */
const periodText = (periodKey: unknown) => (typeof periodKey === 'string' && /^\d{4}-\d{2}$/.test(periodKey) ? ` (รายจ่ายเดือน ${formatThaiMonth(`${periodKey}-01`)})` : '');

/**
 * What stands in the way of a cancellation, in words a person can act on. One text for the claim's
 * step note (a cancellation that was started) and for the refusal of a cancel that meets the same wall.
 */
export function cancellationBlockerText(blocker: { code?: unknown; periodKey?: unknown; formType?: unknown } | null | undefined): string | null {
  switch (blocker?.code) {
    case 'reason_too_short': return 'เหตุผลที่ระบุไว้สั้นเกินไป ระบบจึงยกเลิกรายการค่าใช้จ่ายของใบนี้ไม่ได้';
    case 'accounting_period_locked':
      return `ยกเลิกใบเบิกไม่ได้${periodText(blocker.periodKey)} ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ`;
    case 'tax_period_locked': {
      const form = Object.entries(TAX_FORM_SHORT_NAMES).find(([key]) => key === blocker.formType)?.[1];
      return `ยกเลิกใบเบิกไม่ได้${form ? ` (${form})` : ''}${periodText(blocker.periodKey)} ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ`;
    }
    case 'posting_unresolved': return 'ยกเลิกใบเบิกไม่ได้ ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ';
    case 'expense_not_voidable': return 'รายการค่าใช้จ่ายของใบนี้อยู่ในสถานะที่ระบบยกเลิกให้ไม่ได้ ติดต่อผู้ดูแลระบบ';
    default: return null;
  }
}

/** The API's refusal of a cancel the expense void would refuse: `reimbursement_cancellation_<blocker>` or `…:<period>`. */
function cancellationRefusalText(code: string): string | null {
  const match = /^reimbursement_cancellation_(accounting_period_locked|tax_period_locked|posting_unresolved|expense_not_voidable)(?::(.+))?$/.exec(code);
  const text = match && cancellationBlockerText({ code: match[1], periodKey: match[2] });
  return text || null;
}

/**
 * The step note of a claim whose cancellation was started and has not completed: who started it and
 * when, why it has not completed, and what this viewer can do. The claim is with the system meanwhile
 * (the same words as its "อยู่ที่" line and the LINE backlog), and the API takes no other decision on it.
 */
export function pendingCancellationNote(pending: any, refusal?: string): string {
  const started = [pending?.startedByName, 'เริ่มยกเลิกใบเบิกนี้', pending?.startedAt && `เมื่อ ${formatThaiDateTime(pending.startedAt)}`].filter(Boolean).join(' ');
  const attestationRequired = pending?.blocker?.code === 'certificate_attestation_required';
  const blocker = refusal ?? (attestationRequired ? pending.blocker.message ?? REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.attestationRequired : cancellationBlockerText(pending?.blocker));
  const reasonBlocks = pending?.blocker?.code === 'reason_too_short';
  // A closed period or an unposted journal can be put right; a filed tax period or an unvoidable record cannot.
  const fixable = ['accounting_period_locked', 'posting_unresolved'].includes(pending?.blocker?.code);
  const next = pending?.canResume !== true ? 'ผู้ที่ทำต่อได้คือผู้เบิกหรือผู้มีสิทธิ์ตรวจการเงิน'
    : reasonBlocks ? `กดทำต่อเพื่อยกเลิก แล้วระบุเหตุผลใหม่อย่างน้อย ${EXPENSE_VOID_REASON_MIN_LENGTH} ตัวอักษร`
      : !blocker ? 'ระบบจะทำต่อให้เองภายในไม่กี่นาที หรือกดทำต่อเพื่อยกเลิกได้เลย'
        : fixable ? 'เมื่อแก้ไขแล้ว กดทำต่อเพื่อยกเลิก' : null;
  const takeBack = pending?.canWithdraw === true ? 'ถ้าไม่ต้องการยกเลิกแล้ว กดถอนการยกเลิก ใบจะกลับไปเดินต่อตามเดิม'
    : pending?.canResume === true ? 'ระบบยกเลิกรายการค่าใช้จ่ายไปบางส่วนแล้ว จึงถอนการยกเลิกไม่ได้' : null;
  return [
    `กำลังยกเลิกใบเบิก ${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`,
    `${started}${blocker ? ` · ${blocker}` : ''}`,
    next, takeBack,
    'ระหว่างนี้ยังอนุมัติ ส่งกลับให้แก้ แก้ไข หรือบันทึกจ่ายใบนี้ไม่ได้',
  ].filter(Boolean).join(' · ');
}

// ---- A claim that was decided and has not moved on (audit B4) ----

const SYSTEM_WILL_CARRY_ON = 'ระบบจะทำต่อให้เองภายในไม่กี่นาที';

/**
 * The step note of a claim whose decision is on record and waits for the system to carry it out: what
 * was decided, what is still missing, and who can press ดำเนินการต่อ. An approved claim is with the
 * system (its "อยู่ที่" line and the LINE backlog say the same); a claim nobody had to approve waits at
 * the payment desk, and whoever may record its payment is who can carry it on.
 */
export function awaitingSystemNote(detail: any, approvedBy?: string): string {
  const waiting = detail?.awaitingSystem;
  const notReady = 'ระบบยังเตรียมรายการสำหรับจ่ายเงินของใบนี้ไม่เสร็จ จึงยังบันทึกจ่ายไม่ได้';
  if (waiting?.kind === 'NO_APPROVAL_NEEDED') {
    const payers = paymentDeskText(detail?.paymentDesk) ?? CURRENT_DESK_LABELS.PAYMENT;
    return [
      'ใบนี้ไม่ต้องอนุมัติตามนโยบาย', notReady,
      waiting.canResume === true ? `${SYSTEM_WILL_CARRY_ON} หรือกดทำต่อได้เลย` : `${SYSTEM_WILL_CARRY_ON} ถ้ายังค้างอยู่ ${payers} กดทำต่อได้`,
    ].join(' · ');
  }
  return [
    `${approvedBy ? `${approvedBy} อนุมัติแล้ว` : 'อนุมัติแล้ว'} ${REIMBURSEMENT_SYSTEM_WAIT_LABEL}`, notReady,
    waiting?.canResume === true ? `${SYSTEM_WILL_CARRY_ON} หรือกดทำต่อได้เลย ไม่ต้องอนุมัติซ้ำ`
      : `${SYSTEM_WILL_CARRY_ON} ไม่ต้องอนุมัติซ้ำ ถ้ายังค้างอยู่ ผู้อนุมัติใบนี้กดทำต่อได้`,
  ].join(' · ');
}

/**
 * Object-aware variant for thrown fetch errors: a deny-by-default guard 403 carries only a
 * stable `code` (its message is the synthetic "API error 403"), so consult the code first,
 * then fall back to the message-string translation above.
 */
export function errorText(e: unknown): string {
  const code = apiErrorCode(e);
  const viaCode = typeof code === 'string' ? ERROR_CODE_LABELS[code] ?? translateApiError(code) : null;
  const source = e as { message?: unknown; details?: { message?: unknown } } | null | undefined;
  const message = source?.details?.message ?? source?.message;
  if (typeof code === 'string' && (!code.includes(':') || (typeof message === 'string' && /[ก-๙]/.test(message))) && (/^(reimbursement_cancellation_|expense_)/.test(code) || ['certificate_permission_missing', 'certificate_issued', 'posting_unresolved', 'posting_state_changed', 'accounting_period_locked', 'tax_period_locked', 'tax_period_filed'].includes(code))) return apiErrorMessage(e);
  if (code === 'duplicate_unresolved' || code === 'duplicate_confirmed') return apiErrorMessage(e);
  if (viaCode) return viaCode;
  return errorMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', e);
}

/**
 * The API's sentence for a note or a reason that looks like an account number, exactly as `errorText` gives it for
 * that refusal: a form that knows the sentence shows it at the field it is about, and not in a banner above the form.
 */
export const NOTE_HAS_ACCOUNT_NUMBER = errorText(new Error('note_contains_account_number'));

export const STALE_APPROVAL_CODE = 'stale_approval_snapshot';

/** True when the API rejected an approval because the claim changed after submit (HTTP 409). */
export function isStaleApprovalError(e: unknown): boolean {
  return e instanceof Error && e.message.includes(STALE_APPROVAL_CODE);
}

/** Signing refused because the signer has no ready saved signature — answered with a link, not a banner. */
export function isMissingSavedSignatureError(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'claim_saved_signature_required'
    || (e instanceof Error && e.message.includes('claim_saved_signature_required'));
}

/**
 * Owner 2026-09-21: submit found nobody who may approve the claim. Instead of a bare refusal, say
 * who can fix it where it failed: a policy manager picks an approver in ตั้งค่านโยบาย (the page
 * offers the link), anyone else asks the owner. Null for every other error.
 */
export function approverNotReadyHelp(e: unknown, permissions: readonly string[]): { text: string; policyLink: boolean } | null {
  if (!(e instanceof Error && e.message.includes('reimbursement_approver_not_ready'))) return null;
  const policyLink = permissions.includes('reimbursement.policy.manage');
  return {
    policyLink,
    text: policyLink
      ? `ยังไม่มีผู้อนุมัติใบเบิกนี้ เลือกบทบาทผู้อนุมัติใน${POLICY_TAB_LABEL} (บทบาทนั้นต้องมีสิทธิ์อนุมัติการเบิก) แล้วกลับมากดส่งอนุมัติอีกครั้ง`
      : `ยังไม่มีผู้อนุมัติใบเบิกนี้ ขอให้เจ้าของกิจการเลือกผู้อนุมัติใน${POLICY_TAB_LABEL} หรือเพิ่มสิทธิ์อนุมัติการเบิกให้บทบาทของคุณ แล้วกดส่งอนุมัติอีกครั้ง`,
  };
}

export type ApprovalFieldDiff = { key: string; label: string; before: string; after: string; changed: boolean };

/** Values the approval-queue row and the fresh detail can both provide. */
export type ApprovalComparable = {
  reason?: unknown; amount?: unknown; currency?: unknown; categoryLabel?: unknown; lineCount?: unknown; payout?: unknown;
};

/**
 * Compares what the approver was looking at against the claim's current state.
 * Only covers the fields the queue row carries — see the decision record: a line-text or
 * date-only edit changes the server hash without changing any of these.
 */
export function diffApprovalFields(before: ApprovalComparable, after: ApprovalComparable): ApprovalFieldDiff[] {
  const rows: Array<{ key: keyof ApprovalComparable; label: string }> = [
    { key: 'reason', label: 'เหตุผล' },
    { key: 'amount', label: 'จำนวนเงิน' },
    { key: 'currency', label: 'สกุลเงิน' },
    { key: 'categoryLabel', label: 'หมวด' },
    { key: 'lineCount', label: 'จำนวนรายการ' },
    // Where the money goes back to: an account changed after the list or page loaded is named here.
    { key: 'payout', label: 'รับเงินคืนทาง' },
  ];
  return rows.map(({ key, label }) => {
    const b = before[key] == null || before[key] === '' ? '—' : String(before[key]);
    const a = after[key] == null || after[key] === '' ? '—' : String(after[key]);
    return { key: String(key), label, before: b, after: a, changed: b !== a };
  });
}

/** A queue row or a fresh detail in the words the stale-approval dialog prints: money with its unit, never a key. */
export function approvalComparable(claim: any, lineCount: number): ApprovalComparable {
  return {
    reason: claim?.reason, amount: money(claim?.amount, claim?.currency), currency: currencyWord(claim?.currency),
    categoryLabel: categoryText(claim?.categoryLabelSnapshot), lineCount, payout: payoutComparableText(claim),
  };
}

export { paymentReferenceRequired };

/**
 * Client-side validation of the full-payment form. Returns an error key or null.
 * The method is never chosen for the payer, and the slip rule is the API's own
 * (`reimbursementPaymentSlipRequired`), so the form and the server refuse the same payments.
 */
export function validatePaymentForm(input: {
  paidAmount: string;
  paidAt?: string;
  outstandingAmount: string;
  paymentMethod: string;
  paymentReference?: string;
  hasSlip?: boolean;
  /** What the claim asks of this payment (the API's own rule) and what the payer gave. Omitted: nothing is asked. */
  payout?: { rule: ReimbursementPaymentRule; confirmed: boolean; mismatchReason: string };
}): string | null {
  return paymentFormProblem(input)?.text || null;
}

/** A field of the payment form a person can put right; `null` for a refusal no field of the form answers (the amount is not typed). */
export type PaymentFormField = 'method' | 'date' | 'reference' | 'slip' | 'confirmation' | 'mismatch';

/**
 * The first thing wrong with the payment form, as `validatePaymentForm` says it, with the field it is about: the form
 * says the sentence at that field, where it is put right, and not in a box above the buttons.
 */
export function paymentFormProblem(input: Parameters<typeof validatePaymentForm>[0]): { field: PaymentFormField | null; text: string } | null {
  const at = (field: PaymentFormField | null, text: string | null) => ({ field, text: text ?? '' });
  if (!input.paymentMethod) return at('method', 'เลือกวิธีจ่าย');
  if (input.paidAt && isFuturePaymentDate(input.paidAt)) return at('date', translateApiError(PAYMENT_DATE_IN_FUTURE.code));
  const paid = Number(input.paidAmount);
  const outstanding = Number(input.outstandingAmount);
  if (!(paid > 0)) return at(null, 'จำนวนเงินต้องมากกว่า 0');
  if (paid > outstanding) return at(null, 'จำนวนเงินเกินยอดที่อนุมัติ');
  if (paid !== outstanding) return at(null, 'ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น');
  if (paymentReferenceRequired(input.paymentMethod, input.hasSlip) && (!input.paymentReference || input.paymentReference.trim() === '')) {
    return at('reference', REIMBURSEMENT_PAYMENT_REFERENCE_TEXT.requiredMessage);
  }
  // The API's own words for the same refusal, so the form and the server say one thing.
  if (reimbursementPaymentSlipRequired(input.paymentMethod) && !input.hasSlip) return at('slip', translateApiError('payment_slip_required'));
  // Spec §12.4, asked in the API's order: the confirmation of the account, then the reason for
  // another method than the one asked for. The reason is shown on the payment row, so it takes the
  // API's own guard against an account number.
  if (input.payout?.rule.payoutConfirmation === 'required' && !input.payout.confirmed) return at('confirmation', PAYER_CONFIRMATION_REQUIRED);
  if (input.payout?.rule.mismatchReasonRequired) {
    if (!input.payout.mismatchReason.trim()) return at('mismatch', MISMATCH_REASON_REQUIRED);
    if (looksLikeAccountNumber(input.payout.mismatchReason)) return at('mismatch', MISMATCH_REASON_HAS_ACCOUNT_NUMBER);
  }
  return null;
}

// ---- Payment slips (หลักฐานการจ่ายเงินคืน) ----

/** "ไฟล์ PDF" or "ไฟล์รูปภาพ", from the name a file was attached under: what a person sees before opening it. */
export function attachedFileKindText(fileName: unknown): string {
  return /\.pdf$/iu.test(String(fileName ?? '')) ? 'ไฟล์ PDF' : 'ไฟล์รูปภาพ';
}

/**
 * A file already on the claim that can serve as the slip of a payment, without uploading it again: its name, what it
 * is on this claim today, and what the page needs to open it before it is chosen.
 */
export type PaymentSlipChoice = {
  attachmentId: string;
  kind: 'previous-slip' | 'signed-copy';
  /** The name the payer reads: the file's own name, or which voided payment it was the slip of. */
  label: string;
  /** What the file is on this claim today: its type, where it is filed, and what its attacher declared it to be. */
  what: string;
  /** signed-copy: the file's name, for opening it as an attachment of the claim. */
  fileName?: string;
  /** previous-slip: the payment it is the slip of, for opening it through the slip's own endpoint. */
  paymentId?: string;
};

/**
 * Files already attached to the claim that the payer may use as the slip: slips of payments since
 * voided (the same transfer, recorded again), and files in ใบเบิกที่เซ็นแล้ว (a slip attached there
 * by mistake). The API accepts exactly these two kinds beside a fresh slip upload.
 *
 * In the order a payer looks for a slip: what was a slip before, then the images among the signed copies, then
 * their PDFs. A slip is a picture far more often than a signed form is, and the form listed first was picked as
 * the slip (upgrade test 2026-10-02). Each says what it is, because a name alone did not.
 */
export function paymentSlipChoices(detail: any): PaymentSlipChoice[] {
  const choices: PaymentSlipChoice[] = [];
  const add = (choice: PaymentSlipChoice) => { if (!choices.some((row) => row.attachmentId === choice.attachmentId)) choices.push(choice); };
  for (const payment of detail?.payments ?? []) {
    if (payment.status !== 'VOIDED') continue;
    const slips: any[] = payment.slips ?? [];
    slips.forEach((slip, index) => add({
      attachmentId: slip.attachmentId, kind: 'previous-slip', paymentId: payment.id,
      label: `หลักฐานการจ่ายที่ยกเลิกแล้ว ${payment.paymentNo ?? ''}`.trim() + (slips.length > 1 ? ` (ไฟล์ที่ ${index + 1})` : ''),
      what: 'เคยเป็นหลักฐานการจ่ายที่ยกเลิกไปแล้ว ใช้กับการจ่ายครั้งนี้ได้ถ้าเป็นการโอนรายการเดียวกัน',
    }));
  }
  const copies: any[] = [...(detail?.signedCopies ?? [])];
  const isPdf = (copy: any) => /\.pdf$/iu.test(String(copy?.fileName ?? ''));
  for (const copy of [...copies.filter((row) => !isPdf(row)), ...copies.filter(isPdf)]) {
    add({
      attachmentId: copy.attachmentId, kind: 'signed-copy', fileName: copy.fileName, label: copy.fileName,
      what: `${attachedFileKindText(copy.fileName)} · ${copy.acknowledgedAt ? 'แนบไว้ที่ใบเบิกที่เซ็นแล้ว โดยยืนยันว่าเป็นใบเบิกที่เซ็นครบ'
        : copy.beforePayoutCorrection ? `แนบไว้ที่ใบเบิกที่เซ็นแล้ว เป็น${SIGNED_COPY_BEFORE_CORRECTION_LABEL}` : 'แนบไว้ที่ใบเบิกที่เซ็นแล้ว เป็นไฟล์แนบทั่วไป'}`,
    });
  }
  return choices;
}

/**
 * How many slips a payment carries. Every reader of the claim is told this much; which files they
 * are (`slips`) reaches only someone who may open them, so the count is never read off that list.
 */
export function paymentSlipCount(payment: any): number {
  return typeof payment?.slipCount === 'number' ? payment.slipCount : (payment?.slips ?? []).length;
}

/** A recorded payment takes more slips, up to the limit, from someone who may record payments. Add-only: there is no remove. */
export function canAttachPaymentSlip(payment: any, permissions: readonly string[]): boolean {
  return payment?.status === 'RECORDED' && permissions.includes('reimbursement.payment.record')
    && paymentSlipCount(payment) < REIMBURSEMENT_PAYMENT_SLIP_MAX_FILES;
}

/**
 * The payment a file moved out of ใบเบิกที่เซ็นแล้ว becomes the slip of: the one standing payment, when
 * this viewer may add to it and it has no slip yet. The move withdraws a "signed on paper"
 * declaration, so it is offered only for the case it exists for (a slip attached there by mistake,
 * on a payment that still lacks one), never as a second slip for a payment that already has its own.
 */
export function slipTargetPayment(detail: any, permissions: readonly string[]): any | undefined {
  const standing = (detail?.payments ?? []).filter((payment: any) => payment?.status === 'RECORDED').at(-1);
  return standing && canAttachPaymentSlip(standing, permissions) && paymentSlipCount(standing) === 0 ? standing : undefined;
}

/**
 * What whoever records payments is told on a file of ใบเบิกที่เซ็นแล้ว that no button speaks for (spec §16): a slip
 * attached there by mistake reads as a paper-signed copy, and the row said nothing of what to do about it.
 * Before the payment it is chosen as the slip in the payment form. Once the payment has a slip, no file moves any
 * more, and the page cannot know which file is which: the sentence is true either way. Nothing more is needed when the
 * slip on the payment is the real one; when it is not (the signed form was picked as the slip, and the real slip is
 * the file left on this row), the real one is attached at the payment row, which says "แนบหลักฐานการจ่ายเพิ่ม" for as long as the
 * payment takes another slip. Null where the row has its own button (a recorded payment with no slip), for a viewer
 * who records no payments, and for a claim that is at neither point.
 */
export function signedCopyMisfiledHint(detail: any, permissions: readonly string[]): string | null {
  if (!permissions.includes('reimbursement.payment.record') || slipTargetPayment(detail, permissions)) return null;
  const standing = (detail?.payments ?? []).filter((payment: any) => payment?.status === 'RECORDED').at(-1);
  if (standing) {
    const settled = 'ถ้าไฟล์นี้คือสลิปโอนเงินที่แนบผิดช่อง และสลิปที่แนบกับการจ่ายถูกต้องแล้ว ไม่ต้องทำอะไรเพิ่ม';
    // The second sentence names a control: it is said only while the payment row shows that control.
    return canAttachPaymentSlip(standing, permissions) ? `${settled} ถ้าสลิปที่แนบกับการจ่ายไม่ใช่สลิปจริง ให้กดเพิ่มเติมที่แถวการจ่าย แล้วเลือกแนบหลักฐานการจ่ายเพิ่ม แล้วแนบหลักฐานการจ่ายจริง` : settled;
  }
  return detail?.status === 'READY_FOR_PAYMENT' ? 'ถ้าไฟล์นี้คือสลิปโอนเงินที่แนบผิดช่อง ไม่ต้องแนบใหม่ ตอนบันทึกจ่ายเลือกไฟล์นี้เป็นสลิปได้' : null;
}

/**
 * What the payer confirms before a file leaves ใบเบิกที่เซ็นแล้ว to become a payment's slip (spec §16.2):
 * nothing is uploaded again, nothing moves it back, a "signed on paper" declaration made with that file
 * is withdrawn, and the file is from then on opened only by the slip's own readers.
 */
export function signedCopyMoveConfirmText(copy: { fileName?: string; acknowledgedAt?: string }, payment: { paymentNo?: string }): string {
  return [
    `ไฟล์ ${copy.fileName ?? 'นี้'} จะย้ายจากรายการใบเบิกที่เซ็นแล้ว ไปเป็นหลักฐานการจ่าย${payment.paymentNo ? ` ${payment.paymentNo}` : 'นี้'} โดยไม่ต้องอัปโหลดใหม่ และย้ายกลับไม่ได้`,
    ...(copy.acknowledgedAt ? ['ไฟล์นี้เคยถูกยืนยันว่าเป็นใบเบิกที่เซ็นครบ ระบบจะถอนการยืนยันนั้น ใบเบิกจะไม่นับว่าเซ็นบนกระดาษจากไฟล์นี้อีก'] : []),
    'หลังย้ายแล้ว ไฟล์นี้เปิดดูได้เฉพาะผู้เบิก ผู้อนุมัติของใบนี้ ผู้ที่บันทึกจ่ายได้ และผู้ตรวจการเงิน',
  ].join(' ');
}

/** The payment was rolled back because another write on the same claim got there first (409 from the payment lock). */
export function isLostPaymentRace(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'reimbursement_payment_state_changed'
    || (e instanceof Error && e.message.includes('reimbursement_payment_state_changed'));
}

/**
 * What the payment form says when saving fails. "โอนแล้ว" and "บันทึกสำเร็จ" are two things: an
 * uploaded slip is not a recorded payment, and a payer who has already transferred the money must
 * not be led to transfer it again (spec §12.2). The sentence gives ONE thing to do:
 *
 *  - a lost race: press save again. Nothing about reloading: that would throw away the uploaded slip
 *    and the form's key, the two things that make the next press the same payment;
 *  - any other conflict (the claim or its account changed since the page was loaded): the reason
 *    itself says to open the claim again, so nothing here says to press save on this page;
 *  - everything else (a field to fix, a failed connection): check and press save again.
 */
export function paymentSaveErrorMessage(stage: 'slip-upload' | 'record', error: unknown, slipKept: boolean): string {
  if (stage === 'slip-upload') return `อัปโหลดหลักฐานการจ่ายไม่สำเร็จ ระบบยังไม่ได้บันทึกจ่าย · ${errorText(error)}`;
  if (isLostPaymentRace(error)) return 'ยังบันทึกจ่ายไม่สำเร็จ เพราะมีการทำรายการกับใบนี้ในเวลาเดียวกัน กดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบหลักฐานการจ่ายหรือโอนเงินใหม่';
  const reason = errorText(error);
  if ((error as { code?: unknown } | null)?.code === 'duplicate_confirmed') return reason;
  if ((error as { status?: unknown } | null)?.status === 409) return `ยังบันทึกจ่ายไม่สำเร็จ · ${reason}`;
  return slipKept
    ? `แนบหลักฐานการจ่ายแล้ว แต่ยังบันทึกจ่ายไม่สำเร็จ · ${reason} · ตรวจข้อมูลแล้วกดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบหลักฐานการจ่ายหรือโอนเงินใหม่`
    : `ยังบันทึกจ่ายไม่สำเร็จ · ${reason}`;
}

/** What the payment form holds as its slip: a file picked but not sent yet, or one the API already holds. */
export type PaymentFormSlip = { file: File } | { attachmentId: string; name: string };

/**
 * The file of `paymentSlipChoices` the form holds as its slip. Undefined for a file the payer picked or uploaded, and
 * for none. The form's warning under a chosen signed copy and the confirmation the payment carries both read this.
 */
export function chosenPaymentSlipChoice(slip: PaymentFormSlip | null, choices: readonly PaymentSlipChoice[]): PaymentSlipChoice | undefined {
  return slip && 'attachmentId' in slip ? choices.find((choice) => choice.attachmentId === slip.attachmentId) : undefined;
}

/** What lives as long as one opened payment form, across every press of บันทึกจ่าย. */
export type PaymentFormSession = { idempotencyKey: string | null; saving: boolean };

export type PaymentFormSave =
  | { status: 'saved' }
  /** Nothing was sent, or the save failed. `text` is the plain-Thai sentence the form shows, never a raw error. */
  | { status: 'refused'; text: string; refreshClaim?: true }
  /** A press that arrived while an earlier one was still running. Nothing was done. */
  | { status: 'ignored' };

/**
 * One press of บันทึกจ่าย: check the form, upload the slip if it is still a picked file, then record
 * the payment with it. Kept out of the component so the order and the retries can be tested.
 *
 * - The slip is uploaded before the payment and handed back at once (`onSlipUploaded`): if recording
 *   then fails, the next press sends the same uploaded slip and uploads nothing again.
 * - The session's key is made on the first press and kept: a press after a lost answer is the same
 *   payment to the API, never a second one.
 * - A second press while the first is still running does nothing: no second upload, no second request.
 * - A signed copy chosen as the slip goes with the payer's confirmation that it leaves ใบเบิกที่เซ็นแล้ว for good
 *   (spec §16.2): the API refuses a declared copy without it, and nothing but that choice sends it.
 * - What the payer says about the account goes with it (spec §12.3): the account version the page
 *   shows, always, so a page loaded before the account changed is refused; the confirmation, only
 *   for the account it was ticked for; the reason, only when the method differs from the one asked for.
 */
export async function savePaymentForm(
  input: {
    form: { paidAmount: string; paymentMethod: string; paidAt: string; paymentReference: string };
    outstandingAmount: string;
    slip: PaymentFormSlip | null;
    /**
     * The files the form lists under "เลือกจากไฟล์ที่แนบไว้ในใบนี้". A signed copy chosen from them was chosen under the
     * note that it moves for good and loses its "signed on paper" declaration, so the payment carries that confirmation.
     */
    slipChoices?: readonly PaymentSlipChoice[];
    session: PaymentFormSession;
    /** The payout side of the form for the method chosen (`paymentFormPayout`). Omitted: the claim asks nothing of it. */
    payout?: PaymentFormPayout;
    /** What the payer ticked and typed: the key of the account the tick was given for, and the reason. */
    payer?: { confirmedFor: string; mismatchReason: string };
  },
  deps: {
    uploadSlip: (file: File) => Promise<string>;
    recordPayment: (body: Record<string, unknown>) => Promise<unknown>;
    onSlipUploaded: (slip: { attachmentId: string; name: string }) => void;
    newIdempotencyKey: () => string;
    /** The form's busy flag: true only while something is actually being sent. */
    onBusy?: (busy: boolean) => void;
  },
): Promise<PaymentFormSave> {
  const { form, slip, session, payout } = input;
  if (session.saving) return { status: 'ignored' };
  // A tick counts only for the account it was given for, and only while that account is the one to confirm.
  const confirmed = !!payout?.confirmation && input.payer?.confirmedFor === payout.confirmation.key;
  const mismatchReason = input.payer?.mismatchReason ?? '';
  const invalid = validatePaymentForm({
    ...form, outstandingAmount: input.outstandingAmount, hasSlip: slip !== null,
    ...(payout && { payout: { rule: payout.rule, confirmed, mismatchReason } }),
  });
  if (invalid) return { status: 'refused', text: invalid };

  session.saving = true;
  deps.onBusy?.(true);
  try {
    let slipAttachmentId = slip && 'attachmentId' in slip ? slip.attachmentId : undefined;
    if (slip && 'file' in slip) {
      try {
        slipAttachmentId = await deps.uploadSlip(slip.file);
      } catch (error) {
        return { status: 'refused', text: paymentSaveErrorMessage('slip-upload', error, false) };
      }
      deps.onSlipUploaded({ attachmentId: slipAttachmentId, name: slip.file.name });
    }
    session.idempotencyKey ??= deps.newIdempotencyKey();
    try {
      await deps.recordPayment({
        ...form, paidAt: new Date(form.paidAt).toISOString(), paymentReference: form.paymentReference || undefined,
        slipAttachmentId, idempotencyKey: session.idempotencyKey,
        ...(chosenPaymentSlipChoice(slip, input.slipChoices ?? [])?.kind === 'signed-copy' && { confirmSignedCopyWithdrawal: true }),
        ...(payout?.version !== undefined && { payoutDestinationVersion: payout.version }),
        ...(confirmed && { payoutConfirmed: true, ...(payout.confirmation!.defaultToken && { payoutDefaultToken: payout.confirmation!.defaultToken }) }),
        ...(payout?.rule.mismatchReasonRequired && { methodMismatchReason: mismatchReason.trim() }),
      });
    } catch (error) {
      return { status: 'refused', text: paymentSaveErrorMessage('record', error, slipAttachmentId !== undefined),
        ...(apiErrorCode(error) === 'duplicate_confirmed' && { refreshClaim: true as const }) };
    }
    return { status: 'saved' };
  } finally {
    session.saving = false;
    deps.onBusy?.(false);
  }
}

/**
 * Where "บันทึกจ่าย" on a finance-queue row leads. On a phone the payment form is never a dialog
 * (spec §12.2, §21): it opens in the payment step card of the claim's own page, where the claim's
 * files and the account to pay sit beside it.
 *
 * "Phone" is the hub's own answer, not a second measurement: the queue shows cards on a phone and a
 * table otherwise, and the press says which of the two it came from. So a screen the page lays out
 * as a phone never gets the dialog, whatever its width or orientation.
 */
export function quickPayTarget(layout: 'cards' | 'table', companyId: string, requestId: string):
  { kind: 'dialog' } | { kind: 'page'; href: string } {
  return layout === 'table'
    ? { kind: 'dialog' }
    : { kind: 'page', href: `/companies/${companyId}/reimbursements/${requestId}?pay=1` };
}

/**
 * Whether a finance-queue row offers "บันทึกจ่าย", on its table row and on its card alike: the claim
 * waits for payment, the viewer holds the pay right, and the claim has a branch. The payment endpoint
 * refuses a claim with no branch for everyone, and the claim page offers no button for one either.
 */
export function queueRowOffersPayment(
  row: { status?: string; branchId?: string | null; cancellationPending?: boolean; hasDuplicateBlocker?: boolean; duplicateReasons?: readonly string[] } | null | undefined,
  permissions: readonly string[],
): boolean {
  // A claim being cancelled is not paid (the API refuses it); its row says so and offers no payment.
  return row?.status === 'READY_FOR_PAYMENT' && !!row.branchId && !claimIsBeingCancelled(row) && !row.hasDuplicateBlocker && !row.duplicateReasons?.includes('EXPENSE_CONFIRMATION') && permissions.includes('reimbursement.payment.record');
}

/**
 * What an approval-queue row offers its viewer: from the row's own `approvalActions`, as the server resolved them.
 *
 * `onClaimPage`: the decision is made on the claim's own page, never from the row. A claim paid by transfer is
 * approved there, where its account is shown and attested. So is a claim in a payout account correction round
 * (payout spec §14.6), whatever its new receiving method: what is approved is the change of account, which a row
 * does not show. Such a row offers one way in for whoever decides the waiting step, and no "ส่งกลับให้แก้": a round's
 * new account is sent back to its requester, never rejected.
 */
export function approvalRowOffers(row: {
  approvalActions?: { canApprove?: boolean; canReject?: boolean } | null; payoutMethod?: string | null; payoutCorrectionPhase?: string | null;
  payoutCorrectionAnswer?: string | null;
} | null | undefined): { approveLabel?: string; reject: boolean; onClaimPage: boolean } {
  const canApprove = row?.approvalActions?.canApprove === true;
  const canReject = row?.approvalActions?.canReject === true;
  // Named for what is looked at there, by what was answered: a new account, the one the claim had, a first one, or cash.
  if (row?.payoutCorrectionPhase) {
    return { ...((canApprove || canReject) && { approveLabel: `ตรวจ${reimbursementPayoutRoundApproves(payoutRoundAnswer(row.payoutCorrectionAnswer))}` }), reject: false, onClaimPage: true };
  }
  const transfer = row?.payoutMethod === 'BANK_TRANSFER';
  return { ...(canApprove && { approveLabel: transfer ? 'ตรวจบัญชีและอนุมัติ' : 'อนุมัติ' }), reject: canReject, onClaimPage: transfer };
}

/** Whether a finance-queue row offers its finance decision ("อนุมัติจ่าย", or "ดำเนินการต่อ" once approved): never for a claim being cancelled. */
export function queueRowOffersFinanceReview(row: { status?: string; cancellationPending?: boolean } | null | undefined): boolean {
  return row?.status === 'FINANCE_REVIEW' && !claimIsBeingCancelled(row);
}

/**
 * A pay-queue row held as a possible duplicate: it waits for its payment and takes none until someone who may clear the
 * hold has compared the receipts, which is done on the claim's own page. A confirmed duplicate is never cleared, and a
 * claim being cancelled is not checked any more.
 */
export function queueRowAwaitsDuplicateCheck(
  row: { status?: string; cancellationPending?: boolean; hasDuplicateBlocker?: boolean; duplicateBlocksPayment?: boolean; duplicateReasons?: readonly string[] } | null | undefined,
): boolean {
  return row?.status === 'READY_FOR_PAYMENT' && !claimIsBeingCancelled(row) && duplicateCanBeCleared(row);
}

/**
 * What the quick-pay dialog says instead of a payment form for a claim it has just read, or null when it
 * may show the form. The queue row the press came from can be older than the claim: cancelled meanwhile,
 * paid by someone else, or no longer at its payment step. The dialog asks the claim's own page rule, so it
 * never offers a payment that page would not, and says what that page says. The words hold for a claim
 * that is finished too, so nothing here promises a payment later.
 */
export function quickPayBlockedNote(claim: any, permissions: readonly string[], userId: string): string | null {
  const step = activeJourneyStep(buildJourneySteps(claim, permissions, userId));
  if (step?.actions.includes('pay')) return null;
  return ['บันทึกจ่ายใบนี้ไม่ได้', step?.note].filter(Boolean).join(' · ');
}

/** The claim page opens its payment form on arrival only when the link asked for it and this viewer's current step offers it. */
export function opensPaymentFormOnArrival(requested: boolean, activeStep: { actions: readonly string[] } | undefined | null): boolean {
  return requested && Boolean(activeStep?.actions.includes('pay'));
}

export const MAX_CLAIM_LINES = 50;

// Only obvious words on this line: one category or no suggestion, never a fallback to "other".
const DESCRIPTION_CATEGORY_WORDS = {
  travel: ['แท็กซี่', 'grab', 'bolt', 'bts', 'mrt', 'รถไฟฟ้า', 'ทางด่วน', 'น้ำมัน', 'ค่าจอด', 'วิน', 'ตั๋ว', 'taxi', 'fuel', 'parking', 'ticket'],
  meals: ['ข้าว', 'อาหาร', 'กาแฟ', 'เครื่องดื่ม', 'น้ำดื่ม', 'coffee', 'cafe', 'café', 'food', 'meal', 'water'],
  accommodation: ['โรงแรม', 'ที่พัก', 'ห้องพัก', 'agoda', 'booking', 'hotel'],
  supplies: ['กระดาษ', 'ปากกา', 'หมึก', 'อุปกรณ์', 'ถุง', 'เครื่องเขียน', 'paper', 'pen', 'ink', 'stationery', 'supplies', 'bag'],
} as const;

export function suggestReimbursementCategory(description: string): string {
  const text = description.normalize('NFC').trim().toLowerCase();
  const matches = Object.entries(DESCRIPTION_CATEGORY_WORDS).filter(([, words]) => words.some(word =>
    // Latin words must stand alone: GrabFood is not enough to infer a taxi ride.
    /^[a-z]/.test(word) ? new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'u').test(text) : text.includes(word)));
  return matches.length === 1 ? matches[0]![0] : '';
}

export type ClaimFormLine = { incurredDate: string; description: string; purpose?: string; categoryKey: string; categoryLabel?: string; amount: string; hasReceipt?: boolean };

export function collectReceiptUploadResults(results: readonly PromiseSettledResult<string | null>[]): {
  attachmentIds: Array<string | null>;
  failedLineNumbers: number[];
  firstFailure: unknown;
} {
  const failedLineNumbers: number[] = [];
  let firstFailure: unknown;
  const attachmentIds = results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    failedLineNumbers.push(index + 1);
    firstFailure ??= result.reason;
    return null;
  });
  return { attachmentIds, failedLineNumbers, firstFailure };
}

/** A new receipt replaces either evidence path; otherwise an edit keeps the current evidence ids. */
export function mergeDraftLineEvidence(
  current: { attachmentId?: string | null; linkedExpenseId?: string | null },
  uploadedAttachmentId?: string | null,
): { attachmentId: string | null; linkedExpenseId: string | null } {
  return uploadedAttachmentId
    ? { attachmentId: uploadedAttachmentId, linkedExpenseId: null }
    : {
        attachmentId: current.attachmentId ?? null,
        linkedExpenseId: current.linkedExpenseId ?? null,
      };
}

/** Round each line to satang before adding, as computeClaimTotal does, without a float rollup. */
export function sumLineAmounts(lines: readonly { amount: string }[]): string {
  const total = lines.reduce((sum, line) => {
    const amount = typedAmount(line.amount);
    return sum + (Number.isFinite(Number(amount)) ? BigInt(satang.format(amount as `${number}`).replace(/[,.]/g, '')) : 0n);
  }, 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(3, '0');
  return `${total < 0n ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export type QueueSummary = { count: number; totalAmount: number; outstandingAmount: number; flagged: number };

/**
 * Rollup of a loaded queue for the summary cards. Display only — the server owns the real numbers.
 * `flagged` counts rows the queue wants to draw attention to (past the company's deadline, or a duplicate blocker).
 */
export function summariseQueue(rows: readonly any[]): QueueSummary {
  return (rows ?? []).reduce((acc, r) => ({
    count: acc.count + (r?.hasDuplicateBlocker ? 0 : 1),
    totalAmount: acc.totalAmount + (r?.hasDuplicateBlocker ? 0 : Number(r?.amount) || 0),
    outstandingAmount: acc.outstandingAmount + (r?.hasDuplicateBlocker ? 0 : Number(r?.outstandingAmount) || 0),
    flagged: acc.flagged + (r?.slaRisk || r?.hasDuplicateBlocker ? 1 : 0),
  }), { count: 0, totalAmount: 0, outstandingAmount: 0, flagged: 0 });
}

/**
 * Universal row search: every term must appear somewhere in the row's displayed values.
 * Callers pass what the user can actually see (including resolved Thai status labels) —
 * not the raw record, so ids and snapshot hashes never produce phantom matches.
 */
export function matchesSearch(parts: readonly unknown[], query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map((p) => String(p))
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export { DEFAULT_PAGE_SIZE as QUEUE_PAGE_SIZE, pageBounds } from '@/common/table/paging.logic';

/** What is wrong on one line of the claim form, each said under its own field in the words of that field's label. */
export type ClaimFormLineProblems = { description?: string; categoryKey?: string; categoryLabel?: string; incurredDate?: string; amount?: string; receipt?: string };
/**
 * Everything that keeps the claim form from being saved, at once and by field: the form marks each field and says
 * its problem under it. Before, one sentence at a time was shown in the summary card at the far end of the form.
 * `count` is the number of fields to fix.
 */
export type ClaimFormProblems = { reason?: string; lines: ClaimFormLineProblems[]; missingReceiptReason?: string; form?: string; count: number };

/** An amount as a person types it: "1,200.50" and "1 200" are 1200.50 and 1200. What is sent and summed has no separators. */
export function typedAmount(text: string | null | undefined): string {
  return String(text ?? '').replace(/[,\s]/g, '');
}

export function requestFormProblems(input: { intent?: 'draft' | 'send'; reason: string; missingReceiptReason?: string; receiptPolicy?: { requireReceipt: boolean; allowMissingReceiptWithReason: boolean }; lines: readonly ClaimFormLine[] }, today = todayCivilDate()): ClaimFormProblems {
  const lines = input.lines ?? [];
  const problems: ClaimFormProblems = { lines: [], count: 0 };
  if (!input.reason || input.reason.trim() === '') problems.reason = 'กรอกเหตุผล';
  if (lines.length === 0) problems.form = 'ต้องมีอย่างน้อย 1 รายการ';
  else if (lines.length > MAX_CLAIM_LINES) problems.form = `ใบเบิกหนึ่งใบมีได้ไม่เกิน ${MAX_CLAIM_LINES} รายการ`;
  for (const [index, line] of lines.entries()) {
    const found: ClaimFormLineProblems = {};
    if (!line.description || line.description.trim() === '') found.description = 'กรอกรายการ';
    if (!line.categoryKey || line.categoryKey.trim() === '') found.categoryKey = 'เลือกหมวด';
    // "อื่น ๆ" says what it is (owner 2026-10-16): the typed words are the line's category on the claim and its print.
    else if (line.categoryKey === 'other' && !line.categoryLabel?.trim()) found.categoryLabel = 'ระบุหมวดอื่น';
    const dateError = line.incurredDate ? reimbursementIncurredDateError(line.incurredDate, today) : null;
    if (!line.incurredDate) found.incurredDate = 'เลือกวันที่';
    // The shared sentence names its line for a banner; under the line's own field the line is not said again.
    else if (dateError) found.incurredDate = errorMessage(`${dateError}:${index + 1}`).replace(/^รายการที่ \d+: /u, '');
    if (!(Number(line.amount) > 0)) found.amount = 'ยอดเงินต้องมากกว่า 0';
    if (input.intent !== 'draft' && !line.hasReceipt && input.receiptPolicy?.requireReceipt && !input.receiptPolicy.allowMissingReceiptWithReason) found.receipt = 'ร้านนี้ต้องแนบใบเสร็จทุกรายการก่อนส่งอนุมัติ';
    problems.lines.push(found);
  }
  // Mirrors the server guard (`missing_receipt_reason_required`): a row with no receipt becomes
  // an expense at ตรวจสอบการเงิน that cannot be confirmed without this reason.
  if (input.intent !== 'draft' && (!input.receiptPolicy || input.receiptPolicy.allowMissingReceiptWithReason) && lines.some((line) => !line.hasReceipt) && !input.missingReceiptReason?.trim()) {
    const missing = lines.map((line, index) => (line.hasReceipt ? 0 : index + 1)).filter(Boolean);
    problems.missingReceiptReason = `รายการที่ ${missing.join(', ')} ยังไม่มีใบเสร็จ แนบใบเสร็จ หรือกรอกเหตุผลที่ไม่มีใบเสร็จ (ถ้าร้านรับเหตุผลแทนใบเสร็จ)`;
  }
  problems.count = (problems.reason ? 1 : 0) + (problems.form ? 1 : 0) + (problems.missingReceiptReason ? 1 : 0)
    + problems.lines.reduce((sum, line) => sum + Object.keys(line).length, 0);
  return problems;
}

/** The first thing that keeps the claim form from being saved, as one sentence, or null. A line's problem names its line. */
export function validateRequestForm(input: { intent?: 'draft' | 'send'; reason: string; missingReceiptReason?: string; receiptPolicy?: { requireReceipt: boolean; allowMissingReceiptWithReason: boolean }; lines: readonly ClaimFormLine[] }, today = todayCivilDate()): string | null {
  const problems = requestFormProblems(input, today);
  if (problems.reason) return problems.reason;
  if (problems.form) return problems.form;
  for (const [index, line] of problems.lines.entries()) {
    const first = line.description ?? line.categoryKey ?? line.categoryLabel ?? line.incurredDate ?? line.amount ?? line.receipt;
    if (first) return `รายการที่ ${index + 1}: ${first}`;
  }
  return problems.missingReceiptReason ?? null;
}

/**
 * The words of the hub's third tab, by what the company has (owner's model, 2026-10-01): a finance desk exists only
 * where the company turned the finance-review step on. There the tab is the finance desk's queue, of claims that
 * wait for its review and of claims that wait for their payment. Where the step is off it holds nothing but claims
 * that wait for their payment, so it is the pay queue and says nothing of finance.
 */
export function financeQueueWords(financeStep: boolean): { tab: string; description: string; waiting: string; emptyTitle: string; emptyDescription: string } {
  return financeStep
    ? { tab: 'รอการเงิน', description: 'ตรวจใบเบิกที่อนุมัติแล้ว และบันทึกการจ่ายเงิน', waiting: 'รอตรวจหรือรอจ่าย',
      emptyTitle: 'ไม่มีใบเบิกรอการเงิน', emptyDescription: 'ใบเบิกที่อนุมัติแล้วจะอยู่ที่นี่' }
    : { tab: 'รอจ่าย', description: 'บันทึกการจ่ายเงินของใบเบิกที่อนุมัติแล้ว', waiting: 'รอจ่าย',
      emptyTitle: 'ไม่มีใบเบิกรอจ่าย', emptyDescription: 'ใบเบิกที่อนุมัติแล้วและรอจ่ายเงินคืนจะอยู่ที่นี่' };
}

/**
 * Whether a row's claim may repeat another claim: the warning of an approval-queue row, before anyone decides. Every
 * list and queue row carries `duplicateStatus`, which the server reports with the claim's own open candidates, so it
 * never reads "none found" while one is open. Whether the PAYMENT is refused for it is another fact, the server's
 * `hasDuplicateBlocker` on a pay-queue row and `duplicateBlocksPayment` on the claim: the mark of the pay queue.
 */
export function rowMayBeDuplicate(row: { duplicateStatus?: string | null } | null | undefined): boolean {
  return row?.duplicateStatus === 'POSSIBLE_DUPLICATE' || row?.duplicateStatus === 'CONFIRMED_DUPLICATE';
}

/** A queue row that goes, or went, through the finance review: its claim was sent while the company had that step. */
export function rowHasFinanceReview(row: { financeReviewStatus?: string | null } | null | undefined): boolean {
  return !!row?.financeReviewStatus && row.financeReviewStatus !== 'NOT_REQUIRED';
}

export const HUB_TABS = ['mine', 'approvals', 'finance', 'policy'] as const;
export type HubTab = (typeof HUB_TABS)[number];

/**
 * A tab is offered only when the session can actually use the endpoints behind it —
 * the server enforces the same keys, this just stops offering a queue that answers 403.
 * ตั้งค่านโยบาย is a settings editor, so it needs `policy.manage`; `policy.read` alone
 * would show a form whose save 403s. Role names are routing labels, not authorization.
 */
const HUB_TAB_PERMISSIONS: Record<HubTab, readonly string[]> = {
  mine: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'],
  approvals: ['reimbursement.approve', 'reimbursement.reject'],
  finance: ['reimbursement.finance_review', 'reimbursement.payment.record'],
  policy: ['reimbursement.policy.manage'],
};

export function visibleHubTabs(permissions: readonly string[], _roles: readonly string[] = []): HubTab[] {
  return HUB_TABS.filter((tab) => HUB_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key)));
}

/** Add the approval tab only after the server confirms this user has a frozen task. */
export function withAssignedApprovalTab(tabs: readonly HubTab[], hasAssignedTask: boolean): HubTab[] {
  if (!hasAssignedTask || tabs.includes('approvals')) return [...tabs];
  const visible = new Set<HubTab>([...tabs, 'approvals']);
  return HUB_TABS.filter((tab) => visible.has(tab));
}

/** Prefer the broadest list scope granted to the session; the API remains the final authority. */
export function reimbursementListScope(permissions: readonly string[]): 'related' | 'own' | undefined {
  if (permissions.includes('reimbursement.read')) return undefined;
  if (permissions.includes('reimbursement.read_related')) return 'related';
  return 'own';
}

/**
 * `?tab=` from a LINE/notification deep link. Anything unknown — or a tab this
 * session cannot see — falls back to the first tab it can.
 */
export function parseHubTab(value: string | null | undefined, visible: readonly HubTab[] = HUB_TABS): HubTab {
  return visible.includes(value as HubTab) ? (value as HubTab) : (visible[0] ?? 'mine');
}

export function initialHubTab(requested: string | null, visible: readonly HubTab[], counts: { approvals: number; finance?: number }): HubTab {
  if (requested) return parseHubTab(requested, visible);
  if (visible.includes('approvals') && counts.approvals > 0) return 'approvals';
  if (visible.includes('finance') && (counts.finance ?? 0) > 0) return 'finance';
  return parseHubTab('mine', visible);
}

// ---- หน้ารวม: summary cards, filter chips and the list they filter (spec §18.1) ----

/**
 * "ทั้งหมด" or one bucket. The API places every claim in exactly one bucket (`reimbursementHubBucket`), counts
 * the buckets and filters the list by the same rule, so a card's number is the rows its filter shows.
 */
export type HubFilter = 'all' | ReimbursementHubBucket;

/** Work-list context travels with the claim link; menu entry and policy never restore a previous visit. */
export function claimHubFilter(value: string | null): HubFilter {
  return ['draft', 'correction', 'review', 'payment', 'duplicate_blocked', 'paid', 'closed'].includes(value ?? '') ? value as HubFilter : 'all';
}

export function claimHubQuery(tab: string | null, filter: string | null): string {
  if (!['mine', 'approvals', 'finance'].includes(tab ?? '')) return '';
  const query = new URLSearchParams({ tab: tab! });
  const group = claimHubFilter(filter);
  if (tab === 'mine' && group !== 'all') query.set('filter', group);
  return `?${query}`;
}

/** A card is the same filter as its chip; tapping the card that is already open goes back to ทั้งหมด. */
export function hubCardFilter(open: HubFilter, tapped: HubFilter): HubFilter {
  return open === tapped ? 'all' : tapped;
}

/** The rows of one hub list loaded so far, where the server's list goes on, and the scope as the server counted it. */
export type HubList = {
  /** The list these rows belong to (company, scope, filter, reload, search): rows of another list are never shown as this one's. */
  key: string;
  rows: any[];
  /** The server's count of the whole list. */
  total: number;
  /** The page to ask for when more rows are needed; null once the server has no more. */
  nextPage: number | null;
  /** Why the last page asked for did not arrive. Nothing more is asked until a retry clears it, and the rows stay. */
  failed?: string;
  /** How many times this list was read again from its first page because it changed between two pages. */
  restarts?: number;
  /** What the cards and chips print: the whole scope (with a search, what it found), whatever filter the rows are of. Kept from one list to the next. */
  summary: ReimbursementHubSummary | null;
};
export const NO_HUB_LIST: HubList = { key: '', rows: [], total: 0, nextPage: 1, summary: null };
/** What the hub asks for; what counts is the page size the server answers with. */
export const HUB_PAGE_SIZE = 100;
/** How long the typing has to pause before the hub asks the API for the search. */
export const HUB_SEARCH_DELAY_MS = 300;

/**
 * The line above the hub's list. With a search the server's counts are of what the search found, so the cards and
 * chips change with it: the line says so, because a card that showed 12 a moment ago now shows 3.
 */
export function hubListStatusText(shown: number, all: number, filter: HubFilter, searching: boolean): string {
  if (searching) {
    return `${filter === 'all' ? `พบ ${shown} รายการ` : `พบ ${shown} จาก ${all} รายการ`}ที่ตรงกับคำค้น · ตัวเลขบนตัวกรองนับเฉพาะรายการที่ตรงกับคำค้น`;
  }
  return filter === 'all' ? `ทั้งหมด ${all} รายการ` : `พบ ${shown} จาก ${all} รายการ`;
}

export const hubListKey = (...parts: unknown[]) => parts.join('|');

/** What is held of this list. Rows loaded for another filter or scope, or before a reload, are not this list's. */
export function hubList(held: HubList, key: string): HubList {
  return held.key === key ? held : { ...NO_HUB_LIST, key, summary: held.summary };
}

/**
 * The page to ask the server for now, given how many rows the screen needs: the first page of a list, then
 * more only when the table page shown reaches past what is held. Null: the rows needed are loaded, the list
 * is complete, or the last page failed.
 */
export function hubNextPage(list: HubList, need: number): number | null {
  return list.failed === undefined && list.rows.length < need ? list.nextPage : null;
}

/** How often a list that keeps changing is read again from the start before it is taken as it comes. */
const HUB_MAX_RESTARTS = 3;

/**
 * Adds one page. The list ends on the server's own total, or on a page shorter than the page size the
 * server answered with, never on the size that was asked for: the server may cap it.
 *
 * A later page whose total differs from the one held means the list changed between the two calls. When a
 * claim left it (approved, paid, deleted), every claim behind it moved up one place, and the one that moved
 * onto a page already read would never be shown: a claim still waiting, skipped. The list is then read again
 * from its first page.
 * ponytail: at most three times for one list; one that changes on every call is then taken as it comes.
 */
export function withHubPage(
  held: HubList, key: string,
  result: { items?: any[]; total: number; page: number; pageSize: number; hub: ReimbursementHubSummary },
): HubList {
  const items = result.items ?? [];
  const list = hubList(held, key);
  const restarts = list.restarts ?? 0;
  if (result.page > 1 && result.total !== list.total && restarts < HUB_MAX_RESTARTS) {
    return { key, rows: [], total: result.total, nextPage: 1, summary: result.hub, restarts: restarts + 1 };
  }
  // Keyed by id: a claim filed between two calls shifts the pages and would otherwise repeat a row.
  const byId = new Map<string, any>(list.rows.map((row) => [row.id, row]));
  for (const item of items) byId.set(item.id, item);
  const more = items.length > 0 && items.length >= result.pageSize && result.page * result.pageSize < result.total;
  return { key, rows: [...byId.values()], total: result.total, nextPage: more ? result.page + 1 : null, summary: result.hub, ...(restarts > 0 && { restarts }) };
}

/** A page did not arrive: what was loaded stays, and the same page is asked again on retry. */
export function withHubFailure(held: HubList, key: string, failed: string): HubList {
  return { ...hubList(held, key), failed };
}

export function withHubRetry(held: HubList): HubList {
  const { failed: _failed, ...list } = held;
  return list;
}

// ---- Claim timeline (เส้นทางของใบเบิก) ----

export type ClaimTimelineRow = {
  key: string;
  /** done = already happened, current = what the claim is waiting on, future = not reached yet. */
  state: 'done' | 'current' | 'future';
  label: string;
  /** ISO — the drawer formats it; the helper stays free of date formatting. */
  date?: string;
};

/**
 * The claim's journey as a list, built only from what the detail payload already carries.
 * Steps that cannot apply are left out rather than shown as never-reached: a refusal ends
 * the journey there, and a claim whose policy path skipped finance review never shows that row.
 */
export function buildClaimTimeline(detail: any): ClaimTimelineRow[] {
  const status = String(detail?.status ?? '');
  const rows: ClaimTimelineRow[] = [];
  rows.push(detail?.submittedAt
    ? { key: 'submit', state: 'done', label: 'ยื่นใบ', date: detail.submittedAt }
    : { key: 'submit', state: 'current', label: 'รอผู้เบิกส่งอนุมัติ' });

  // A cancellation that was started and has not completed (audit B3): nobody is waited for but the system.
  const cancelling = status !== 'CANCELLED' && status !== 'VOIDED' ? detail?.pendingCancellation : undefined;
  // The waiting row names the same people the queue line does — one resolved list, never two.
  const waitingFor = currentDeskText(detail?.currentDesk) ?? CURRENT_DESK_LABELS.APPROVER;
  // Spec §17.2: an approval that attested the claim's account says so. Which step did is on the account's
  // own history row, so an approval of a cash or a legacy claim, or one that attested nothing, reads as before.
  const attestedAccount = new Set((detail?.payoutHistory ?? []).map((version: any) => version.approvalStepId).filter(Boolean));
  // Payout spec §17.2: the correction rounds the claim went through. Each approval of a new account is a row of
  // the round ("อนุมัติบัญชีรับเงินใหม่โดย …"), so the step that gave it is not told a second time as an approval.
  const round = payoutCorrectionRound(detail);
  const corrections: any[] = detail?.payoutCorrectionHistory ?? [];
  const approvedInRound = new Set(corrections.filter((event) => event.kind === 'REAPPROVED').map((event) => event.approvalStepId).filter(Boolean));
  for (const step of [...(detail?.approvalSteps ?? [])].sort((a: any, b: any) => a.sequenceNo - b.sequenceNo)) {
    // The approval a round set aside stays as history: the claim's lines and amount are still what it approved. Any
    // other step that is no longer in force is left out, a round's own refused or replaced step included.
    if (step.invalidatedAt && !(step.status === 'APPROVED' && step.invalidatedReason === PAYOUT_CORRECTION_STEP_REASON)) continue;
    if (approvedInRound.has(step.id)) continue;
    const key = `step-${step.id ?? step.sequenceNo}`;
    const decidedBy = step.decidedByName ?? step.approverName ?? CURRENT_DESK_LABELS.APPROVER;
    // A requester who approved their own claim checked nobody's account but their own: said as the card says it.
    const approvedLabel = !attestedAccount.has(step.id) ? `อนุมัติโดย ${decidedBy}`
      : step.decisionByUserId && step.decisionByUserId === detail?.requesterUserId ? `อนุมัติโดย ${decidedBy} · ${REQUESTER_SELF_ATTESTED}`
        : `อนุมัติและตรวจบัญชีรับเงินโดย ${decidedBy}`;
    if (step.status === 'APPROVED') rows.push({ key, state: 'done', label: approvedLabel, date: step.decidedAt });
    else if (step.status === 'REJECTED') rows.push({ key, state: 'done', label: claimReturnedText({ approvalSteps: [step] }), date: step.decidedAt });
    // The step a round waits on is told after the round's own rows, as what the claim waits for now.
    else if (step.status === 'PENDING' && !cancelling && !round) rows.push({ key, state: 'current', label: `กำลังรอ ${waitingFor} อนุมัติ` });
  }
  // Only a claim that IS rejected ends here. Reopen keeps the refused step, so a claim fixed and
  // resubmitted still carries it as history and its journey goes on.
  if (status === 'REJECTED') return rows;
  // A payment since taken back stays in the journey: what was paid, then that it was voided and why.
  const paidLabel = (payment: any) => [payment.paidByName ? `จ่ายแล้ว โดย ${payment.paidByName}` : 'จ่ายแล้ว', paymentFactsText(payment)].filter(Boolean).join(' · ');
  const voided = (detail?.payments ?? []).filter((payment: any) => payment.status === 'VOIDED').map((payment: any): { at: unknown; rows: ClaimTimelineRow[] } => ({
    at: payment.voidedAt,
    rows: [
      { key: `payment-${payment.id}`, state: 'done', label: paidLabel(payment), date: payment.paidAt },
      { key: `void-${payment.id}`, state: 'done', label: `${PAYMENT_VOIDED_LABEL}${payment.voidReason ? `: ${payment.voidReason}` : ''}`, date: payment.voidedAt },
    ],
  }));
  // What happened to the claim after it was approved, in the order it happened: a payment taken back, and the rows
  // of each correction round. A wrong account is often found after a transfer was voided, and often before any.
  const moment = (at: unknown) => Date.parse(String(at)) || 0;
  const history = [...voided, ...corrections.map((event, index) => ({ at: event.at, rows: payoutCorrectionTimelineRows(event, index, detail?.payoutHistory) }))]
    .sort((left, right) => moment(left.at) - moment(right.at)).flatMap((entry) => entry.rows);
  if (status === 'CANCELLED' || status === 'VOIDED') {
    // A closed claim waits for nobody: a draft cancelled before it was sent still read "รอผู้เบิกส่งอนุมัติ" as its current row.
    return [...rows.filter((row) => row.state !== 'current'), ...history, { key: 'terminal', state: 'done', label: status === 'CANCELLED' ? 'ยกเลิกใบเบิก' : 'เพิกถอนรายการ' }];
  }
  // Being cancelled: the journey stops here until the cancellation is finished or withdrawn.
  if (cancelling) {
    return [...rows.map((row) => (row.state === 'current' ? { ...row, state: 'done' as const } : row)), ...history,
      { key: 'cancel-started', state: 'done', label: `เริ่มยกเลิกใบเบิก${cancelling.startedByName ? ` โดย ${cancelling.startedByName}` : ''}`, date: cancelling.startedAt },
      { key: 'system', state: 'current', label: `กำลัง${REIMBURSEMENT_SYSTEM_WAIT_LABEL}` }];
  }

  // Decided, and the system has not carried it out yet (audit B4): that is what the claim waits for now. An
  // approved claim is with the system; one nobody had to approve is with whoever may record its payment.
  if (detail?.awaitingSystem) {
    rows.push({ key: 'system', state: 'current', label: detail.awaitingSystem.kind === 'NO_APPROVAL_NEEDED'
      ? `กำลังรอ ${paymentDeskText(detail?.paymentDesk) ?? CURRENT_DESK_LABELS.PAYMENT} ทำต่อ`
      : `กำลัง${REIMBURSEMENT_SYSTEM_WAIT_LABEL}` });
  }

  // The row the claim waits at is the journey's own step, so the two never disagree; and the finance row
  // exists only for a claim that has that step (spec §18.3: no "ฝ่ายการเงิน" on a claim without one).
  const withFinance = claimHasFinanceStep(detail);
  const at = journeyStepAt(detail, withFinance);
  const financeDone = detail?.financeReviewStatus === 'APPROVED_FOR_PAYMENT' && !!detail?.financeReviewedAt;
  if (financeDone) {
    rows.push({
      key: 'finance',
      state: 'done',
      // What was done and by whom, in the name of the step ("ตรวจการเงิน"). Not "ฝ่ายการเงินตรวจแล้ว": whoever reviewed may be
      // the owner or the claim's approver, and the row then named a department beside that person.
      label: detail.financeReviewedByName ? `ตรวจการเงินแล้ว โดย ${detail.financeReviewedByName}` : 'ตรวจการเงินแล้ว',
      date: detail.financeReviewedAt,
    });
  } else if (withFinance) {
    rows.push({ key: 'finance', state: at === 'finance' ? 'current' : 'future', label: at === 'finance' ? `กำลัง${WAITING_FOR_FINANCE}` : WAITING_FOR_FINANCE });
  }

  rows.push(...history);
  // In a round the claim waits for its requester, then for the approvers of what was answered: the words of its badge
  // and of its step note, so the three name the same party and the same thing (spec §14.2).
  if (round) {
    rows.push({ key: 'correction', state: 'current', label: `กำลัง${round.phase === 'AWAITING_REQUESTER'
      ? payoutRoundStatus(detail, round) : waitingForCorrectionApproval(detail)}` });
  }
  const paid = (detail?.payments ?? []).find((p: any) => p.status === 'RECORDED');
  rows.push(paid
    ? { key: 'payment', state: 'done', label: paidLabel(paid), date: paid.paidAt }
    : { key: 'payment', state: at === 'payment' ? 'current' : 'future', label: detail?.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE') ? reimbursementDuplicateWait(detail)?.waiting ?? reimbursementDuplicateBlockNotice(detail.duplicateReasons, false, { status: detail.status }) : at === 'payment' ? `กำลัง${waitingForPayer(detail)}` : 'รอบันทึกจ่าย' });
  return rows;
}

/**
 * The date a journey row prints. Two rows that read alike on one day are told apart by their time: a requester who
 * gives the account of a round twice in a day had two rows "ผู้เบิกแก้บัญชีรับเงิน" with one date. Every other row
 * keeps the date alone. Null for a row with no date.
 */
export function timelineDateText(rows: readonly ClaimTimelineRow[], row: ClaimTimelineRow): string | null {
  if (!row.date) return null;
  const day = formatThaiDate(row.date);
  const alike = rows.some((other) => other !== row && other.label === row.label && !!other.date && formatThaiDate(other.date) === day);
  return alike ? formatThaiDateTime(row.date) : day;
}

/** `invalidatedReason` of every approval step a correction round sets aside, as the API writes it. */
const PAYOUT_CORRECTION_STEP_REASON = 'payout_account_correction';

/**
 * What the card "ขั้นตอนอนุมัติ" says of a step a correction round set aside: the approval the claim stood on
 * before it was sent back, or a step of the round whose account was sent back or given again. Both stay in the
 * list as history, and neither is the approval the claim stands on now. Null for every other step.
 */
export function approvalStepCorrectionNote(step: { status?: string; invalidatedAt?: unknown; invalidatedReason?: string | null } | null | undefined): string | null {
  if (!step?.invalidatedAt || step.invalidatedReason !== PAYOUT_CORRECTION_STEP_REASON) return null;
  // True of every round: what was sent back, or waited in the step, may be cash, and whoever answered again may not be the requester.
  return step.status === 'APPROVED' ? 'เก็บเป็นประวัติ: อนุมัติก่อนใบถูกส่งกลับ' : 'เก็บเป็นประวัติ: วิธีรับเงินคืนที่รออนุมัติในขั้นนี้ถูกส่งกลับ หรือมีการเลือกอีกครั้ง';
}

/**
 * What a round's "account given" event gave, masked: cash, or the account of the claim's account history it names,
 * by its bank and last 4 digits in the shared words of contracts. Empty where the detail carries no such row.
 */
function payoutCorrectionGivenText(event: any, payoutHistory: readonly any[] | null | undefined): string {
  if (event?.payoutMethod === 'CASH') return PAYOUT_METHOD_TEXT.CASH!;
  const account = (payoutHistory ?? []).find((row) => row?.version != null && row.version === event?.payoutVersion);
  return account?.accountLast4 ? maskedPayoutAccount(account) : '';
}

/**
 * One thing that happened in a correction round, as a row of the claim's journey (spec §17.2), each in the words of the
 * fact its event carries: the send-back by what the claim held ("ส่งกลับให้แก้บัญชีรับเงินโดย … : เหตุผล", with the note
 * that went with it), the answer by what it was and by who gave it ("ผู้เบิกยืนยันบัญชีเดิม", "{ชื่อ} แก้บัญชีรับเงินแทนผู้เบิก")
 * with what was given, and the approval by what it approved ("อนุมัติการรับเป็นเงินสดโดย …"). A requester who answers twice
 * (a slip of the finger put right at once) gets two rows that say different things; the time alone could not tell them
 * apart within one minute. Nothing for a kind of event this build has no words for. The reason of a send-back reads as
 * it did when it was given: of the kind of account the claim held then (a PromptPay number is never called "เลขบัญชี").
 */
function payoutCorrectionTimelineRows(event: any, index: number, payoutHistory?: readonly any[] | null): ClaimTimelineRow[] {
  const given = event?.kind === 'ACCOUNT_SUBMITTED' ? payoutCorrectionGivenText(event, payoutHistory) : '';
  const label = event?.kind === 'SENT_BACK'
    ? `${payoutCorrectionSentBackText({ ...event, payoutKind: payoutKindHeldAt(payoutHistory, event.at) })}${event.note ? ` · ${event.note}` : ''}`
    : event?.kind === 'ACCOUNT_SUBMITTED' ? `${payoutCorrectionAnsweredText(event.answer, event)}${given ? ` · ${given}` : ''}`
      : event?.kind === 'REAPPROVED' ? `อนุมัติ${reimbursementPayoutRoundApproves(event.answer)}${event.byName ? `โดย ${event.byName}` : ''}` : null;
  return label ? [{ key: `correction-${index}`, state: 'done', label, date: event.at }] : [];
}

/**
 * A payment in one phrase: how it was paid — for a transfer the payer confirmed, the last 4 digits of
 * the account it went into — whether a slip is attached, and whether the method is not the one the
 * requester asked for. The timeline says it in these words and the payment row shows the same facts
 * (invariant I4), both from the one payment record. How it was paid is the shared phrase of contracts,
 * the one the requester's notice is built from on the server.
 */
export function paymentFactsText(payment: any): string {
  return [
    reimbursementPaymentHowText({ paymentMethod: payment?.paymentMethod, payoutDestination: payment?.payoutDestination }),
    paymentSlipCount(payment) > 0 && 'มีหลักฐานการจ่าย',
    payment?.methodMismatchReason && PAID_DIFFERENTLY_LABEL,
  ].filter(Boolean).join(' · ');
}

// Who a claim waits for, in the words of its desk: the timeline row and the step note print the same sentence,
// built from the pool label the "อยู่ที่ …" line and the LINE backlog answer use.
const WAITING_FOR_FINANCE = `รอ${CURRENT_DESK_LABELS.FINANCE}ตรวจ`;

/**
 * An act taken at the finance-review step ("ระงับการจ่าย", "ส่งกลับให้แก้ไข"), who took it and the reason they gave.
 * Whoever holds the finance-review right takes it (the owner, the claim's approver, anyone given the right), so the
 * sentence names the step and that person, never a department, as the done row does ("ตรวจการเงินแล้ว โดย …").
 */
function financeStepActNote(act: string, detail: any): string {
  const by = detail?.financeReviewedByName ? ` โดย ${detail.financeReviewedByName}` : '';
  return `${act}ที่ขั้นตรวจการเงิน${by}${detail?.financeReviewNote ? `: ${detail.financeReviewNote}` : ''}`;
}

/** The one person who records, or recorded, a claim's payment. Never "ฝ่ายการเงิน": most shops have no finance desk. */
const PAYER = 'ผู้บันทึกจ่าย';
/** "รอ สมศรี หรือ วิชัย บันทึกจ่าย" when the detail names who can pay; otherwise the pool, which already says it. */
function waitingForPayer(detail: any): string {
  const payers = paymentDeskText(detail?.paymentDesk);
  return payers ? `รอ ${payers} บันทึกจ่าย` : `รอ${CURRENT_DESK_LABELS.PAYMENT}`;
}

// ---- Journey steps (หน้า journey ต่อใบเบิกหนึ่งใบ — spec §5, §6) ----

export type JourneyStepKey = 'items' | 'approval' | 'finance' | 'payment' | 'document';
/** needs-fix = refused, waiting for the requester; ended = cancelled/voided here, nothing follows. */
export type JourneyStepState = 'done' | 'current' | 'upcoming' | 'needs-fix' | 'ended';
export type JourneyAction =
  | 'submit' | 'edit' | 'cancel' | 'reopen' | 'resume-cancel' | 'withdraw-cancel'
  | 'approve' | 'reject' | 'resume' | 'policy-settings'
  | 'finance-approve' | 'finance-return' | 'finance-block'
  | 'resolve-duplicate' | 'pay' | 'sign' | 'print' | 'attach-signed-copy' | 'void-payment'
  // A payout account correction round (payout spec §14): send the claim back for its account, and give that account.
  | 'send-back' | 'correct-payout';
export type JourneyStep = {
  key: JourneyStepKey;
  label: string;
  state: JourneyStepState;
  /** What the viewer should know on the active step; on a done step only the auto-approval or signed-document line. */
  note?: string;
  /** Open to THIS viewer, primary first. Only the active step carries any. */
  actions: JourneyAction[];
};

export const JOURNEY_STEP_LABELS: Record<JourneyStepKey, string> = {
  items: 'รายการที่จ่ายไป', approval: 'อนุมัติ', finance: 'ตรวจการเงิน', payment: 'จ่ายเงินคืน', document: 'เอกสาร',
};

/** Why a requester who could approve this claim is not offered to: said of the claim and of the shop's setting, in one sentence. */
export const SELF_APPROVAL_STEP_NOTE = 'ใบนี้เป็นของคุณเอง ร้านตั้งค่าไว้ไม่ให้อนุมัติใบของตัวเอง';

/** The policy switch, quoted as the settings page labels it so it can be found there. */
const SELF_APPROVAL_BLOCK_NOTE = `ใบนี้เป็นของคุณเอง และนโยบายที่ใบนี้ใช้ปิด "${SELF_APPROVAL_SWITCH_LABEL}"`;

/**
 * Whether THIS claim passes through finance review (spec §5: per claim, from its frozen policy).
 * Before approval the finance state is still NOT_REQUIRED, so the detail's `financeReviewRequired`
 * (frozen policy once submitted, current policy for a draft) decides. After approval the finance state
 * the claim shows is the truth: any finance decision means the step exists, NOT_REQUIRED means skipped.
 */
export function claimHasFinanceStep(detail: any): boolean {
  if (!detail?.approvedAt && typeof detail?.financeReviewRequired === 'boolean') return detail.financeReviewRequired;
  return !!detail?.financeReviewStatus && detail.financeReviewStatus !== 'NOT_REQUIRED';
}

/** The step the claim stands on (what `currentDesk` points at), or where a cancelled/voided claim stopped. */
function journeyStepAt(detail: any, withFinance: boolean): JourneyStepKey {
  switch (detail?.status) {
    case 'DRAFT': return 'items';
    case 'PENDING_APPROVAL': case 'REJECTED': return 'approval';
    case 'FINANCE_REVIEW': return 'finance';
    // Transient: approved, waiting for the projection to route it on (currentDesk FINANCE or PAYMENT). While
    // the server says the claim cannot be paid yet (audit B4) it stands at the approval step, which then
    // offers ดำเนินการต่อ; the payment step, and its button the API would refuse, come after it.
    case 'APPROVED': return detail.awaitingSystem ? 'approval' : detail.financeReviewStatus === 'PENDING' ? 'finance' : 'payment';
    case 'READY_FOR_PAYMENT': case 'PARTIALLY_PAID': return 'payment';
    case 'PAID': return 'document';
  }
  // Reopen and a finance correction clear submittedAt/approvedAt, so they mark the round's progress.
  if (!detail?.submittedAt) return 'items';
  if (!detail.approvedAt) return 'approval';
  return withFinance && detail.financeReviewStatus !== 'APPROVED_FOR_PAYMENT' ? 'finance' : 'payment';
}

/**
 * The round a claim is in, from its detail: the phase, and who sent it back and why. Null for a claim in none,
 * and for a phase this build does not know (the claim then reads as any claim waiting for approval).
 */
function payoutCorrectionRound(detail: any): {
  phase: 'AWAITING_REQUESTER' | 'AWAITING_APPROVAL'; requestedByName?: string; reasonCode?: unknown; note?: string; sameAsPrevious?: boolean;
} | null {
  const phase = detail?.payoutCorrection?.phase ?? detail?.payoutCorrectionPhase;
  if (detail?.status !== 'PENDING_APPROVAL' || (phase !== 'AWAITING_REQUESTER' && phase !== 'AWAITING_APPROVAL')) return null;
  return { ...detail.payoutCorrection, phase };
}

/**
 * What a claim in a round is said to wait for, in the words of its badge (contracts): while it is with its requester by
 * what the claim holds, an account to correct, none yet, or cash; after that by what was answered.
 */
function payoutRoundStatus(detail: any, round: { phase: string }): string {
  return reimbursementPayoutRoundStatus({ ...detail, payoutCorrectionPhase: round.phase }) as string;
}

/**
 * "รอ สมศรี อนุมัติบัญชีรับเงินใหม่": the step note and the timeline row of a round's waiting step name the same people,
 * and the thing they approve by what was answered: a new account, the account the claim had, a first one, or cash.
 */
function waitingForCorrectionApproval(detail: any): string {
  return `รอ ${currentDeskText(detail?.currentDesk) ?? CURRENT_DESK_LABELS.APPROVER} อนุมัติ${reimbursementPayoutRoundApproves(detail?.payoutCorrectionAnswer)}`;
}

/**
 * The step note of a claim in a correction round (spec §14.2). While it waits for its requester: who sent it
 * back and why, then whom it waits for, in the words of its badge. While its new account waits for approval:
 * who approves it. The viewer the server lets act reads what to do instead.
 */
function payoutCorrectionStepNote(
  detail: any, round: NonNullable<ReturnType<typeof payoutCorrectionRound>>,
  viewer: { canApprove: boolean; canSubmit: boolean; isRequester: boolean },
): string {
  // The contracts' sentences for what the claim holds: with its requester what it was sent back holding, after that what was answered.
  const words = payoutRoundTexts(detail);
  if (round.phase === 'AWAITING_REQUESTER') {
    return [
      // With its requester the claim holds what it held when it was sent back: the send-back is said by that, and its
      // reason in the words of that kind of account.
      payoutCorrectionSentBackText({ byName: round.requestedByName, reasonCode: round.reasonCode, held: words.held, payoutKind: detail?.payout?.payoutKind }),
      round.note && `หมายเหตุ: ${round.note}`,
      // The requester reads what they are asked to do and the button that does it; whoever may answer for them, that
      // they may. Everyone else reads what the claim waits for, in the words of its badge.
      viewer.canSubmit ? (viewer.isRequester ? words.waitForYou : words.waitOnBehalf) : payoutRoundStatus(detail, round),
    ].filter(Boolean).join(' · ');
  }
  const waiting = waitingForCorrectionApproval(detail);
  const answer = payoutRoundAnswer(detail?.payoutCorrectionAnswer);
  const thing = reimbursementPayoutRoundApproves(answer);
  return [
    // Whoever may approve reads what waits for them, what was done and by whom, and what to look at: two accounts to
    // compare, one account that was kept or added, or cash, which has no account to check. Without the answer (a page
    // fed by an older server) only what is true of every answer.
    viewer.canApprove ? (answer ? reimbursementPayoutRoundApproverNote(answer, detail?.payoutCorrectionAnsweredBy) : `รอคุณอนุมัติ${thing} รายการและยอดเงินไม่เปลี่ยน`) : waiting,
    // The requester holds the approval this answer waits on and the company's switch refuses them (spec §15).
    detail?.approvalActions?.selfApprovalBlocked === true && `${SELF_APPROVAL_BLOCK_NOTE} คุณจึงอนุมัติ${thing}เองไม่ได้`,
    // While it waits, what was answered may be answered again: an account corrected, or cash changed for another choice.
    !viewer.canApprove && viewer.canSubmit && (viewer.isRequester ? words.given.againForYou : words.given.againOnBehalf),
  ].filter(Boolean).join(' · ');
}

export function duplicateNoticeForViewer(detail: any, permissions: readonly string[], userId: string): string {
  return reimbursementDuplicateBlockNotice(detail?.duplicateReasons, detail?.status === 'FINANCE_REVIEW', {
    // Not-approved claims now use the draft's cancellation route; keep the shared LINE copy unchanged.
    status: detail?.status === 'REJECTED' ? 'DRAFT' : detail?.status,
    canCancel: reimbursementOwnActions(detail, userId, permissions).canCancel,
    cancellationPending: claimIsBeingCancelled(detail),
    canResumeCancellation: detail?.pendingCancellation?.canResume === true,
  });
}

export function paymentVoidedMessage(detail: any, permissions: readonly string[], userId: string): string {
  if (detail?.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE')) return `${PAYMENT_VOIDED_LABEL} ${duplicateNoticeForViewer(detail, permissions, userId)}`;
  const actions = activeJourneyStep(buildJourneySteps(detail, permissions, userId))?.actions ?? [];
  const next = [actions.includes('pay') && 'บันทึกจ่ายใหม่', reimbursementOwnActions(detail, userId, permissions).canCancel && 'ยกเลิกใบเบิกต่อ'].filter(Boolean);
  return `${PAYMENT_VOIDED_LABEL}${next.length ? ` คุณสามารถ${next.join('หรือ')}ได้` : ''}`;
}

/**
 * What whoever records the payment does at the pay step, in one line. The rule of each method (a slip for a transfer,
 * a number for a cheque, the tick for the account) is said in the form, at the field it is about: before, the step
 * printed all five as one paragraph above its button, most of them for methods the payer had not chosen.
 */
export function payStepInstruction(detail: { payout?: { payoutMethod?: string | null } | null } | null | undefined): string {
  const method = detail?.payout?.payoutMethod;
  return method === 'BANK_TRANSFER' ? 'โอนตามบัญชีรับเงินในใบนี้ แล้วบันทึกจ่าย' : method === 'CASH' ? 'จ่ายเงินสดให้ผู้เบิก แล้วบันทึกจ่าย' : 'จ่ายเงินคืนให้ผู้เบิก แล้วบันทึกจ่าย';
}

export function duplicateCanBeCleared(claim: { duplicateBlocksPayment?: boolean; hasDuplicateBlocker?: boolean; duplicateReasons?: readonly string[] }): boolean {
  return (claim.duplicateBlocksPayment === true || claim.hasDuplicateBlocker === true) && !claim.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE');
}

/**
 * The claim as 4 or 5 steps with the actions open to this viewer. A projection of the existing
 * statuses: nothing is stored, every action still goes through its own endpoint, and the buttons
 * follow real permissions and server-resolved task authority — never role names (spec §6).
 */
export function buildJourneySteps(detail: any, permissions: readonly string[], userId: string): JourneyStep[] {
  const status = String(detail?.status ?? '');
  const review = String(detail?.financeReviewStatus ?? '');
  const withFinance = claimHasFinanceStep(detail);
  const keys: JourneyStepKey[] = ['items', 'approval', ...(withFinance ? ['finance' as const] : []), 'payment', 'document'];
  const ended = status === 'CANCELLED' || status === 'VOIDED';
  const atIndex = keys.indexOf(journeyStepAt(detail, withFinance));
  const own = reimbursementOwnActions(detail, userId, permissions);
  // This round's approval, by the one rule for a claim's approver (`isReimbursementClaimApprover` in contracts, the
  // API's own): still in force, and decided at or after the claim was last submitted. A step approved in an earlier
  // round (before a finance correction) is history. The copy of the rule that stood here compared the two dates as
  // text and, on a claim with no submission date, counted every approved step.
  const approval = (detail?.approvalSteps ?? []).filter((step: any) => !!step.decisionByUserId
    && isReimbursementClaimApprover(step.decisionByUserId, { submittedAt: detail?.submittedAt, approvalSteps: [step] })).at(-1);
  const humanApproved = !!approval;
  const signed = new Set((detail?.signatures ?? []).map((row: any) => row.role));
  const payment = (detail?.payments ?? []).filter((row: any) => row.status === 'RECORDED').at(-1);
  const confirmedDuplicate = detail?.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE') === true;
  const duplicate = ['POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE'].includes(detail?.duplicateStatus)
    ? DUPLICATE_STATUS_LABELS[detail.duplicateStatus] : undefined;
  // Payout spec §14: the claim's place in a correction round, and what the server says THIS viewer may do about
  // its payout account. Both buttons of a round come from those flags alone, never from a permission or a role.
  const round = payoutCorrectionRound(detail);
  const correction = detail?.payoutCorrectionActions;

  const activeStep = (key: JourneyStepKey): Pick<JourneyStep, 'note' | 'actions'> => {
    const actions: JourneyAction[] = [];
    let note: string | undefined;
    if (!ended && detail?.pendingCancellation) {
      // Audit B3: a cancellation was started and has not completed. The API takes no other decision on the
      // claim until it is finished or withdrawn, so those two are all the step offers (the server says to whom).
      if (detail.pendingCancellation.canResume === true) actions.push('resume-cancel');
      if (detail.pendingCancellation.canWithdraw === true) actions.push('withdraw-cancel');
      if (detail?.requestNo && status !== 'DRAFT') actions.push('print');
      return { note: pendingCancellationNote(detail.pendingCancellation, detail.certificateCancelBlocker?.message), actions };
    }
    if (ended) {
      note = status === 'CANCELLED' ? `ยกเลิกใบเบิกแล้ว${detail?.rejectionReason ? `: ${detail.rejectionReason}` : ''}` : 'เพิกถอนรายการแล้ว';
    } else if (key === 'items') {
      if (review === 'NEEDS_INFO') {
        note = financeStepActNote('ส่งกลับให้แก้ไข', detail);
        if (own.canEditDraft) actions.push('edit');
        if (own.canSubmit) actions.push('submit');
      } else {
        note = own.canSubmit || own.canEditDraft ? 'ตรวจรายการและหลักฐานให้ครบ แล้วกดส่งอนุมัติ' : 'รอผู้เบิกส่งอนุมัติ';
        if (own.canSubmit) actions.push('submit');
        if (own.canEditDraft) actions.push('edit');
      }
    } else if (key === 'approval' && status === 'REJECTED') {
      note = claimReturnedText(detail);
      if (own.canReopen) actions.push('reopen');
    } else if (key === 'approval' && detail?.awaitingSystem) {
      // Audit B4: the decision is on record and the system has not carried it out. Nothing is decided again:
      // the one action is to have the system carry on, offered to whoever the server says it takes it from.
      if (detail.awaitingSystem.canResume === true) actions.push('resume');
      note = awaitingSystemNote(detail, approval?.decidedByName ?? approval?.approverName);
    } else if (key === 'approval' && round) {
      // Sent back from the pay step for its payout account. The account alone is decided again: the step offers no
      // refusal of the claim and no return to a draft, which the API takes from nobody while a round is open. Its
      // approvers send it back once more instead, with the same call that opened the round.
      if (round.phase === 'AWAITING_APPROVAL' && detail?.approvalActions?.canApprove === true) actions.push('approve');
      if (correction?.canSubmit === true) actions.push('correct-payout');
      if (!confirmedDuplicate && correction?.canRequest === true) actions.push('send-back');
      note = payoutCorrectionStepNote(detail, round, {
        canApprove: actions.includes('approve'), canSubmit: actions.includes('correct-payout'), isRequester: detail?.requesterUserId === userId,
      });
    } else if (key === 'approval') {
      if (detail?.approvalActions?.canApprove === true) actions.push('approve');
      if (detail?.approvalActions?.canReject === true) actions.push('reject');
      const waiting = `รอ ${currentDeskText(detail?.currentDesk) ?? CURRENT_DESK_LABELS.APPROVER} อนุมัติ`;
      // The header already says whose turn it is; the note says what to look at. Not "ด้านล่าง": the lines and receipts are above the step on a phone and beside it on a wide screen.
      note = actions.length > 0 ? 'ตรวจรายการและใบเสร็จก่อนอนุมัติ' : waiting;
      // spec §15: the requester would decide this claim but for the self-approval switch. The claim
      // froze the switch at submit, so turning it on helps only once the claim is sent again.
      if (detail?.approvalActions?.selfApprovalBlocked === true) {
        const canManagePolicy = permissions.includes('reimbursement.policy.manage');
        // True wherever the server sends the flag, and nothing more: the long sentence of the refusal sent an owner to
        // a switch that alone did not let them approve (their role was not among the approvers), walked 2026-10-13.
        note = `${waiting} · ${SELF_APPROVAL_STEP_NOTE}`;
        if (canManagePolicy) actions.push('policy-settings');
      }
      // spec §6: the requester takes back a claim nobody has decided yet — the same reopen as a refusal.
      if (!humanApproved && detail?.requesterUserId === userId && permissions.includes('reimbursement.update_own_draft')) {
        actions.push('reopen');
      }
    } else if (key === 'finance') {
      // The finance endpoint only accepts FINANCE_REVIEW; an APPROVED claim is still being routed.
      if (status === 'FINANCE_REVIEW' && permissions.includes('reimbursement.finance_review')) {
        actions.push('finance-approve');
        if (review !== 'APPROVED_FOR_PAYMENT') actions.push('finance-return');
        if (review === 'PENDING') actions.push('finance-block');
      }
      note = review === 'BLOCKED'
        ? financeStepActNote('ระงับการจ่าย', detail)
        : actions.length > 0 ? 'ตรวจใบเสร็จและรายการซ้ำ แล้วอนุมัติจ่ายหรือส่งกลับให้แก้ไข' : WAITING_FOR_FINANCE;
    } else if (key === 'payment') {
      // APPROVED here is the no-finance claim waiting for its projection; the API accepts payment then.
      const payable = ['READY_FOR_PAYMENT', 'APPROVED'].includes(status);
      if (detail?.hasVoidedProjections) {
        note = REIMBURSEMENT_PROJECTION_VOIDED_MESSAGE;
      } else if (confirmedDuplicate) {
        note = duplicateNoticeForViewer(detail, permissions, userId);
        if (canVoidRecordedPayment(payment, permissions)) actions.push('void-payment');
      } else if (payable && (detail?.duplicateBlocksPayment === true || detail?.duplicateReasons?.includes('EXPENSE_CONFIRMATION'))) {
        // The API refuses payment until the block is cleared with a reason.
        // Owner 2026-09-21: a claim has only a requester and an approver, so whoever records the
        // payment clears the duplicate block with a reason; duplicate.resolve holders still can too.
        const canResolve = permissions.includes('reimbursement.payment.record') || permissions.includes('reimbursement.duplicate.resolve');
        if (canResolve) actions.push('resolve-duplicate');
        const reasons = detail.duplicateReasons ?? (detail.duplicateCandidates ?? []).filter((candidate: any) => candidate.status === 'OPEN').map((candidate: any) => candidate.candidateType);
        note = canResolve ? reimbursementDuplicateBlockNotice(reasons)
          : `${REIMBURSEMENT_DUPLICATE_BLOCK_LABEL}: ${reimbursementDuplicateReasonText(reasons)} รอ${PAYER}ตรวจรายการซ้ำและปลดก่อน จึงจะบันทึกจ่ายได้`;
      } else {
        const canPay = permissions.includes('reimbursement.payment.record');
        // The payment endpoint refuses a claim with no branch for everyone, so nobody is offered the
        // button for one: a button that can only be answered with a refusal is not an action.
        const noBranch = payable && !detail?.branchId;
        if (payable && canPay && !noBranch) actions.push('pay');
        // Spec §18.3 and §13.4: whoever cannot pay reads who can, and the approver of this claim is told so plainly.
        const payers = paymentDeskText(detail?.paymentDesk);
        const waiting = noBranch
          ? 'ใบนี้ไม่ได้ระบุสาขา ระบบจึงยังบันทึกจ่ายไม่ได้ ติดต่อผู้ดูแลระบบ'
          : detail?.paymentDesk && !payers
          ? 'ยังไม่มีผู้ที่บันทึกจ่ายใบของสาขานี้ได้ ขอให้เจ้าของกิจการบันทึกจ่ายหรือเพิ่มสิทธิ์'
          : !canPay && approval?.decisionByUserId === userId
            ? `คุณอนุมัติใบนี้แล้ว แต่บัญชีของคุณยังไม่มีสิทธิ์บันทึกจ่าย ${payers ? `ผู้ที่บันทึกจ่ายได้: ${payers} ` : ''}ถ้าต้องการจ่ายเอง ขอให้เจ้าของกิจการเพิ่มสิทธิ์บันทึกจ่ายให้บทบาทของคุณ`
            : waitingForPayer(detail);
        note = [actions.length > 0 ? payStepInstruction(detail) : waiting, duplicate].filter(Boolean).join(' · ');
      }
    } else if (key === 'document' && detail?.documentSignedVia) {
      // Done in the system or on paper (A4); the latest declared scan names who attached it and when.
      note = detail.documentSignedVia === 'DIGITAL' ? 'เซ็นในระบบครบแล้ว'
        : paperSignedLine((detail.signedCopies ?? []).find((copy: any) => copy.acknowledgedAt));
    } else if (key === 'document') {
      const signAction = claimSignAction(detail, userId);
      if (eligibleSignatureRoles(detail, userId).some((role) => !signed.has(role))) actions.push('sign');
      // §18.2: name who the document still waits for. The blocks the form needs are the server's own
      // (`documentSignedVia`): ผู้อนุมัติ only when a person approved, ฝ่ายบัญชี only when finance reviewed.
      const signers: Record<ClaimSignatureRole, string | undefined> = {
        REQUESTER: detail?.requesterDisplayNameSnapshot, APPROVER: approval?.decidedByName ?? approval?.approverName,
        FINANCE_REVIEW: detail?.financeReviewedByName, PAYER: payment?.paidByName,
      };
      // A legacy four-block form titles its payer block "ฝ่ายการเงิน". On a claim with no finance-review step there
      // is no finance desk to wait for (spec §18.3), so that signer is named as the payment step names them.
      const blockLabel = (role: ClaimSignatureRole) => (role === 'PAYER' && !withFinance ? PAYER : CLAIM_SIGNATURE_ROLE_LABELS[role]);
      const unsigned = claimSignatureSlots(detail)
        .filter((role) => !signed.has(role) && (role !== 'APPROVER' || humanApproved) && (role !== 'FINANCE_REVIEW' || review !== 'NOT_REQUIRED'))
        .map((role) => `รอ${blockLabel(role)}เซ็น${signers[role] ? ` (${signers[role]})` : ''}`);
      note = [
        unsigned.length > 0 ? unsigned.join(' และ') : 'แนบใบเบิกที่เซ็นแล้ว',
        actions.includes('sign') && (signAction?.label === CLAIM_SIGN_LABEL
          ? `คุณยังไม่ได้เซ็น กด${CLAIM_SIGN_LABEL}` : `คุณยังเซ็นไม่ครบ กด${signAction?.label}เพื่อเติมลายเซ็น`),
      ].filter(Boolean).join(' · ');
    }
    // Spec §14.3: a claim that waits for its payment is sent back for its account by whoever the server says may:
    // whoever may record its payment, the approver it stands on, or its requester. The page offers it at the foot of
    // the account box, where a wrong account is found, and says it there: not among the buttons of this step, where
    // one wrong tap beside "บันทึกจ่าย" took both signatures off a claim that only needed paying.
    if (!ended && !detail?.hasVoidedProjections && !confirmedDuplicate && key === 'payment' && !round && correction?.canRequest === true) actions.push('send-back');
    if (!ended && own.canCancel) actions.push('cancel');
    // No requestNo, no document: drafts and claims cancelled out of DRAFT never got one.
    if (detail?.requestNo && status !== 'DRAFT') actions.push('print');
    if (!ended && key === 'document') {
      if (canUploadSignedCopy(detail, userId, permissions)) actions.push('attach-signed-copy');
      if (canVoidRecordedPayment(payment, permissions)) actions.push('void-payment');
    }
    if (confirmedDuplicate && key !== 'payment') note = [note, duplicateNoticeForViewer(detail, permissions, userId)].filter(Boolean).join(' · ');
    return { note, actions };
  };

  return keys.slice(0, ended ? atIndex + 1 : keys.length).map((key, index): JourneyStep => {
    const base = { key, label: JOURNEY_STEP_LABELS[key] };
    if (index < atIndex) {
      return key === 'approval' && !!detail?.approvedAt && !humanApproved
        ? { ...base, state: 'done', note: 'ไม่ต้องอนุมัติตามนโยบาย', actions: [] }
        : { ...base, state: 'done', actions: [] };
    }
    // A document signed before payment stays upcoming (§15): the journey still waits at จ่ายเงินคืน.
    if (index > atIndex) {
      // Spec §14.2: a round takes the claim back to its approval step with the same number of steps. The finance
      // review it passed stands and is not done again, so that step still reads as passed.
      return key === 'finance' && round && review === 'APPROVED_FOR_PAYMENT'
        ? { ...base, state: 'done', note: 'ตรวจแล้ว ไม่ต้องตรวจซ้ำ', actions: [] }
        : { ...base, state: 'upcoming', actions: [] };
    }
    const signedDocument = key === 'document' && !!detail?.documentSignedVia;
    // Waiting for its requester to give the account again is a step to put right, like a refusal (spec §14.2).
    const toFix = status === 'REJECTED' || (round?.phase === 'AWAITING_REQUESTER' && !detail?.pendingCancellation);
    return { ...base, state: ended ? 'ended' : toFix ? 'needs-fix' : signedDocument ? 'done' : 'current', ...activeStep(key) };
  });
}

/**
 * The step the journey card is about: where the claim stands, was refused, or stopped — or, once a paid
 * claim's document is signed and every step is done, that last step (reprint, attach again, void).
 */
export function activeJourneyStep(steps: readonly JourneyStep[]): JourneyStep | undefined {
  return steps.find((step) => step.state !== 'done' && step.state !== 'upcoming') ?? steps.at(-1);
}

/**
 * Why a draft is on the edit page again when someone sent it back: finance asked for a correction, or an approver
 * rejected it and its requester reopened it. Null for a draft nobody sent back: one never sent, or one its requester
 * took back themselves. The edit page says "ตามเหตุผลที่ส่งกลับ" only beside such a reason (a draft made before the
 * release read that way with nobody having sent it back).
 */
export function draftSentBackNote(detail: any): string | null {
  if (detail?.financeReviewStatus === 'NEEDS_INFO') return financeStepActNote('ส่งกลับให้แก้ไข', detail);
  // The step the claim was last put before: rejected means its approver sent it back; cancelled means the requester withdrew it.
  const moment = (step: any) => Date.parse(String(step?.assignedAt ?? step?.decidedAt ?? '')) || 0;
  const last = [...(detail?.approvalSteps ?? [])].sort((left, right) => moment(left) - moment(right)).at(-1);
  return last?.status === 'REJECTED' ? claimReturnedText({ approvalSteps: [last] }) : null;
}

/** "เซ็นบนกระดาษ · แนบเมื่อ … โดย …" for a scan attached with the A4 declaration; parts the detail lacks are left out. */
export function paperSignedLine(copy?: { acknowledgedAt?: string; acknowledgedByName?: string }): string {
  return `เซ็นบนกระดาษ${copy?.acknowledgedAt ? ` · แนบเมื่อ ${formatThaiDate(copy.acknowledgedAt)}` : ''}${copy?.acknowledgedByName ? ` โดย ${copy.acknowledgedByName}` : ''}`;
}

// ---- A payout account correction round (payout spec §14) ----

/** What the approvers of a round are shown to compare, and everyone else of the claim to read. */
export type PayoutCorrectionComparison = {
  /** "สิ่งที่รออนุมัติ: …": the thing the approvers approve, by what was answered. */
  title: string;
  /**
   * The names of what the card sets side by side: what the claim had, then what was given. One name where the
   * destination was kept (the server compared what it stores): the card then shows that one destination under it,
   * and no two that read alike.
   */
  labels: readonly string[];
  /** What the claim was approved with, masked; a claim sent before claims carried an account says it had none. */
  previous: string;
  /** What the claim has now, masked: the answer that waits. */
  current: string;
  /** That the lines and the amount are what was approved, when that was, and what this approval looks at. */
  unchanged: string;
  /** Who sent the claim back and why, with the note they added. */
  sentBack: string;
  note?: string;
  /** Who answered, what they did, and when. */
  submitted?: string;
};

/** The card of an answer this build has no record of (a page fed by an older server): names true of every answer. */
const UNKNOWN_ANSWER_CARD = { cardTitle: 'สิ่งที่รออนุมัติ: วิธีรับเงินคืน', cardRows: ['วิธีรับเงินคืนก่อนส่งกลับ', 'วิธีรับเงินคืนที่ส่งมา'] } as const;

/**
 * The card "สิ่งที่รออนุมัติ: …" of a claim whose answer waits for approval (spec §14.6): what the claim had beside what
 * was given, an account by its last 4 digits only, and that nothing else of the claim moved since it was approved.
 * Its title and the names of its rows are the contracts' own for what was answered: "บัญชีเดิม" beside "บัญชีใหม่" only
 * where an account replaced an account, "วิธีรับเงินคืน…" where cash is on either side, one row where nothing changed.
 * Null for a claim that is not there: the page then shows no card.
 */
export function payoutCorrectionComparison(detail: any): PayoutCorrectionComparison | null {
  const round = detail?.payoutCorrection;
  if (round?.phase !== 'AWAITING_APPROVAL') return null;
  const answer = payoutRoundAnswer(detail.payoutCorrectionAnswer);
  const card = answer ? REIMBURSEMENT_PAYOUT_ROUND_TEXTS.answer[answer] : UNKNOWN_ANSWER_CARD;
  // The send-back this answer answers: the latest of the round's events. What the claim held then is that event's
  // own fact, for the claim now holds what was answered.
  const sentBack = [...(detail.payoutCorrectionHistory ?? [])].reverse().find((event: any) => event.kind === 'SENT_BACK');
  return {
    title: card.cardTitle,
    labels: card.cardRows,
    previous: payoutCorrectionAccountText(round.previous),
    current: payoutCorrectionAccountText(detail.payout),
    unchanged: `รายการและยอดเงิน ${formatMoney(detail.amount, detail.currency)} เท่ากับที่อนุมัติไว้${
      round.previouslyApprovedAt ? `เมื่อ ${formatThaiDateTime(round.previouslyApprovedAt)}` : ''} ${payoutRoundTexts(detail).given.cardChecks}`,
    sentBack: payoutCorrectionSentBackText({
      byName: round.requestedByName, reasonCode: round.reasonCode, held: sentBack?.held, payoutKind: payoutKindHeldAt(detail.payoutHistory, sentBack?.at),
    }),
    ...(round.note && { note: round.note }),
    ...(round.submittedAt && { submitted: `${payoutCorrectionAnsweredText(answer, detail.payoutCorrectionAnsweredBy)} เมื่อ ${formatThaiDateTime(round.submittedAt)}` }),
  };
}

// ---- Policy decision preview (ตั้งค่านโยบาย — spec §7) ----

/**
 * What happens to a claim at/above and below the approval threshold, in the page's words.
 * With no holder of the chosen role the route falls back to the owner (routing policy D8), so the
 * line says so — except for the owner route itself.
 */
export function policyDecisionPreview(input: {
  approvalRequiredFromAmount: unknown;
  approverLabel: string;
  ownerRoute: boolean;
  financeReviewRequired: boolean;
}): Array<{ title: string; path: string }> {
  const amount = formatMoney(input.approvalRequiredFromAmount);
  const payout = input.financeReviewRequired ? 'ฝ่ายการเงินตรวจ → จ่ายเงินคืน' : 'จ่ายเงินคืน';
  const approver = input.approverLabel || 'บทบาทที่เลือก';
  return [
    { title: `ยอดตั้งแต่ ${amount}`, path: `${input.ownerRoute ? approver : `${approver} (ถ้าไม่มี เจ้าของกิจการ)`} → ${payout}` },
    { title: `ยอดต่ำกว่า ${amount}`, path: `ไม่ต้องรอผู้อนุมัติ → ${payout}` },
  ];
}

/**
 * Spec §13.3 F2: with finance review off the approver is the one expected to pay, so a chosen approver role
 * that cannot record payment leaves approved claims waiting for someone else. Saving is still allowed (a
 * company may want that), so this only warns. Null when there is nothing to say. Only a role that can still
 * approve (`selectable`) is named: a ticked role that is no longer ready approves nothing, and the screen
 * already says so.
 */
export function approverPaymentWarning(
  selectedRoles: readonly { label: string; selectable: boolean; canRecordPayment?: boolean }[],
  financeReviewRequired: boolean,
): string | null {
  const labels = selectedRoles.filter((role) => role.selectable && role.canRecordPayment === false).map((role) => role.label);
  if (financeReviewRequired || labels.length === 0) return null;
  return `บทบาท ${labels.join(' และ ')} อนุมัติได้ แต่บันทึกจ่ายไม่ได้ ใบที่อนุมัติแล้วจะรอผู้ที่มีสิทธิ์บันทึกจ่าย ถ้าต้องการให้ผู้อนุมัติจ่ายเองได้ ให้เพิ่มสิทธิ์บันทึกจ่ายให้บทบาทนี้ในหน้าบทบาทและสิทธิ์`;
}

export function formatMoney(v: unknown, currency?: unknown): string {
  const amount = satang.format(typedAmount(String(v ?? 0)) as `${number}`);
  return `${amount} ${currencyWord(currency)}`;
}

/* Owner rule 2026-09-27/29: plain Thai, no id, enum key, code or ISO date on screen, and the same words as
 * the LINE card (apps/api/.../line-reimbursement-draft-card.logic.ts). */
const satang = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "บาท" for the one currency a claim takes, never the code. */
const currencyWord = (currency: unknown) => (!currency || currency === 'THB' ? 'บาท' : String(currency));
/** "1,234.50 บาท", like formatMoney, but the decimal string is formatted as is (no float) and rounds half up like the API. */
export function money(value: unknown, currency?: unknown) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(value)) return 'ยังตรวจสอบจำนวนเงินไม่ได้';
  return formatMoney(value, currency);
}
/** A category by its Thai label; a missing label never falls back to the key. */
export const categoryText = (label: unknown) => (typeof label === 'string' && label.trim()) || 'ยังไม่ได้เลือกหมวด';

function reimbursementDuplicateReasonText(reasons: readonly string[]) {
  return sharedDuplicateReasonText(reasons).replaceAll('คำขอเบิก', 'ใบเบิก');
}
function reimbursementDuplicateBlockNotice(...args: Parameters<typeof sharedDuplicateBlockNotice>) {
  return sharedDuplicateBlockNotice(...args)?.replaceAll('คำขอเบิก', 'ใบเบิก').replace('ตรวจแล้วถ้าไม่ซ้ำ กดปลดรายการซ้ำพร้อมเหตุผล เพื่อปลดและยืนยันเอกสารก่อนบันทึกจ่าย ถ้าการยืนยันยังไม่เสร็จ กดปลดรายการซ้ำอีกครั้ง', 'ตรวจเอกสารที่อาจซ้ำ แล้วเลือกไม่ซ้ำพร้อมเหตุผลก่อนจ่าย');
}

function translateApiError(...args: Parameters<typeof sharedTranslateApiError>) {
 return sharedTranslateApiError(...args)?.replaceAll('ไม่อนุมัติ', 'ส่งกลับให้แก้').replaceAll('แนบสลิป', 'แนบหลักฐานการจ่าย').replaceAll('ดูสลิป', 'ดูหลักฐานการจ่าย') ?? null;
}


/** One list badge: stale receipt/signature gaps must never overrule a terminal state. */
export function claimListBadge(claim: any): ReturnType<typeof claimStatusBadge> {
  const base = claimStatusBadge(claim);
  if (claim.status === 'PAID' && claim.documentSignedVia === null) return { label: 'รอเซ็นใบเบิก', tone: 'amber' };
  if (['PAID', 'CANCELLED', 'VOIDED'].includes(claim.status)) return base;
  if (claim.cancellationPending) return { label: 'รอยกเลิก', tone: 'amber' };
  if (claim.currentDesk?.kind === 'SYSTEM' || reimbursementDuplicateWait(claim)?.status || reimbursementPayoutRoundStatus(claim)) return base;
  if (claim.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE')) return { label: 'ยืนยันว่าใบเสร็จซ้ำ', tone: 'amber' };
  if ((claim.status === 'FINANCE_REVIEW' && claim.hasDuplicateBlocker) || ['POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE'].includes(claim.duplicateStatus)) return { label: 'อาจซ้ำ', tone: 'amber' };
  if (claim.financeReviewStatus === 'BLOCKED') return { label: 'ระงับการจ่าย', tone: 'danger' };
  if (claim.status === 'DRAFT' && claim.receiptRequirementStatus === 'REQUIRED') return { label: 'ยังไม่มีใบเสร็จ', tone: 'amber' };
  if (claim.status === 'REJECTED' || claim.needsCorrection) return { label: 'ส่งกลับให้แก้', tone: 'amber' };
  if (claim.status === 'READY_FOR_PAYMENT') return { label: 'รอจ่าย', tone: 'teal' };
  return base;
}

export function sortClaimRows<T extends { id: string; incurredDate?: string; createdAt?: string }>(rows: readonly T[], order: 'newest' | 'oldest'): T[] {
  return [...rows].sort((a, b) => ((a.incurredDate ?? '').localeCompare(b.incurredDate ?? '')
    || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)) * (order === 'oldest' ? 1 : -1));
}

/** Queues are already fully read and permission scoped by their existing endpoint. */
export function claimQueueMetrics(rows: readonly any[]) {
  const group = (items: readonly any[]) => ({ count: items.length, amount: String(items.reduce((sum, row) => sum + Number(row.amount || 0), 0)) });
  return { all: group(rows), pendingApproval: group(rows.filter(row => row.status === 'PENDING_APPROVAL' && row.currentDesk?.kind !== 'REQUESTER')),
    pendingPayment: group(rows.filter(row => ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'].includes(row.status) || (row.status === 'APPROVED' && row.currentDesk?.kind === 'PAYMENT'))) };
}
