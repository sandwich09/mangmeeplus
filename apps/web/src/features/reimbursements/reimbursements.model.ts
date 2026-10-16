import type { MangmeeTone } from '@/common/components/mangmee';
import { REIMBURSEMENT_SELF_APPROVAL_DENIED, REIMBURSEMENT_DUPLICATE_UNRESOLVED, REIMBURSEMENT_POLICY_TAB_LABEL, REIMBURSEMENT_SELF_APPROVAL_SWITCH_LABEL, THAI_SYSTEM_ROLE_NAMES, REIMBURSEMENT_DESK_LABELS, REIMBURSEMENT_SYSTEM_WAIT_LABEL, reimbursementIncurredDateError, todayCivilDate } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
// The words for a payment method are shared with the server's notice (their own import, apart from the line above).
import { REIMBURSEMENT_PAYMENT_METHOD_LABELS, REIMBURSEMENT_PAYMENT_REFERENCE_TEXT } from '@watchdog-bms/contracts';
// A claim sent back from the pay step (payout spec §14): what it is said to wait for, in the words every other reader of it uses.
import { reimbursementPayoutRoundStatus, reimbursementDuplicateWait } from '@watchdog-bms/contracts';

// Who can put it right is named, and what still works is said: never only "contact someone".
export const REIMBURSEMENT_CREATE_UNAVAILABLE = `บัญชีนี้สร้างใบเบิกไม่ได้ ขอให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}เปิดสิทธิ์ให้ ยังดูใบเบิกเดิมได้`;
/** The hub of an account with no right in this area at all. */
export const REIMBURSEMENT_NO_ACCESS = `ขอให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}เปิดสิทธิ์การเบิกจ่ายให้บัญชีนี้`;

/**
 * The hub's policy tab and its self-approval switch, by the names the screens print. Every message that sends a
 * person there quotes these, so a message cannot name a tab or a switch the page does not show.
 */
export const POLICY_TAB_LABEL = REIMBURSEMENT_POLICY_TAB_LABEL;
export const SELF_APPROVAL_SWITCH_LABEL = REIMBURSEMENT_SELF_APPROVAL_SWITCH_LABEL;

// The switch's own line says whom it helps (only people in the approver roles chosen). The cases that need no
// switch are the guide's to explain (SELF_APPROVAL_OFF_NOTE): the owner, since the owner's decision ก2 of
// 2026-10-13, and a requester who is the only person able to approve that claim. That a claim already sent keeps
// the setting it was sent with is said when the settings are saved.
export const SELF_APPROVAL_POLICY_NOTE = 'เมื่อเปิด คนในบทบาทผู้อนุมัติที่เลือกไว้อนุมัติใบเบิกของตัวเองได้';
export const SELF_APPROVAL_OFF_NOTE = `เมื่อปิด อนุมัติเองได้เฉพาะ${THAI_SYSTEM_ROLE_NAMES.OWNER} หรือเมื่อผู้เบิกเป็นคนเดียวที่อนุมัติใบนั้นได้`;
export const CLAIM_SIGN_LABEL = 'เซ็นใบเบิก';
export const CLAIM_RESIGN_LABEL = 'เซ็นใหม่';

export { REIMBURSEMENT_STATUS_LABELS as REQUEST_STATUS_LABELS } from '@watchdog-bms/contracts';
import { REIMBURSEMENT_STATUS_LABELS as REQUEST_STATUS_LABELS } from '@watchdog-bms/contracts';

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NOT_PAYABLE: 'ยังจ่ายไม่ได้',
  UNPAID: 'ยังไม่จ่าย',
  PARTIALLY_PAID: 'จ่ายบางส่วน',
  PAID: 'จ่ายแล้ว',
  VOIDED: 'เพิกถอน',
};

export const FINANCE_REVIEW_LABELS: Record<string, string> = {
  NOT_REQUIRED: 'ไม่ต้องตรวจ',
  PENDING: 'รอตรวจสอบ',
  NEEDS_INFO: 'ขอข้อมูลเพิ่ม',
  APPROVED_FOR_PAYMENT: 'อนุมัติจ่าย',
  BLOCKED: 'ระงับ',
};

/** The shared words (contracts): the requester's notice is built from the same ones on the server. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = REIMBURSEMENT_PAYMENT_METHOD_LABELS;
/** A payment that was taken back, in the words of the button that does it. The payment row and the timeline both say this. */
export const PAYMENT_VOIDED_LABEL = 'ยกเลิกการจ่ายแล้ว';

