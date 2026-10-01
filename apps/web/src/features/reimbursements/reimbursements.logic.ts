// Pure client-side helpers for the reimbursement forms (mirror server rules for UX only).

import {
  REIMBURSEMENT_PAYMENT_SLIP_MAX_FILES, reimbursementIncurredDateError, reimbursementPaymentSlipRequired, todayCivilDate,
  type ReimbursementHubBucket, type ReimbursementHubSummary,
} from '@watchdog-bms/contracts';
import { apiErrorMessage, translateApiError } from '@/common/api/api-error-message';
import { formatThaiDate } from '@/common/i18n/thai-date';
import {
  CLAIM_SIGNATURE_ROLE_LABELS, CURRENT_DESK_LABELS, DUPLICATE_STATUS_LABELS, currentDeskText, ERROR_CODE_LABELS,
  canUploadSignedCopy, canVoidRecordedPayment, claimSignatureSlots, eligibleSignatureRoles, paymentDeskText, reimbursementOwnActions,
  type ClaimSignatureRole,
} from './reimbursements.model';
import { payoutComparableText } from './reimbursement-payout.logic';

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
  return parts.map((part) => ERROR_CODE_LABELS[part] ?? translateApiError(part)
    ?? apiErrorMessage(parts.length === 1 ? source : Object.assign(new Error(part), { kind: 'unknown' }))).join(' · ');
}

/**
 * Object-aware variant for thrown fetch errors: a deny-by-default guard 403 carries only a
 * stable `code` (its message is the synthetic "API error 403"), so consult the code first,
 * then fall back to the message-string translation above.
 */
export function errorText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const viaCode = typeof code === 'string' ? ERROR_CODE_LABELS[code] ?? translateApiError(code) : null;
  if (viaCode) return viaCode;
  return errorMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', e);
}

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
 * who can fix it where it failed: a policy manager picks an approver in ตั้งค่าเบิกจ่าย (the page
 * offers the link), anyone else asks the owner. Null for every other error.
 */
