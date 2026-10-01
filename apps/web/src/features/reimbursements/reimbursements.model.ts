import type { MangmeeTone } from '@/common/components/mangmee';
import { REIMBURSEMENT_DESK_LABELS, REIMBURSEMENT_SYSTEM_WAIT_LABEL, reimbursementIncurredDateError, todayCivilDate } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
// The words for a payment method are shared with the server's notice (their own import, apart from the line above).
import { REIMBURSEMENT_PAYMENT_METHOD_LABELS } from '@watchdog-bms/contracts';
// A claim sent back for its payout account (payout spec §14): the words the LINE backlog uses for its two phases.
import { REIMBURSEMENT_PAYOUT_CORRECTION_PHASE_LABELS, type ReimbursementPayoutCorrectionPhase } from '@watchdog-bms/contracts';

export const REIMBURSEMENT_CREATE_UNAVAILABLE = 'ขณะนี้ไม่สามารถสร้างคำขอใหม่ได้ กรุณาติดต่อเจ้าของกิจการหรือแอดมินเพื่อตรวจสอบการเปิดใช้งานการเบิกจ่ายและสิทธิ์บัญชี · ยังดูประวัติเดิมได้ตามสิทธิ์';

/**
 * The hub's policy tab and its self-approval switch, by the names the screens print. Every message that sends a
 * person there quotes these, so a message cannot name a tab or a switch the page does not show.
 */
export const POLICY_TAB_LABEL = 'ตั้งค่านโยบาย';
export const SELF_APPROVAL_SWITCH_LABEL = 'ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้';

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก',
  FINANCE_REVIEW: 'รอตรวจสอบการเงิน',
  READY_FOR_PAYMENT: 'พร้อมจ่าย',
  PARTIALLY_PAID: 'จ่ายบางส่วน',
  PAID: 'จ่ายแล้ว',
  VOIDED: 'เพิกถอน',
};

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
export function claimStatusBadge(
  claim: { status?: string; currentDesk?: { kind?: string } | null; payoutCorrectionPhase?: string | null } | null | undefined,
): { label: string; tone: MangmeeTone } {
  if (claim?.currentDesk?.kind === 'SYSTEM') return { label: REIMBURSEMENT_SYSTEM_WAIT_LABEL, tone: 'amber' };
  // Payout spec §14.2: a claim sent back for its payout account is PENDING_APPROVAL by its status. "รออนุมัติ" would
  // name an approver nobody waits for while the requester gives the account, and say nothing of what is approved after.
  const correction = payoutCorrectionPhaseLabel(claim?.payoutCorrectionPhase);
  if (correction) return { label: correction, tone: 'amber' };
  const status = String(claim?.status ?? '');
  return { label: REQUEST_STATUS_LABELS[status] ?? '—', tone: REQUEST_STATUS_TONES[status] ?? 'slate' };
}

/** A claim's place in a correction round in words; nothing for a claim in none, or for a phase this build has no words for. */
export function payoutCorrectionPhaseLabel(phase: unknown): string | undefined {
  return typeof phase === 'string' && Object.hasOwn(REIMBURSEMENT_PAYOUT_CORRECTION_PHASE_LABELS, phase)
    ? REIMBURSEMENT_PAYOUT_CORRECTION_PHASE_LABELS[phase as ReimbursementPayoutCorrectionPhase] : undefined;
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
  REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก',
  SKIPPED: 'ข้ามขั้น',
  EXPIRED: 'หมดเวลา',
};