export const REQUEST_STATUS_TONES: Record<string, MangmeeTone> = {
  DRAFT: 'slate',
  PENDING_APPROVAL: 'amber',
  APPROVED: 'sky',
  REJECTED: 'danger',
  CANCELLED: 'slate',
  FINANCE_REVIEW: 'purple',
  READY_FOR_PAYMENT: 'teal',
  PARTIALLY_PAID: 'amber',
  PAID: 'brand',
  VOIDED: 'danger',
} satisfies Record<string, MangmeeTone>;

/**
 * The words and colour of a claim's status badge, on a list or queue row and on the claim page alike.
 *
 * A claim the system holds has not left its status yet: its approval is decided and not carried out, or it
 * is being cancelled. The badge used to print that status ("รออนุมัติ" on a claim already approved,
 * "พร้อมจ่าย" on one being cancelled) beside an "อยู่ที่ ระบบ" line and a step note that said otherwise. It
 * reads "รอระบบปรับสถานะ" for such a claim: the words of that line, that note and the LINE backlog.
 */
export function claimStatusBadge(claim: {
  status?: string; duplicateReasons?: readonly string[]; hasDuplicateBlocker?: boolean; duplicateBlocksPayment?: boolean; currentDesk?: { kind?: string } | null;
  payoutCorrectionPhase?: string | null; payoutMethod?: string | null; payoutCorrectionAnswer?: string | null; documentSignedVia?: string | null;
} | null | undefined): { label: string; tone: MangmeeTone } {
  const cancellation = reimbursementDuplicateWait(claim);
  if (cancellation?.status) return { label: cancellation.status, tone: 'amber' };
  if (claim?.currentDesk?.kind === 'SYSTEM') return { label: REIMBURSEMENT_SYSTEM_WAIT_LABEL, tone: 'amber' };
  // Payout spec §14.2: a claim sent back from its pay step is PENDING_APPROVAL by its status. "รออนุมัติ" would name an
  // approver nobody waits for while the claim is with its requester, and say nothing of what is approved after. What it
  // waits for is said by what the claim holds, then by what was answered: the one sentence of contracts, which a list
  // row, the claim page, the printed form and the LINE assistant all print. Nothing for a claim in no round.
  const round = claim && reimbursementPayoutRoundStatus(claim);
  if (round) return { label: round, tone: 'amber' };
  const status = String(claim?.status ?? '');
  return { label: REQUEST_STATUS_LABELS[status] ?? '—', tone: REQUEST_STATUS_TONES[status] ?? 'slate' };
}

export const PAYMENT_STATUS_TONES: Record<string, MangmeeTone> = {
  NOT_PAYABLE: 'slate',
  UNPAID: 'danger',
  PARTIALLY_PAID: 'amber',
  PAID: 'brand',
  VOIDED: 'danger',
} satisfies Record<string, MangmeeTone>;

export const RECEIPT_REQUIREMENT_LABELS: Record<string, string> = {
  REQUIRED: 'ต้องแนบใบเสร็จ',
  ATTACHED: 'แนบใบเสร็จแล้ว',
  MISSING_WITH_REASON: 'ไม่มีใบเสร็จ (ระบุเหตุผลแล้ว)',
  WAIVED_BY_POLICY: 'ยกเว้นตามนโยบาย',
};

export const DUPLICATE_STATUS_LABELS: Record<string, string> = {
  NOT_CHECKED: 'ยังไม่ตรวจรายการซ้ำ',
  NO_MATCH: 'ไม่พบรายการซ้ำ',
  POSSIBLE_DUPLICATE: 'อาจเป็นรายการซ้ำ ต้องตรวจสอบ',
  CONFIRMED_DUPLICATE: 'ยืนยันว่าเป็นรายการซ้ำ',
  OVERRIDDEN: 'ตรวจแล้วไม่ซ้ำ',
};

export const APPROVAL_STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอตัดสิน',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ส่งกลับให้แก้แล้ว',
  CANCELLED: 'ยกเลิก',
  SKIPPED: 'ข้ามขั้น',
  EXPIRED: 'หมดเวลา',
};

export const REQUEST_STATUS_OPTIONS = Object.keys(REQUEST_STATUS_LABELS);