export function approverNotReadyHelp(e: unknown, permissions: readonly string[]): { text: string; policyLink: boolean } | null {
  if (!(e instanceof Error && e.message.includes('reimbursement_approver_not_ready'))) return null;
  const policyLink = permissions.includes('reimbursement.policy.manage');
  return {
    policyLink,
    text: policyLink
      ? 'ยังไม่มีผู้อนุมัติใบเบิกนี้ เลือกบทบาทผู้อนุมัติในตั้งค่าเบิกจ่าย (บทบาทนั้นต้องมีสิทธิ์อนุมัติการเบิก) แล้วกลับมากดส่งอนุมัติอีกครั้ง'
      : 'ยังไม่มีผู้อนุมัติใบเบิกนี้ ขอให้เจ้าของกิจการเลือกผู้อนุมัติในตั้งค่าเบิกจ่าย หรือเพิ่มสิทธิ์อนุมัติการเบิกให้บทบาทของคุณ แล้วกดส่งอนุมัติอีกครั้ง',
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

export function paymentReferenceRequired(method: string): boolean {
  return method === 'BANK_TRANSFER' || method === 'CHEQUE';
}

/**
 * Client-side validation of the full-payment form. Returns an error key or null.
 * The method is never chosen for the payer, and the slip rule is the API's own
 * (`reimbursementPaymentSlipRequired`), so the form and the server refuse the same payments.
 */
export function validatePaymentForm(input: {
  paidAmount: string;
  outstandingAmount: string;
  paymentMethod: string;
  paymentReference?: string;
  hasSlip?: boolean;
}): string | null {
  if (!input.paymentMethod) return 'กรุณาเลือกวิธีจ่าย';
  const paid = Number(input.paidAmount);
  const outstanding = Number(input.outstandingAmount);
  if (!(paid > 0)) return 'จำนวนเงินต้องมากกว่า 0';
  if (paid > outstanding) return 'จำนวนเงินเกินยอดที่อนุมัติ';
  if (paid !== outstanding) return 'ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น';
  if (paymentReferenceRequired(input.paymentMethod) && (!input.paymentReference || input.paymentReference.trim() === '')) {
    return 'ต้องระบุเลขอ้างอิงสำหรับการโอนเงิน/เช็ค';
  }
  // The API's own words for the same refusal, so the form and the server say one thing.
  if (reimbursementPaymentSlipRequired(input.paymentMethod) && !input.hasSlip) return translateApiError('payment_slip_required');
  return null;
}

// ---- Payment slips (สลิปการจ่ายเงินคืน) ----

/** A file already on the claim that can serve as the slip of a payment, without uploading it again. */
export type PaymentSlipChoice = { attachmentId: string; label: string; kind: 'previous-slip' | 'signed-copy' };

/**
 * Files already attached to the claim that the payer may use as the slip: slips of payments since
 * voided (the same transfer, recorded again), and files in ใบเบิกที่เซ็นแล้ว (a slip attached there
 * by mistake). The API accepts exactly these two kinds beside a fresh slip upload.
 */
export function paymentSlipChoices(detail: any): PaymentSlipChoice[] {
  const choices: PaymentSlipChoice[] = [];
  const add = (choice: PaymentSlipChoice) => { if (!choices.some((row) => row.attachmentId === choice.attachmentId)) choices.push(choice); };
  for (const payment of detail?.payments ?? []) {
    if (payment.status !== 'VOIDED') continue;
    const slips: any[] = payment.slips ?? [];
    slips.forEach((slip, index) => add({
      attachmentId: slip.attachmentId, kind: 'previous-slip',
      label: `สลิปของการจ่ายที่ยกเลิกแล้ว ${payment.paymentNo ?? ''}`.trim() + (slips.length > 1 ? ` (ไฟล์ที่ ${index + 1})` : ''),
    }));
  }
  for (const copy of detail?.signedCopies ?? []) {
    add({ attachmentId: copy.attachmentId, kind: 'signed-copy', label: `${copy.fileName} · แนบไว้ที่ใบเบิกที่เซ็นแล้ว` });
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
 * What the payer confirms before a file leaves ใบเบิกที่เซ็นแล้ว to become a payment's slip (spec §16.2):
 * nothing is uploaded again, a "signed on paper" declaration made with that file is withdrawn, and
 * the file is from then on opened only by the slip's own readers.
 */
export function signedCopyMoveConfirmText(copy: { fileName?: string; acknowledgedAt?: string }, payment: { paymentNo?: string }): string {
  return [
    `ไฟล์ ${copy.fileName ?? 'นี้'} จะย้ายจากรายการใบเบิกที่เซ็นแล้ว ไปเป็นสลิปของการจ่าย${payment.paymentNo ? ` ${payment.paymentNo}` : 'นี้'} โดยไม่ต้องอัปโหลดใหม่`,
    ...(copy.acknowledgedAt ? ['ไฟล์นี้เคยถูกยืนยันว่าเป็นใบเบิกที่ลงนามครบ ระบบจะถอนการยืนยันนั้น ใบเบิกจะไม่นับว่าลงนามบนกระดาษจากไฟล์นี้อีก'] : []),
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
  if (stage === 'slip-upload') return `อัปโหลดสลิปไม่สำเร็จ ระบบยังไม่ได้บันทึกจ่าย · ${errorText(error)}`;
  if (isLostPaymentRace(error)) return 'ยังบันทึกจ่ายไม่สำเร็จ เพราะมีการทำรายการกับใบนี้ในเวลาเดียวกัน กดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่';
  const reason = errorText(error);
  if ((error as { status?: unknown } | null)?.status === 409) return `ยังบันทึกจ่ายไม่สำเร็จ · ${reason}`;
  return slipKept
    ? `แนบสลิปแล้ว แต่ยังบันทึกจ่ายไม่สำเร็จ · ${reason} · ตรวจข้อมูลแล้วกดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่`
    : `ยังบันทึกจ่ายไม่สำเร็จ · ${reason}`;
}

/** What the payment form holds as its slip: a file picked but not sent yet, or one the API already holds. */
export type PaymentFormSlip = { file: File } | { attachmentId: string; name: string };

/** What lives as long as one opened payment form, across every press of บันทึกจ่าย. */
export type PaymentFormSession = { idempotencyKey: string | null; saving: boolean };

export type PaymentFormSave =
  | { status: 'saved' }
  /** Nothing was sent, or the save failed. `text` is the plain-Thai sentence the form shows, never a raw error. */
  | { status: 'refused'; text: string }
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
 */
export async function savePaymentForm(
  input: {
    form: { paidAmount: string; paymentMethod: string; paidAt: string; paymentReference: string };
    outstandingAmount: string;
    slip: PaymentFormSlip | null;
    session: PaymentFormSession;
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
  const { form, slip, session } = input;
  if (session.saving) return { status: 'ignored' };
  const invalid = validatePaymentForm({ ...form, outstandingAmount: input.outstandingAmount, hasSlip: slip !== null });
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
      // Phase 1 seam: the verified payout account's version and the payer's confirmation join this body.
      await deps.recordPayment({
        ...form, paidAt: new Date(form.paidAt).toISOString(), paymentReference: form.paymentReference || undefined,
        slipAttachmentId, idempotencyKey: session.idempotencyKey,
      });
    } catch (error) {
      return { status: 'refused', text: paymentSaveErrorMessage('record', error, slipAttachmentId !== undefined) };
    }
    return { status: 'saved' };
  } finally {
    session.saving = false;
    deps.onBusy?.(false);
  }
}

/** Tailwind's `sm`: from this width up, the finance queue's quick pay may open as a dialog. */
export const PAYMENT_DIALOG_MEDIA_QUERY = '(min-width: 640px)';

/**
 * Where "บันทึกจ่าย" on a finance-queue row leads. On a phone the payment form is never a dialog
 * (spec §12.2, §21): it opens in the payment step card of the claim's own page, where the claim's
 * files and the account to pay sit beside it.
 */
export function quickPayTarget(wideEnoughForDialog: boolean, companyId: string, requestId: string):
  { kind: 'dialog' } | { kind: 'page'; href: string } {
  return wideEnoughForDialog
    ? { kind: 'dialog' }
    : { kind: 'page', href: `/companies/${companyId}/reimbursements/${requestId}?pay=1` };
}

/** The claim page opens its payment form on arrival only when the link asked for it and this viewer's current step offers it. */
export function opensPaymentFormOnArrival(requested: boolean, activeStep: { actions: readonly string[] } | undefined | null): boolean {
  return requested && Boolean(activeStep?.actions.includes('pay'));
}

export const MAX_CLAIM_LINES = 50;

export type ClaimFormLine = { incurredDate: string; description: string; purpose?: string; categoryKey: string; amount: string; hasReceipt?: boolean };

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

/** รวมเป็นเงิน of the rows being typed (display only — the server owns the real rollup). */
export function sumLineAmounts(lines: readonly { amount: string }[]): number {
  return lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
}

export type QueueSummary = { count: number; totalAmount: number; outstandingAmount: number; flagged: number };

/**
 * Rollup of a loaded queue for the summary cards. Display only — the server owns the real numbers.
 * `flagged` counts rows the queue wants to draw attention to (SLA risk or a duplicate blocker).
 */
export function summariseQueue(rows: readonly any[]): QueueSummary {
  return (rows ?? []).reduce((acc, r) => ({
    count: acc.count + 1,
    totalAmount: acc.totalAmount + (Number(r?.amount) || 0),
    outstandingAmount: acc.outstandingAmount + (Number(r?.outstandingAmount) || 0),
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

/** Client-side validation of the multi-line claim form. Returns a message or null. */
export function validateRequestForm(input: { reason: string; missingReceiptReason?: string; lines: readonly ClaimFormLine[] }, today = todayCivilDate()): string | null {
  if (!input.reason || input.reason.trim() === '') return 'กรุณาระบุเหตุผล';
  if (!input.lines || input.lines.length === 0) return 'ต้องมีอย่างน้อย 1 รายการ';
  if (input.lines.length > MAX_CLAIM_LINES) return `ใบเบิกหนึ่งใบมีได้ไม่เกิน ${MAX_CLAIM_LINES} รายการ`;
  for (const [index, line] of input.lines.entries()) {
    const no = index + 1;
    if (!line.description || line.description.trim() === '') return `รายการที่ ${no}: กรุณาระบุรายการ`;
    if (!line.categoryKey || line.categoryKey.trim() === '') return `รายการที่ ${no}: กรุณาเลือกหมวด`;
    if (!line.incurredDate) return `รายการที่ ${no}: กรุณาระบุวันที่`;
    const dateError = reimbursementIncurredDateError(line.incurredDate, today);
    if (dateError) return errorMessage(`${dateError}:${no}`);
    if (!(Number(line.amount) > 0)) return `รายการที่ ${no}: จำนวนเงินต้องมากกว่า 0`;
  }
  if (!(sumLineAmounts(input.lines) > 0)) return 'ยอดรวมต้องมากกว่า 0';
  // Mirrors the server guard (`missing_receipt_reason_required`): a row with no receipt becomes
  // an expense at ตรวจสอบการเงิน that cannot be confirmed without this reason.
  if (input.lines.some((line) => !line.hasReceipt) && !input.missingReceiptReason?.trim()) {
    return 'มีรายการที่ยังไม่แนบใบเสร็จ กรุณาระบุ "เหตุผลที่ไม่มีใบเสร็จ" หรือแนบใบเสร็จให้ครบทุกรายการ';
  }
  return null;
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
  finance: ['reimbursement.finance_review'],
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

// ---- หน้ารวม: summary cards, filter chips and the list they filter (spec §18.1) ----

/**
 * "ทั้งหมด" or one bucket. The API places every claim in exactly one bucket (`reimbursementHubBucket`), counts
 * the buckets and filters the list by the same rule, so a card's number is the rows its filter shows.
 */
export type HubFilter = 'all' | ReimbursementHubBucket;

/** A card is the same filter as its chip; tapping the card that is already open goes back to ทั้งหมด. */
export function hubCardFilter(open: HubFilter, tapped: HubFilter): HubFilter {
  return open === tapped ? 'all' : tapped;
}

/** The rows of one hub list loaded so far, where the server's list goes on, and the scope as the server counted it. */
export type HubList = {
  /** The list these rows belong to (company, scope, filter, reload): rows of another list are never shown as this one's. */
  key: string;
  rows: any[];
  /** The server's count of the whole list. */
  total: number;
  /** The page to ask for when more rows are needed; null once the server has no more. */
  nextPage: number | null;
  /** Why the last page asked for did not arrive. Nothing more is asked until a retry clears it, and the rows stay. */
  failed?: string;
  /** What the cards and chips print: the whole scope, whatever filter the rows are of. Kept from one list to the next. */
  summary: ReimbursementHubSummary | null;
};
export const NO_HUB_LIST: HubList = { key: '', rows: [], total: 0, nextPage: 1, summary: null };
/** What the hub asks for; what counts is the page size the server answers with. */
export const HUB_PAGE_SIZE = 100;

export const hubListKey = (...parts: unknown[]) => parts.join('|');

/** What is held of this list. Rows loaded for another filter or scope, or before a reload, are not this list's. */
export function hubList(held: HubList, key: string): HubList {
  return held.key === key ? held : { ...NO_HUB_LIST, key, summary: held.summary };
}

/**
 * The page to ask the server for now, given how many rows the screen needs: the first page of a list, then
 * more only when the table page shown, or a search, reaches past what is held. Null: the rows needed are
 * loaded, the list is complete, or the last page failed.
 */
export function hubNextPage(list: HubList, need: number): number | null {
  return list.failed === undefined && list.rows.length < need ? list.nextPage : null;
}

/**
 * Adds one page. The list ends on the server's own total, or on a page shorter than the page size the
 * server answered with, never on the size that was asked for: the server may cap it.
 */
export function withHubPage(
  held: HubList, key: string,
  result: { items?: any[]; total: number; page: number; pageSize: number; hub: ReimbursementHubSummary },
): HubList {
  const items = result.items ?? [];
  // Keyed by id: a claim filed between two calls shifts the pages and would otherwise repeat a row.
  const byId = new Map<string, any>(hubList(held, key).rows.map((row) => [row.id, row]));
  for (const item of items) byId.set(item.id, item);
  const more = items.length > 0 && items.length >= result.pageSize && result.page * result.pageSize < result.total;
  return { key, rows: [...byId.values()], total: result.total, nextPage: more ? result.page + 1 : null, summary: result.hub };
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
    : { key: 'submit', state: 'current', label: 'รอผู้ยื่นส่งคำขอ' });

  // The waiting row names the same people the queue line does — one resolved list, never two.
  const waitingFor = currentDeskText(detail?.currentDesk) ?? CURRENT_DESK_LABELS.APPROVER;
  for (const step of [...(detail?.approvalSteps ?? [])].sort((a: any, b: any) => a.sequenceNo - b.sequenceNo)) {
    if (step.invalidatedAt) continue;
    const key = `step-${step.id ?? step.sequenceNo}`;
    const decidedBy = step.decidedByName ?? step.approverName ?? CURRENT_DESK_LABELS.APPROVER;
    if (step.status === 'APPROVED') rows.push({ key, state: 'done', label: `อนุมัติโดย ${decidedBy}`, date: step.decidedAt });
    else if (step.status === 'REJECTED') rows.push({ key, state: 'done', label: `ปฏิเสธโดย ${decidedBy}`, date: step.decidedAt });
    else if (step.status === 'PENDING') rows.push({ key, state: 'current', label: `กำลังรอ ${waitingFor} อนุมัติ` });
  }
  // Only a claim that IS rejected ends here. Reopen keeps the refused step, so a claim fixed and
  // resubmitted still carries it as history and its journey goes on.
  if (status === 'REJECTED') return rows;
  if (status === 'CANCELLED' || status === 'VOIDED') {
    return [...rows, { key: 'terminal', state: 'done', label: status === 'CANCELLED' ? 'ยกเลิกคำขอ' : 'เพิกถอนรายการ' }];
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
      label: detail.financeReviewedByName ? `ฝ่ายการเงินตรวจแล้ว โดย ${detail.financeReviewedByName}` : 'ฝ่ายการเงินตรวจแล้ว',
      date: detail.financeReviewedAt,
    });
  } else if (withFinance) {
    rows.push({ key: 'finance', state: at === 'finance' ? 'current' : 'future', label: at === 'finance' ? `กำลัง${WAITING_FOR_FINANCE}` : WAITING_FOR_FINANCE });
  }

  const paid = (detail?.payments ?? []).find((p: any) => p.status === 'RECORDED');
  rows.push(paid
    ? { key: 'payment', state: 'done', label: paid.paidByName ? `จ่ายแล้ว โดย ${paid.paidByName}` : 'จ่ายแล้ว', date: paid.paidAt }
    : { key: 'payment', state: at === 'payment' ? 'current' : 'future', label: at === 'payment' ? `กำลัง${waitingForPayer(detail)}` : 'รอบันทึกจ่าย' });
  return rows;
}

// Who a claim waits for, in the words of its desk: the timeline row and the step note print the same sentence,
// built from the pool label the "อยู่ที่ …" line and the LINE backlog answer use.
const WAITING_FOR_FINANCE = `รอ${CURRENT_DESK_LABELS.FINANCE}ตรวจ`;
/** The one person who records, or recorded, a claim's payment. Never "ฝ่ายการเงิน": most shops have no finance desk. */
const PAYER = 'ผู้บันทึกจ่าย';
/** "รอ สมศรี หรือ วิชัย บันทึกจ่าย" when the detail names who can pay; otherwise the pool, which already says it. */
function waitingForPayer(detail: any): string {
  const payers = paymentDeskText(detail?.paymentDesk);
  return payers ? `รอ ${payers} บันทึกจ่าย` : `รอ${CURRENT_DESK_LABELS.PAYMENT}`;
}

// ---- Journey steps (หน้า journey ต่อคำขอเบิกหนึ่งใบ — spec §5, §6) ----

export type JourneyStepKey = 'items' | 'approval' | 'finance' | 'payment' | 'document';
/** needs-fix = refused, waiting for the requester; ended = cancelled/voided here, nothing follows. */
export type JourneyStepState = 'done' | 'current' | 'upcoming' | 'needs-fix' | 'ended';
export type JourneyAction =
  | 'submit' | 'edit' | 'cancel' | 'reopen'
  | 'approve' | 'reject' | 'policy-settings'
  | 'finance-approve' | 'finance-return' | 'finance-block'
  | 'resolve-duplicate' | 'pay' | 'sign' | 'print' | 'attach-signed-copy' | 'void-payment';
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

/** Why an open duplicate candidate was raised, in words (submit only records these two matches). */
const DUPLICATE_MATCH_TEXT: Record<string, string> = {
  ATTACHMENT_CHECKSUM: 'ใช้ใบเสร็จเดียวกับคำขอเบิกอื่น',
  EXPENSE_LINK: 'ใช้รายการค่าใช้จ่ายเดียวกับคำขอเบิกอื่น',
};

function openDuplicateText(detail: any): string {
  const texts = new Set<string>((detail?.duplicateCandidates ?? [])
    .filter((candidate: any) => candidate.status === 'OPEN')
    .map((candidate: any) => DUPLICATE_MATCH_TEXT[candidate.candidateType] ?? 'อาจซ้ำกับคำขอเบิกอื่น'));
  return [...texts].join(' และ ') || 'อาจซ้ำกับคำขอเบิกอื่น';
}

/** The policy switch, quoted as the settings page labels it so it can be found there. */
const SELF_APPROVAL_SWITCH = '"ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้"';

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
    // Transient: approved, waiting for the projection to route it on (currentDesk FINANCE or PAYMENT).
    case 'APPROVED': return detail.financeReviewStatus === 'PENDING' ? 'finance' : 'payment';
    case 'READY_FOR_PAYMENT': case 'PARTIALLY_PAID': return 'payment';
    case 'PAID': return 'document';
  }
  // Reopen and a finance correction clear submittedAt/approvedAt, so they mark the round's progress.
  if (!detail?.submittedAt) return 'items';
  if (!detail.approvedAt) return 'approval';
  return withFinance && detail.financeReviewStatus !== 'APPROVED_FOR_PAYMENT' ? 'finance' : 'payment';
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
  // A step approved in an earlier round (before a finance correction) is history, not this round's approval.
  const approval = (detail?.approvalSteps ?? []).filter((step: any) => step.status === 'APPROVED' && !step.invalidatedAt
    && String(step.decidedAt ?? '') >= String(detail?.submittedAt ?? '')).at(-1);
  const humanApproved = !!approval;
  const signed = new Set((detail?.signatures ?? []).map((row: any) => row.role));
  const payment = (detail?.payments ?? []).filter((row: any) => row.status === 'RECORDED').at(-1);
  const duplicate = ['POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE'].includes(detail?.duplicateStatus)
    ? DUPLICATE_STATUS_LABELS[detail.duplicateStatus] : undefined;

  const activeStep = (key: JourneyStepKey): Pick<JourneyStep, 'note' | 'actions'> => {
    const actions: JourneyAction[] = [];
    let note: string | undefined;
    if (ended) {
      note = status === 'CANCELLED' ? `ยกเลิกคำขอแล้ว${detail?.rejectionReason ? `: ${detail.rejectionReason}` : ''}` : 'เพิกถอนรายการแล้ว';
    } else if (key === 'items') {
      if (review === 'NEEDS_INFO') {
        note = detail?.financeReviewNote ? `ฝ่ายการเงินขอให้แก้ไข: ${detail.financeReviewNote}` : 'ฝ่ายการเงินขอให้แก้ไข';
        if (own.canEditDraft) actions.push('edit');
        if (own.canSubmit) actions.push('submit');
      } else {
        note = own.canSubmit || own.canEditDraft ? 'ตรวจรายการและหลักฐานให้ครบ แล้วกดส่งอนุมัติ' : 'รอผู้ยื่นส่งคำขอ';
        if (own.canSubmit) actions.push('submit');
        if (own.canEditDraft) actions.push('edit');
      }
    } else if (key === 'approval' && status === 'REJECTED') {
      note = `ปฏิเสธ${detail?.rejectionReason ? `: ${detail.rejectionReason}` : ''}`;
      if (own.canReopen) actions.push('reopen');
    } else if (key === 'approval') {
      if (detail?.approvalActions?.canApprove === true) actions.push('approve');
      if (detail?.approvalActions?.canReject === true) actions.push('reject');
      const waiting = `รอ ${currentDeskText(detail?.currentDesk) ?? CURRENT_DESK_LABELS.APPROVER} อนุมัติ`;
      note = actions.length > 0 ? 'รอคุณตัดสิน ตรวจรายการและใบเสร็จด้านล่างก่อนอนุมัติ' : waiting;
      // spec §15: the requester would decide this claim but for the self-approval switch. The claim
      // froze the switch at submit, so turning it on helps only once the claim is sent again.
      if (detail?.approvalActions?.selfApprovalBlocked === true) {
        const canManagePolicy = permissions.includes('reimbursement.policy.manage');
        note = `${waiting} · ใบนี้เป็นของคุณเอง และบริษัทยังไม่เปิด ${SELF_APPROVAL_SWITCH} คุณจึงอนุมัติเองไม่ได้ ถ้าต้องการอนุมัติเอง ${
          canManagePolicy ? 'เปิดได้ที่ตั้งค่าเบิกจ่าย' : 'ขอให้เจ้าของกิจการเปิดในตั้งค่าเบิกจ่าย'} แล้วเปิดคำขอกลับเป็นร่างและส่งอนุมัติใหม่`;
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
        ? `ฝ่ายการเงินระงับการจ่าย${detail?.financeReviewNote ? `: ${detail.financeReviewNote}` : ''}`
        : actions.length > 0 ? 'ตรวจใบเสร็จและรายการซ้ำ แล้วอนุมัติจ่ายหรือส่งกลับให้แก้ไข' : WAITING_FOR_FINANCE;
    } else if (key === 'payment') {
      // APPROVED here is the no-finance claim waiting for its projection; the API accepts payment then.
      const payable = ['READY_FOR_PAYMENT', 'APPROVED'].includes(status);
      if (payable && detail?.duplicateBlocksPayment === true) {
        // The API refuses payment until the block is cleared with a reason.
        // Owner 2026-09-21: a claim has only a requester and an approver, so whoever records the
        // payment clears the duplicate block with a reason; duplicate.resolve holders still can too.
        const canResolve = permissions.includes('reimbursement.payment.record') || permissions.includes('reimbursement.duplicate.resolve');
        if (canResolve) actions.push('resolve-duplicate');
        note = `ติดรายการซ้ำ: ${openDuplicateText(detail)} ${canResolve
          ? 'ตรวจแล้วถ้าไม่ซ้ำ กดปลดรายการซ้ำพร้อมเหตุผล จึงจะบันทึกจ่ายได้'
          : `รอ${PAYER}ตรวจรายการซ้ำและปลดก่อน จึงจะบันทึกจ่ายได้`}`;
      } else {
        const canPay = permissions.includes('reimbursement.payment.record');
        if (payable && canPay) actions.push('pay');
        // Spec §18.3 and §13.4: whoever cannot pay reads who can, and the approver of this claim is told so plainly.
        const payers = paymentDeskText(detail?.paymentDesk);
        const waiting = detail?.paymentDesk && !payers
          ? 'ยังไม่มีผู้ที่บันทึกจ่ายใบของสาขานี้ได้ ขอให้เจ้าของกิจการบันทึกจ่ายหรือเพิ่มสิทธิ์'
          : !canPay && approval?.decisionByUserId === userId
            ? `คุณอนุมัติใบนี้แล้ว แต่บัญชีของคุณยังไม่มีสิทธิ์บันทึกจ่าย ${payers ? `ผู้ที่บันทึกจ่ายได้: ${payers} ` : ''}ถ้าต้องการจ่ายเอง ขอให้เจ้าของกิจการเพิ่มสิทธิ์บันทึกจ่ายให้บทบาทของคุณ`
            : waitingForPayer(detail);
        note = [actions.length > 0 ? 'บันทึกจ่ายเต็มจำนวน ระบุวิธีจ่าย วันที่ และเลขอ้างอิง' : waiting, duplicate].filter(Boolean).join(' · ');
      }
    } else if (key === 'document' && detail?.documentSignedVia) {
      // Done in the system or on paper (A4); the latest declared scan names who attached it and when.
      note = detail.documentSignedVia === 'DIGITAL' ? 'ลงนามในระบบครบแล้ว'
        : paperSignedLine((detail.signedCopies ?? []).find((copy: any) => copy.acknowledgedAt));
    } else if (key === 'document') {
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
        .map((role) => `${blockLabel(role)}${signers[role] ? ` (${signers[role]})` : ''}`);
      note = [
        unsigned.length > 0 ? `จ่ายเงินคืนแล้ว ยังไม่ลงนาม: ${unsigned.join(' และ')}` : 'จ่ายเงินคืนแล้ว พิมพ์ใบเบิกเก็บไว้ได้',
        actions.includes('sign') && 'คุณยังไม่ได้ลงนาม กดลงนามในใบเบิก',
      ].filter(Boolean).join(' · ');
    }
    if (!ended && own.canCancel) actions.push('cancel');
    // No requestNo, no document: drafts and claims cancelled out of DRAFT never got one.
    if (detail?.requestNo && status !== 'DRAFT') actions.push('print');
    if (!ended && key === 'document') {
      if (canUploadSignedCopy(detail, userId, permissions)) actions.push('attach-signed-copy');
      if (canVoidRecordedPayment(payment, permissions)) actions.push('void-payment');
    }
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
    if (index > atIndex) return { ...base, state: 'upcoming', actions: [] };
    const signedDocument = key === 'document' && !!detail?.documentSignedVia;
    return { ...base, state: ended ? 'ended' : status === 'REJECTED' ? 'needs-fix' : signedDocument ? 'done' : 'current', ...activeStep(key) };
  });
}

/**
 * The step the journey card is about: where the claim stands, was refused, or stopped — or, once a paid
 * claim's document is signed and every step is done, that last step (reprint, attach again, void).
 */
export function activeJourneyStep(steps: readonly JourneyStep[]): JourneyStep | undefined {
  return steps.find((step) => step.state !== 'done' && step.state !== 'upcoming') ?? steps.at(-1);
}

/** "ลงนามบนกระดาษ · แนบเมื่อ … โดย …" for a scan attached with the A4 declaration; parts the detail lacks are left out. */
export function paperSignedLine(copy?: { acknowledgedAt?: string; acknowledgedByName?: string }): string {
  return `ลงนามบนกระดาษ${copy?.acknowledgedAt ? ` · แนบเมื่อ ${formatThaiDate(copy.acknowledgedAt)}` : ''}${copy?.acknowledgedByName ? ` โดย ${copy.acknowledgedByName}` : ''}`;
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
    { title: `ยอดตั้งแต่ ${amount} บาท`, path: `${input.ownerRoute ? approver : `${approver} (ถ้าไม่มี เจ้าของกิจการ)`} → ${payout}` },
    { title: `ยอดต่ำกว่า ${amount} บาท`, path: `ไม่ต้องรอผู้อนุมัติ → ${payout}` },
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

export function formatMoney(v: unknown, currency?: string): string {
  const amount = Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${amount} ${currency === 'THB' ? 'บาท' : currency}` : amount;
}

/* Owner rule 2026-09-27/29: plain Thai, no id, enum key, code or ISO date on screen, and the same words as
 * the LINE card (apps/api/.../line-reimbursement-draft-card.logic.ts). */
const satang = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "บาท" for the one currency a claim takes, never the code. */
const currencyWord = (currency: unknown) => (!currency || currency === 'THB' ? 'บาท' : String(currency));
/** "1,234.50 บาท", like formatMoney, but the decimal string is formatted as is (no float) and rounds half up like the API. */
export function money(value: unknown, currency?: unknown) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(value)) return 'ยังตรวจสอบจำนวนเงินไม่ได้';
  return `${satang.format(value as `${number}`)} ${currencyWord(currency)}`;
}
/** A category by its Thai label; a missing label never falls back to the key. */
export const categoryText = (label: unknown) => (typeof label === 'string' && label.trim()) || 'ยังไม่ได้เลือกหมวด';