export const REQUEST_STATUS_OPTIONS = Object.keys(REQUEST_STATUS_LABELS);

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
  currentDesk?: Parameters<typeof currentDeskText>[0]; paymentDesk?: Parameters<typeof paymentDeskText>[0];
} | null | undefined): string | null {
  return currentDeskText(claim?.currentDesk, claim?.paymentDesk);
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
 * The one ลงนาม button (spec §9): a tap signs every block this viewer may sign with the same saved
 * signature, so a requester who approved their own claim fills both. "ลงนามใหม่" once one of them is
 * signed — including a requester who signed before approving and now also fills ผู้อนุมัติ (§15).
 */
export function claimSignAction(detail: any, userId: string): { roles: ClaimSignatureRole[]; label: string } | null {
  const roles = eligibleSignatureRoles(detail, userId);
  if (roles.length === 0) return null;
  const signed = new Set((detail?.signatures ?? []).map((row: any) => row.role));
  return { roles, label: roles.some((role) => signed.has(role)) ? 'ลงนามใหม่' : 'ลงนาม' };
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
    canCancel: !beingCancelled && ((isRequester && permissions.includes('reimbursement.cancel_own'))
      || permissions.includes('reimbursement.finance_review'))
      && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'].includes(status),
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
  return detail?.allowMissingReceiptWithReason
    ? {
        blocked: true,
        message: 'ยังไม่มีใบเสร็จ กรุณาแนบใบเสร็จ หรือแก้ไขคำขอเพื่อระบุเหตุผลที่ไม่มีใบเสร็จก่อนส่งอนุมัติ',
      }
    : {
        blocked: true,
        message: 'นโยบายบริษัทกำหนดให้ต้องแนบใบเสร็จ เหตุผลที่ไม่มีใบเสร็จไม่สามารถใช้แทนได้',
      };
}

/** Stable API error codes → Thai. Unknown codes are shown as-is (see `errorMessage`). */
export const ERROR_CODE_LABELS: Record<string, string> = {
  internal_note_body_invalid: 'กรุณาเขียนโน้ตไม่เกิน 2,000 ตัวอักษร',
  approver_role_required: 'กรุณาเลือกบทบาทที่จะรับผิดชอบอนุมัติใบเบิก',
  approver_role_not_eligible: 'บทบาทนี้ยังไม่มีสิทธิ์หรือพนักงานที่พร้อมอนุมัติ กรุณาเลือกบทบาทอื่น',
  reimbursement_approver_not_ready: 'ยังไม่มีผู้อนุมัติที่รับผิดชอบใบเบิกนี้ กรุณาให้ผู้ดูแลตรวจบทบาท สิทธิ์ และสาขา แล้วส่งใหม่',
  reimbursement_policy_inactive: 'บริษัทปิดรับใบเบิกใหม่ชั่วคราว กรุณาติดต่อเจ้าของกิจการหรือแอดมิน',
  reimbursement_policy_changed: 'นโยบายถูกแก้ไขโดยผู้ใช้อื่น ระบบยังไม่บันทึกค่าของคุณ กรุณาโหลดค่าล่าสุดแล้วตรวจสอบอีกครั้ง',
  duplicate_company_policy: 'พบนโยบายบริษัทซ้ำ ระบบยังไม่บันทึก กรุณาติดต่อผู้ดูแลระบบ',
  invalid_reimbursement_policy_snapshot: 'ข้อมูลนโยบายของใบเบิกนี้ไม่สมบูรณ์ ระบบจึงหยุดรายการไว้เพื่อความปลอดภัย กรุณาติดต่อผู้ดูแลระบบ',
  finance_approval_already_decided: 'คำขอนี้ถูกอนุมัติจ่ายโดยผู้ตรวจการเงินคนอื่นแล้ว ให้ผู้ที่อนุมัติเป็นผู้กด "ดำเนินการต่อ"',
  void_reason_required: 'กรุณาระบุเหตุผลที่ยกเลิกการจ่าย',
  reimbursement_payment_changed: 'ข้อมูลการจ่ายถูกเปลี่ยนแล้ว กรุณาโหลดรายการใหม่',
  // Audit H-18: the old wording read like a fixed rule of the system, so a company that wanted
  // self-approval had no reason to look for the switch. Quotes the tab's and the toggle's own labels —
  // a message that paraphrases a control is a message you cannot search the settings page with.
  self_approval_denied: `ไม่สามารถอนุมัติคำขอของตนเองได้ตามการตั้งค่าปัจจุบัน — เปิดได้ที่ ${POLICY_TAB_LABEL} › "${SELF_APPROVAL_SWITCH_LABEL}"`,
  reimbursement_changed: 'คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง',
  stale_approval_snapshot: 'คำขอถูกแก้ไขหลังส่งอนุมัติ กรุณาเปิดดูรายละเอียดใหม่ก่อนตัดสินใจ',
  expense_already_claimed: 'ค่าใช้จ่ายนี้ถูกใช้เบิกในคำขออื่นอยู่แล้ว',
  attachment_already_claimed: 'ใบเสร็จนี้ถูกใช้เบิกในคำขออื่นอยู่แล้ว',
  duplicate_unresolved: 'พบรายการที่อาจซ้ำ ต้องตรวจสอบให้เรียบร้อยก่อน',
  partial_payment_not_allowed: 'ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น',
  claim_form_requires_submitted: 'ต้องส่งคำขอให้ได้เลขที่เอกสารก่อนจึงจะพิมพ์ใบเบิกได้',
  lines_required: 'ต้องมีอย่างน้อย 1 รายการ',
  amount_must_be_positive: 'ยอดรวมต้องมากกว่า 0',
  line_amount_must_be_positive: 'จำนวนเงินของทุกรายการต้องมากกว่า 0',
  finance_review_required: 'ต้องผ่านการตรวจสอบการเงินก่อนจ่าย',
  payment_reference_required: 'ต้องระบุเลขอ้างอิงสำหรับการโอนเงิน/เช็ค',
  reimbursement_payment_already_recorded: 'คำขอนี้บันทึกการจ่ายเงินไปแล้ว',
  stale_claim_snapshot: 'คำขอถูกแก้ไขหลังเปิดดูใบเบิก กรุณาเปิดใบเบิกใหม่ก่อนลงนาม',
  claim_signature_role_not_eligible: 'คุณไม่ใช่ผู้มีสิทธิ์ลงนามในช่องนี้',
  claim_saved_signature_required: 'ยังไม่มีลายเซ็นที่พร้อมใช้งาน กรุณาบันทึกและรออนุมัติลายเซ็นก่อน',
  claim_signature_must_be_png_or_jpeg_max_2mb: 'ไฟล์ลายเซ็นต้องเป็น PNG/JPEG ขนาดไม่เกิน 2 MB',
  claim_signature_attachment_invalid: 'ไม่พบไฟล์ลายเซ็นของคุณสำหรับการลงนามครั้งนี้',
  claim_signature_bytes_mismatch: 'ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ',
  claim_signature_checksum_mismatch: 'ไฟล์ลายเซ็นถูกเปลี่ยนแปลงหลังอัปโหลด',
  claim_signature_too_large: 'ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB',
  claim_signature_upload_not_found: 'ไม่พบไฟล์ลายเซ็นที่กำลังอัปโหลด กรุณาเลือกไฟล์ใหม่',
  claim_form_signed_copy_denied: 'คุณไม่มีสิทธิ์แนบใบเบิกที่เซ็นแล้วของคำขอนี้',
  claim_form_signed_copy_attachment_invalid: 'ไฟล์แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่',
  claim_form_signed_copy_must_be_pdf_or_image: 'ใบเบิกที่เซ็นแล้วต้องเป็นไฟล์ PDF/JPG/PNG',
  claim_signature_unreadable: 'อ่านไฟล์ลายเซ็นในใบเบิกไม่ได้ กรุณาลงนามใหม่ในช่องนี้',
  // The print error names the failing block; the server sends the role alongside the code.
  ...CLAIM_SIGNATURE_ROLE_LABELS,
};