/** Name the person who sent it back when the read includes that decision; never substitute an id. */
export function claimReturnedText(claim: {
  rejectionReason?: string;
  approvalSteps?: readonly { status?: string; decidedByName?: string; approverName?: string; rejectionReason?: string }[];
}): string {
  const decision = [...(claim.approvalSteps ?? [])].reverse().find(step => step.status === 'REJECTED');
  const name = decision?.decidedByName ?? decision?.approverName ?? 'ผู้อนุมัติ';
  const reason = claim.rejectionReason ?? decision?.rejectionReason;
  return reason ? `${name} ส่งกลับให้แก้: ${reason}` : `${name} ส่งกลับให้แก้แล้ว`;
}

// ---- อยู่ที่ใคร (current desk) ----

/**
 * Pool labels, the same words the LINE backlog answer uses. A desk prefers the real names the server resolved.
 * The requester is "ผู้เบิก" on every claim screen: one word for one person. The contract's word for that desk,
 * "ผู้ยื่น", is read by nothing but this file (the LINE backlog names no desk of a draft), so only the screens say it.
 */
export const CURRENT_DESK_LABELS: Record<string, string> = { ...REIMBURSEMENT_DESK_LABELS, REQUESTER: 'ผู้เบิก' };

/** "สมศรี หรือ วิชัย และอีก 2 คน": who can record the payment, as the claim detail names them. Null when it names nobody. */
export function paymentDeskText(paymentDesk?: { names?: readonly string[]; moreCount?: number } | null): string | null {
  if (!paymentDesk?.names?.length) return null;
  return `${paymentDesk.names.join(' หรือ ')}${paymentDesk.moreCount ? ` และอีก ${paymentDesk.moreCount} คน` : ''}`;
}

/**
 * The one line a queue row appends: `อยู่ที่ <this>`. Several assigned approvers read as
 * "A หรือ B" — any one of them can decide. The payment desk is named from the detail's `paymentDesk`
 * (a list row has none and prints the pool). Null on a terminal claim, which has no desk.
 */
export function currentDeskText(
  desk?: { kind?: string; names?: readonly string[] } | null,
  paymentDesk?: Parameters<typeof paymentDeskText>[0],
): string | null {
  if (!desk?.kind) return null;
  const names = desk.kind === 'PAYMENT' ? paymentDeskText(paymentDesk) : desk.names?.join(' หรือ ');
  return names || (CURRENT_DESK_LABELS[desk.kind] ?? null);
}

/**
 * `อยู่ที่ <this>` of a claim, as its list row or as its detail. A draft, and a claim sent back for its payout
 * account (payout spec §14.2), are with their requester: "ผู้เบิก", as on the badge, the step note and the timeline.
 */
export function claimDeskText(claim: {
  status?: string; duplicateReasons?: readonly string[]; hasDuplicateBlocker?: boolean; duplicateBlocksPayment?: boolean; currentDesk?: Parameters<typeof currentDeskText>[0]; paymentDesk?: Parameters<typeof paymentDeskText>[0];
} | null | undefined): string | null {
  return reimbursementDuplicateWait(claim)?.actor ?? currentDeskText(claim?.currentDesk, claim?.paymentDesk);
}

// ---- Claim-form signatures ----

export type ClaimSignatureRole = 'REQUESTER' | 'APPROVER' | 'FINANCE_REVIEW' | 'PAYER';

/** Printed order and Thai labels of the four signature blocks on ใบเบิกค่าใช้จ่าย. */
export const CLAIM_SIGNATURE_ROLES: ClaimSignatureRole[] = ['REQUESTER', 'APPROVER', 'FINANCE_REVIEW', 'PAYER'];
export const CLAIM_SIGNATURE_ROLE_LABELS: Record<ClaimSignatureRole, string> = {
  REQUESTER: 'ผู้เบิก',
  APPROVER: 'ผู้อนุมัติ',
  FINANCE_REVIEW: 'ฝ่ายบัญชี',
  PAYER: 'ฝ่ายการเงิน',
};

/** D3: ผู้เบิก and ผู้อนุมัติ on every claim; a claim already signed in the old accounting/payer blocks keeps four. */
export function claimSignatureSlots(detail: any): ClaimSignatureRole[] {
  return detail?.claimFormLayout === 'LEGACY_FOUR_SIGNERS' ? CLAIM_SIGNATURE_ROLES : ['REQUESTER', 'APPROVER'];
}

/**
 * The approval the form prints: the latest APPROVED decision still in force (a corrected claim can carry older
 * ones). An approval set aside because the claim's payout account is being corrected is nobody's: the printed
 * form then has no approver, and the API lets nobody sign for one (payout spec §14.4).
 */
