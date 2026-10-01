// Pure client-side helpers for the reimbursement forms (mirror server rules for UX only).

import { reimbursementIncurredDateError, todayCivilDate } from '@watchdog-bms/contracts';
import { apiErrorMessage, translateApiError } from '@/common/api/api-error-message';
import { formatThaiDate } from '@/common/i18n/thai-date';
import {
  CLAIM_SIGNATURE_ROLE_LABELS, CURRENT_DESK_LABELS, DUPLICATE_STATUS_LABELS, currentDeskText, ERROR_CODE_LABELS,
  canUploadSignedCopy, canVoidRecordedPayment, claimSignatureSlots, eligibleSignatureRoles, paymentDeskText, reimbursementOwnActions,
  type ClaimSignatureRole,
} from './reimbursements.model';

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
  reason?: unknown; amount?: unknown; currency?: unknown; categoryLabel?: unknown; lineCount?: unknown;
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
    categoryLabel: categoryText(claim?.categoryLabelSnapshot), lineCount,
  };
}

export function paymentReferenceRequired(method: string): boolean {
  return method === 'BANK_TRANSFER' || method === 'CHEQUE';
}

/** Client-side validation of the full-payment form. Returns an error key or null. */
export function validatePaymentForm(input: {
  paidAmount: string;
  outstandingAmount: string;
  paymentMethod: string;
  paymentReference?: string;
}): string | null {
  const paid = Number(input.paidAmount);
  const outstanding = Number(input.outstandingAmount);
  if (!(paid > 0)) return 'จำนวนเงินต้องมากกว่า 0';
  if (paid > outstanding) return 'จำนวนเงินเกินยอดที่อนุมัติ';
  if (paid !== outstanding) return 'ต้องจ่ายเต็มจำนวนคงค้างเท่านั้น';
  if (paymentReferenceRequired(input.paymentMethod) && (!input.paymentReference || input.paymentReference.trim() === '')) {
    return 'ต้องระบุเลขอ้างอิงสำหรับการโอนเงิน/เช็ค';
  }
  return null;
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

// ---- หน้ารวม: summary cards and filter chips (spec §18.1) ----

/** Every claim sits in exactly one of these, so the chips add up to "ทั้งหมด". */
export const HUB_FILTERS = ['draft', 'review', 'payment', 'paid', 'closed'] as const;
export type HubFilter = 'all' | (typeof HUB_FILTERS)[number];

/**
 * Read off the desk the server resolved, the one the row prints as "อยู่ที่ …": waiting on an approver
 * or on finance review is รออนุมัติ/ตรวจสอบ, waiting on whoever records the payment is รอจ่าย. A claim
 * with no desk is finished: paid, or refused/cancelled.
 */
export function hubFilterOf(row: { status?: string; currentDesk?: { kind?: string } | null }): (typeof HUB_FILTERS)[number] {
  switch (row.currentDesk?.kind) {
    case 'REQUESTER': return 'draft';
    case 'APPROVER': case 'FINANCE': return 'review';
    case 'PAYMENT': return 'payment';
  }
  return row.status === 'PAID' ? 'paid' : 'closed';
}

/** The rows a card or a chip shows. */
export function hubRows<T extends Parameters<typeof hubFilterOf>[0]>(rows: readonly T[], filter: HubFilter): T[] {
  return filter === 'all' ? [...rows] : rows.filter((row) => hubFilterOf(row) === filter);
}

/** Counted with `hubRows` itself, so a number can never disagree with the list its filter shows. */
export function hubFilterCounts(rows: readonly Parameters<typeof hubFilterOf>[0][]): Record<HubFilter, number> {
  return Object.fromEntries((['all', ...HUB_FILTERS] as const).map((filter) => [filter, hubRows(rows, filter).length])) as Record<HubFilter, number>;
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
    rows.push({ key: 'finance', state: at === 'finance' ? 'current' : 'future', label: at === 'finance' ? 'กำลังรอฝ่ายการเงินตรวจ' : 'รอฝ่ายการเงินตรวจ' });
  }

  const paid = (detail?.payments ?? []).find((p: any) => p.status === 'RECORDED');
  rows.push(paid
    ? { key: 'payment', state: 'done', label: paid.paidByName ? `จ่ายแล้ว โดย ${paid.paidByName}` : 'จ่ายแล้ว', date: paid.paidAt }
    : { key: 'payment', state: at === 'payment' ? 'current' : 'future', label: at === 'payment' ? `กำลัง${waitingForPayer(detail)}` : 'รอบันทึกจ่าย' });
  return rows;
}

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
        : actions.length > 0 ? 'ตรวจใบเสร็จและรายการซ้ำ แล้วอนุมัติจ่ายหรือส่งกลับให้แก้ไข' : 'รอฝ่ายการเงินตรวจ';
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
          : 'รอผู้บันทึกจ่ายตรวจรายการซ้ำและปลดก่อน จึงจะบันทึกจ่ายได้'}`;
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
      const unsigned = claimSignatureSlots(detail)
        .filter((role) => !signed.has(role) && (role !== 'APPROVER' || humanApproved) && (role !== 'FINANCE_REVIEW' || review !== 'NOT_REQUIRED'))
        .map((role) => `${CLAIM_SIGNATURE_ROLE_LABELS[role]}${signers[role] ? ` (${signers[role]})` : ''}`);
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
 * company may want that), so this only warns. Null when there is nothing to say.
 */
export function approverPaymentWarning(
  selectedRoles: readonly { label: string; canRecordPayment?: boolean }[],
  financeReviewRequired: boolean,
): string | null {
  const labels = selectedRoles.filter((role) => role.canRecordPayment === false).map((role) => role.label);
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
