// Pure client-side helpers for the reimbursement forms (mirror server rules for UX only).

import { apiErrorMessage, translateApiError } from '@/common/api/api-error-message';
import { ERROR_CODE_LABELS } from './reimbursements.model';

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
  if (paid !== outstanding) return 'ต้องจ่ายเต็มจำนวน (MVP รองรับการจ่ายเต็มเท่านั้น)';
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
export function validateRequestForm(input: { reason: string; missingReceiptReason?: string; lines: readonly ClaimFormLine[] }): string | null {
  if (!input.reason || input.reason.trim() === '') return 'กรุณาระบุเหตุผล';
  if (!input.lines || input.lines.length === 0) return 'ต้องมีอย่างน้อย 1 รายการ';
  if (input.lines.length > MAX_CLAIM_LINES) return `ใบเบิกหนึ่งใบมีได้ไม่เกิน ${MAX_CLAIM_LINES} รายการ`;
  for (const [index, line] of input.lines.entries()) {
    const no = index + 1;
    if (!line.description || line.description.trim() === '') return `รายการที่ ${no}: กรุณาระบุรายการ`;
    if (!line.categoryKey || line.categoryKey.trim() === '') return `รายการที่ ${no}: กรุณาเลือกหมวด`;
    if (!line.incurredDate) return `รายการที่ ${no}: กรุณาระบุวันที่`;
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

export function formatMoney(v: unknown): string {
  return Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