function latestApprovedStep(detail: any): any {
  return [...(detail?.approvalSteps ?? [])]
    .filter((step: any) => step.status === 'APPROVED' && !!step.decidedAt && !step.invalidatedAt)
    .sort((a: any, b: any) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0];
}

/** Same test as the printed note: the requester approved their own claim, so both blocks are one person. */
/**
 * A claim that passed its approval step with nobody approving it (its amount is below the company's approval
 * threshold): the form has no approver, and nobody can sign as one. A claim that still waits for its approval, or
 * whose payout account is being corrected, has or will have an approver.
 */
export function claimHasNoApprover(detail: any): boolean {
  return !!detail?.approvedAt && !claimInPayoutCorrection(detail) && !latestApprovedStep(detail);
}

export function claimSelfApproved(detail: any): boolean {
  return !!detail?.requesterUserId && latestApprovedStep(detail)?.decisionByUserId === detail.requesterUserId;
}

/**
 * Which blocks this session user may sign, mirroring the server rule: the real
 * actor of each step, never a permission. Used only to decide whether to offer
 * the button — the server re-checks and is the authority.
 */
export function eligibleSignatureRoles(detail: any, userId: string): ClaimSignatureRole[] {
  const roles: ClaimSignatureRole[] = [];
  if (!detail?.requestNo || !userId || ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'].includes(detail.status)) return roles;
  // Nobody signs while the claim's payout account is being corrected: the form prints no account and no approver
  // meanwhile, and the API refuses every block. The claim says so itself, with the phase the server reports.
  if (claimInPayoutCorrection(detail)) return roles;
  if (detail.requesterUserId === userId) roles.push('REQUESTER');
  if (latestApprovedStep(detail)?.decisionByUserId === userId) roles.push('APPROVER');
  // The two-signer form has no accounting or payer block; the API refuses those roles on it.
  if (detail.claimFormLayout !== 'LEGACY_FOUR_SIGNERS') return roles;

  if (detail.financeReviewStatus === 'APPROVED_FOR_PAYMENT' && detail.financeReviewedByUserId === userId) roles.push('FINANCE_REVIEW');

  const payment = (detail.payments ?? [])
    .filter((row: any) => row.status === 'RECORDED')
    .sort((a: any, b: any) => String(a.paidAt).localeCompare(String(b.paidAt)))
    .at(-1);
  if (payment?.paidByUserId === userId) roles.push('PAYER');
  return roles;
}

/**
 * The one เซ็น button (spec §9): a tap signs every block this viewer may sign with the same saved
 * signature, so a requester who approved their own claim fills both. "เซ็นใหม่" once one of them is
 * signed — including a requester who signed before approving and now also fills ผู้อนุมัติ (§15).
 */
export function claimSignAction(detail: any, userId: string): { roles: ClaimSignatureRole[]; label: string } | null {
  if (detail.status === 'PAID' && detail.documentSignedVia) return null;
  const roles = eligibleSignatureRoles(detail, userId);
  if (roles.length === 0) return null;
  const signed = new Set((detail?.signatures ?? []).filter((row: any) => row.signedByUserId === userId).map((row: any) => row.role));
  return { roles, label: roles.some((role) => signed.has(role)) ? CLAIM_RESIGN_LABEL : CLAIM_SIGN_LABEL };
}

/** Whether the server reports the claim as being in a payout account correction round, on a list row or on its detail. */
export function claimInPayoutCorrection(claim: { payoutCorrectionPhase?: string | null } | null | undefined): boolean {
  return Boolean(claim?.payoutCorrectionPhase);
}

/** The requester plus finance/payment holders may attach the signed scan. */
export function canUploadSignedCopy(detail: any, userId: string, permissions: readonly string[]): boolean {
  if (!detail?.requestNo || ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'].includes(detail.status)) return false;
  return detail.requesterUserId === userId
    || permissions.includes('reimbursement.finance_review')
    || permissions.includes('reimbursement.payment.record');
}

export function canVoidRecordedPayment(payment: any, permissions: readonly string[]): boolean {
  return payment?.status === 'RECORDED' && permissions.includes('reimbursement.payment.void');
}

/** Whether a claim, as a list row or as its detail, says a cancellation of it was started and has not completed. */
export function claimIsBeingCancelled(claim: { cancellationPending?: boolean; pendingCancellation?: unknown } | null | undefined): boolean {
  return claim?.cancellationPending === true || Boolean(claim?.pendingCancellation);
}

/** Related visibility never implies a write. Every requester action repeats actor, permission and state. */
export function reimbursementOwnActions(detail: any, userId: string, permissions: readonly string[]) {
  const isRequester = detail?.requesterUserId === userId;
  // A claim being cancelled takes no edit, submit or second cancel: the API refuses them until the
  // cancellation is finished or withdrawn. A list row says so with `cancellationPending`, the claim detail
  // also with `pendingCancellation`.
  const beingCancelled = claimIsBeingCancelled(detail);
  const canPrepare = (isRequester || permissions.includes('reimbursement.finance_review')) && !beingCancelled;
  const status = String(detail?.status ?? '');
  return {
    canEditDraft: canPrepare && status === 'DRAFT' && (permissions.includes('reimbursement.update_own_draft') || permissions.includes('reimbursement.finance_review')),
    canSubmit: canPrepare && status === 'DRAFT' && permissions.includes('reimbursement.submit'),
    canCancel: !beingCancelled && (detail?.viewerCanCancel ?? (((isRequester && permissions.includes('reimbursement.cancel_own'))
      || permissions.includes('reimbursement.finance_review'))
      && ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'].includes(status))),
    // REJECTED -> DRAFT: fix and resubmit under the same request number (server: /reopen).
    canReopen: canPrepare && status === 'REJECTED' && permissions.includes('reimbursement.update_own_draft'),
  };
}

export function reimbursementSubmitReadiness(detail: any, today = todayCivilDate()): { blocked: boolean; message?: string } {
  if (detail?.status !== 'DRAFT') return { blocked: false };
  for (const line of detail.lines ?? []) {
    const dateError = reimbursementIncurredDateError(line.incurredDate, today);
    if (dateError) return { blocked: true, message: translateApiError(`${dateError}:${line.lineNo}`) ?? undefined };
  }
  if (detail?.receiptRequirementStatus !== 'REQUIRED') {
    return { blocked: false };
  }
  // Which lines, where the claim's lines are known (a list row has none): the person is told where to attach.
  const missing = (detail?.lines ?? []).filter((line: any) => !line.attachmentId && !line.linkedExpenseId).map((line: any) => line.lineNo);
  const which = missing.length > 0 ? `รายการที่ ${missing.join(', ')} ยังไม่มีใบเสร็จ` : 'มีรายการที่ยังไม่มีใบเสร็จ';
  return {
    blocked: true,
    message: detail?.allowMissingReceiptWithReason
      ? `${which} แนบใบเสร็จที่รายการนั้น หรือแก้ไขใบเบิกเพื่อกรอกเหตุผลที่ไม่มีใบเสร็จ`
      : `${which} ร้านกำหนดให้แนบใบเสร็จทุกรายการ จึงส่งอนุมัติได้เมื่อแนบครบ`,
  };
}

/** Stable API error codes → Thai. Unknown codes are shown as-is (see `errorMessage`). */
export const ERROR_CODE_LABELS: Record<string, string> = {
  internal_note_body_invalid: 'เขียนโน้ตไม่เกิน 2,000 ตัวอักษร',
  approver_role_required: 'เลือกบทบาทที่จะรับผิดชอบอนุมัติใบเบิก',
  approver_role_not_eligible: 'บทบาทนี้ยังไม่มีสิทธิ์หรือพนักงานที่พร้อมอนุมัติ เลือกบทบาทอื่น',
  reimbursement_approver_not_ready: 'ยังไม่มีผู้อนุมัติที่รับผิดชอบใบเบิกนี้ ให้ผู้ดูแลตรวจบทบาท สิทธิ์ และสาขา แล้วส่งใหม่',
  reimbursement_policy_inactive: translateApiError('reimbursement_policy_inactive')!,
  reimbursement_policy_changed: 'การตั้งค่าถูกแก้โดยคนอื่น ระบบยังไม่บันทึกค่าของคุณ กดโหลดค่าล่าสุดแล้วตรวจอีกครั้ง',
  duplicate_company_policy: translateApiError('duplicate_company_policy')!,
  invalid_reimbursement_policy_snapshot: translateApiError('invalid_reimbursement_policy_snapshot')!,
  finance_approval_already_decided: 'ใบเบิกนี้ถูกอนุมัติจ่ายโดยผู้ตรวจการเงินคนอื่นแล้ว ให้ผู้ที่อนุมัติเป็นผู้กด "ทำต่อ"',
  void_reason_required: 'ระบุเหตุผลที่ยกเลิกการจ่าย',
  reimbursement_payment_changed: translateApiError('reimbursement_payment_changed')!,
  // Audit H-18: the old wording read like a fixed rule of the system, so a company that wanted
  // self-approval had no reason to look for the switch. Quotes the tab's and the toggle's own labels —
  // a message that paraphrases a control is a message you cannot search the settings page with.
  self_approval_denied: REIMBURSEMENT_SELF_APPROVAL_DENIED,
  reimbursement_changed: 'ใบเบิกถูกแก้ไขระหว่างทำรายการ เปิดรายการใหม่แล้วลองอีกครั้ง',
  stale_approval_snapshot: 'ใบเบิกถูกแก้ไขหลังส่งอนุมัติ เปิดดูรายละเอียดใหม่ก่อนตัดสินใจ',
  expense_already_claimed: 'ค่าใช้จ่ายนี้ถูกใช้เบิกในใบเบิกอื่นอยู่แล้ว',
  attachment_already_claimed: 'ใบเสร็จนี้ถูกใช้เบิกในใบเบิกอื่นอยู่แล้ว',
  duplicate_unresolved: REIMBURSEMENT_DUPLICATE_UNRESOLVED,
  partial_payment_not_allowed: 'ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น',
  claim_form_requires_submitted: 'ต้องส่งอนุมัติให้ได้เลขที่ก่อน จึงจะพิมพ์ใบเบิกได้',
  lines_required: 'ต้องมีอย่างน้อย 1 รายการ',
  amount_must_be_positive: 'ยอดรวมต้องมากกว่า 0',
  line_amount_must_be_positive: 'จำนวนเงินของทุกรายการต้องมากกว่า 0',
  finance_review_required: 'ต้องผ่านการตรวจสอบการเงินก่อนจ่าย',
  payment_reference_required: REIMBURSEMENT_PAYMENT_REFERENCE_TEXT.requiredMessage,
  reimbursement_payment_already_recorded: translateApiError('reimbursement_payment_already_recorded')!,
  stale_claim_snapshot: 'ใบเบิกถูกแก้ไขหลังคุณเปิดดู เปิดใบเบิกใหม่ก่อนเซ็น',
  claim_signature_role_not_eligible: 'คุณไม่ใช่ผู้มีสิทธิ์เซ็นในช่องนี้',
  claim_saved_signature_required: 'ยังไม่มีลายเซ็นของคุณ บันทึกลายเซ็นที่หน้าลายเซ็นของฉันก่อน บันทึกแล้วใช้เซ็นได้ทันที',
  claim_signature_must_be_png_or_jpeg_max_2mb: translateApiError('claim_signature_must_be_png_or_jpeg_max_2mb')!,
  claim_signature_attachment_invalid: translateApiError('claim_signature_attachment_invalid')!,
  claim_signature_bytes_mismatch: 'ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ',
  claim_signature_checksum_mismatch: translateApiError('claim_signature_checksum_mismatch')!,
  claim_signature_too_large: translateApiError('claim_signature_too_large')!,
  claim_signature_upload_not_found: 'ไม่พบไฟล์ลายเซ็นที่กำลังอัปโหลด เลือกไฟล์ใหม่',
  claim_form_signed_copy_denied: 'คุณไม่มีสิทธิ์แนบใบเบิกที่เซ็นแล้วของใบนี้',
  claim_form_signed_copy_attachment_invalid: 'ไฟล์แนบไม่ถูกต้อง อัปโหลดใหม่',
  claim_form_signed_copy_must_be_pdf_or_image: translateApiError('claim_form_signed_copy_must_be_pdf_or_image')!,
  claim_signature_unreadable: 'อ่านไฟล์ลายเซ็นในใบเบิกไม่ได้ เซ็นใหม่ในช่องนี้',
  // The print error names the failing block; the server sends the role alongside the code.
  ...CLAIM_SIGNATURE_ROLE_LABELS,
};

/** One reader-facing waiting sentence for both the hub and the claim. */
export function claimWaitingText(claim: Parameters<typeof claimDeskText>[0] & { approvalActions?: { canApprove: boolean }; documentSignedVia?: string | null }): string | undefined {
  if (claim?.status === 'PAID') return claim.documentSignedVia ? undefined : 'ยังไม่ได้เซ็นใบเบิก';
  if (claim?.approvalActions?.canApprove) return 'รอคุณอนุมัติ';
  const desk = claimDeskText(claim);
  return desk ? `อยู่ที่ ${desk}` : undefined;
}
