import {
  BUSINESS_DOCUMENT_KINDS,
  EXPENSE_CAPTURE_BLOCKERS,
  type BusinessDocumentKind,
  type CaptureAllocationOutcome,
  type ExpenseCaptureAction,
  type ExpenseCaptureAllocationStatus,
  type ExpenseCaptureBlocker,
  type ExpenseCaptureObservations,
} from '@watchdog-bms/contracts';

/**
 * Where a group-shaped job sends a person (§10 "กรอกข้อมูลต่อ").
 *
 * Appendix §25 (owner decision 2026-09-19) withdrew the group page, so there is nothing group-shaped
 * left to open: the records a group produced live in the expense list, and that is the honest target
 * for the dormant dto field and for any row captured before the decision. The `groupId` is kept in
 * the signature because every caller has it and a path that silently ignores its argument is easier
 * to review than a dozen call sites changed to drop it.
 */
export const expenseCaptureWebPath = (companyId: string, _groupId?: string): string =>
  `/companies/${companyId}/expenses`;

/**
 * The issuer scope a derived source belongs to, and half of the handoff fence
 * `(companyId, captureGroupId, captureScopeKey)`.
 *
 * Tax id first because it is the only issuer identity that cannot collide; then the normalised
 * name (NFC, collapsed whitespace, Thai-lowercased — NFKC would fold Thai vowel forms that are
 * genuinely different characters); the expense id last, so an issuer we cannot name still gets a
 * stable scope of its own instead of sharing "unknown" with every other nameless receipt.
 */
export function deriveCaptureScopeKey(expense: {
  id: string; vendorTaxIdSnapshot?: string | null; vendorNameSnapshot?: string | null;
}): string {
  const taxId = expense.vendorTaxIdSnapshot?.replace(/\D/g, '');
  if (taxId) return `issuer:${taxId}`;
  const name = expense.vendorNameSnapshot?.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('th-TH');
  return `issuer:${name || expense.id}`;
}

const asBusinessDocumentKind = (value: string | null | undefined): BusinessDocumentKind =>
  (BUSINESS_DOCUMENT_KINDS as readonly string[]).includes(value ?? '')
    ? (value as BusinessDocumentKind)
    : 'NEEDS_REVIEW';

export type ExpenseFactsInput = {
  id: string;
  status: string;
  currency: string;
  expenseDate: Date | string | null;
  paymentStatus?: string | null;
  paidAt?: Date | string | null;
  paymentMethod?: string | null;
  vendorNameSnapshot?: string | null;
  vendorTaxIdSnapshot?: string | null;
  vendorBranchCodeSnapshot?: string | null;
  vendorDocumentNumber?: string | null;
  sourceDocumentType?: string | null;
  grandTotalAmount: unknown;
  vatAmount?: unknown;
  lines: Array<{
    lineNumber: number; description: string; quantity: unknown; unitPrice: unknown;
    lineTotalAmount: unknown; chargeKind?: string | null;
  }>;
};

const money = (value: unknown): string => String(value ?? '0');
const iso = (value: Date | string | null | undefined): string | undefined =>
  value ? new Date(value).toISOString() : undefined;

/**
 * §3.1: the facts an expense ALREADY holds, expressed in the observation shape so the group page,
 * the allocation and the AI results all read one structure. Nothing is inferred here — every
 * value is copied from a row a person already saw, and `evidenceSpan` cites that row rather than
 * page text, because for this source there is no page (the AI substring rule of §4.3 governs
 * `source: AI` only).
 */
export function buildExpenseFactsObservation(expense: ExpenseFactsInput): ExpenseCaptureObservations {
  const ref = `expense:${expense.id}`;
  const charge = (kind?: string | null) => kind !== null && kind !== undefined && kind !== '';
  return {
    documents: [{
      ref,
      pageIndexes: [],
      kind: asBusinessDocumentKind(expense.sourceDocumentType),
      family: 'EXPENSE_EVIDENCE',
      issuer: {
        ...(expense.vendorNameSnapshot ? { name: expense.vendorNameSnapshot } : {}),
        ...(expense.vendorTaxIdSnapshot ? { taxId: expense.vendorTaxIdSnapshot } : {}),
        ...(expense.vendorBranchCodeSnapshot ? { branchCode: expense.vendorBranchCodeSnapshot } : {}),
      },
      ...(expense.vendorDocumentNumber ? { documentNumber: expense.vendorDocumentNumber } : {}),
      ...(iso(expense.expenseDate) ? { documentDate: iso(expense.expenseDate) } : {}),
      currency: expense.currency,
      classification: {
        contentKind: 'DOCUMENT',
        documentFamily: 'EXPENSE_EVIDENCE',
        documentKind: asBusinessDocumentKind(expense.sourceDocumentType),
        businessDirection: 'PURCHASE_EXPENSE',
        transactionState: expense.paymentStatus === 'PAID' ? 'PAID' : 'UNKNOWN',
        evidenceRoles: ['EXPENSE_SUPPORT'],
        // Not a model score: these facts are a stored row, reviewed by a person.
        confidence: 1,
        evidenceSignals: [],
        amountSignals: [],
        settlementSignals: [],
        missingRequiredSignals: [],
        contradictionSignals: [],
        requiresClarification: false,
      },
    }],
    // A charge row (delivery, service charge) is a component, never an item: counting it in both
    // places would make the merchandise base — the discount/shipping split base of §7 — too big.
    items: expense.lines.filter((line) => !charge(line.chargeKind)).map((line) => ({
      id: `0:${line.lineNumber}`,
      documentRef: ref,
      description: line.description,
      quantity: money(line.quantity),
      unitPrice: money(line.unitPrice),
      amount: money(line.lineTotalAmount),
      event: 'sale' as const,
      evidenceSpan: line.description,
    })),
    components: expense.lines
      .filter((line) => charge(line.chargeKind))
      .map((line) => ({
        id: `charge:${line.lineNumber}`,
        documentRef: ref,
        label: line.description,
        amount: money(line.lineTotalAmount),
        currency: expense.currency,
        role: 'charge' as const,
        scope: 'order' as const,
        appliedStatus: 'applied' as const,
        evidenceSpan: line.description,
      })),
    totals: [
      { documentRef: ref, kind: 'document_total' as const, amount: money(expense.grandTotalAmount), evidenceSpan: money(expense.grandTotalAmount) },
    ],
    payments: expense.paymentStatus === 'PAID'
      ? [{
        documentRef: ref,
        ...(expense.paymentMethod ? { method: expense.paymentMethod } : {}),
        status: 'paid' as const,
        amount: money(expense.grandTotalAmount),
        ...(iso(expense.paidAt) ? { occurredAt: iso(expense.paidAt) } : {}),
        evidenceSpan: money(expense.grandTotalAmount),
      }]
      : [],
    refunds: [],
    completeness: {
      itemsTruncated: false,
      unreadableRows: 0,
      pagesCovered: [],
      notes: ['facts copied from the expense record at conversion (appendix §3.1)'],
    },
  };
}

export type CaptureGroupStateForActions = {
  status: 'OPEN' | 'HANDED_OFF' | 'CLOSED_NO_HANDOFF' | 'CANCELLED';
  handoffState: 'NONE' | 'ACTIVE' | 'RELEASED';
  storedFiles: number;
  /** Files whose read has not reached a terminal state yet. */
  readingFiles: number;
  hasFacts: boolean;
  intakeEnabled: boolean;
  canMutate: boolean;
  /** W04a: the group's current allocation, when a review has produced one. */
  allocation?: {
    status: ExpenseCaptureAllocationStatus;
    outcome: CaptureAllocationOutcome;
    blockers: readonly ExpenseCaptureBlocker[];
  } | null;
  /**
   * W05 §9: this group already handed off, and every derived source it produced is STILL unused —
   * so it may be divided again and the next handoff rewrites them in place. False the moment one
   * is paid, posted, claimed or certified.
   */
  reopenable?: boolean;
};

/**
 * W05: a handed-off group is not a dead end and not an open one. Either its batch is untouched —
 * and the whole review → accept → handoff loop reopens, rewriting the same expenses (§9 regenerate,
 * §3.2 "มีของส่วนตัวด้วย") — or something downstream has used it and the correction belongs to that
 * expense, not to a second division of the same purchase (A11/A44).
 */
function handedOffActions(state: CaptureGroupStateForActions): ExpenseCaptureAction[] {
  if (!state.canMutate || !state.reopenable) return [];
  const actions: ExpenseCaptureAction[] = ['review'];
  const allocation = state.allocation;
  if (allocation?.status === 'PREVIEW' && allocation.outcome !== 'BLOCKED') actions.push('accept_allocation');
  if (allocation?.status === 'ACCEPTED' && allocation.outcome === 'READY') actions.push('handoff');
  return actions;
}

/**
 * What the group is waiting for, and what the caller may do — decided HERE, on the server, and
 * returned in the read model. A client that hides a button is not a guard, and a client that
 * shows one it cannot use is a dead end; both read this.
 */
export function captureGroupBlockers(state: CaptureGroupStateForActions): ExpenseCaptureBlocker[] {
  const blockers: ExpenseCaptureBlocker[] = [];
  // W05: handed off and already used somewhere. Say where the work continues instead of offering
  // a division of a purchase that has already been claimed, paid or certified.
  if (state.status === 'HANDED_OFF' && !state.reopenable) {
    return [{
      code: 'expense_capture_handoff_consumed',
      messageTh: 'รายการค่าใช้จ่ายที่สร้างจากงานนี้ถูกนำไปใช้แล้ว กรุณาแก้ไขที่รายการค่าใช้จ่ายนั้นแทน',
    }];
  }
  if (state.status !== 'OPEN') return blockers;
  if (state.storedFiles === 0) {
    blockers.push({
      code: 'expense_capture_no_evidence',
      messageTh: 'ยังไม่มีไฟล์หลักฐานในงานนี้ กรุณาแนบไฟล์',
      action: 'add_file',
    });
  }
  if (state.readingFiles > 0) {
    blockers.push({
      code: 'expense_capture_read_pending',
      messageTh: 'เก็บไฟล์แล้ว กำลังอ่านเอกสาร',
    });
  }
  if (state.storedFiles > 0 && state.readingFiles === 0 && !state.hasFacts) {
    blockers.push({
      code: 'expense_capture_facts_unavailable',
      messageTh: 'ยังไม่มีข้อมูลจากไฟล์นี้ กรอกข้อมูลต่อได้เลย',
    });
  }
  // W04a: the allocation decides the rest. Facts with no review at all is its own answer —
  // nobody has said what is the company's and who paid, so there is nothing to accept yet.
  if (state.hasFacts && !state.allocation) {
    blockers.push({
      code: EXPENSE_CAPTURE_BLOCKERS.REVIEW_REQUIRED,
      messageTh: 'ตรวจส่วนของบริษัทและผู้จ่ายก่อน จึงจะสร้างรายการค่าใช้จ่ายได้',
      action: 'review',
    });
  }
  for (const allocationBlocker of state.allocation?.blockers ?? []) {
    if (!blockers.some((existing) => existing.code === allocationBlocker.code)) blockers.push(allocationBlocker);
  }
  return blockers;
}

export function captureGroupAllowedActions(state: CaptureGroupStateForActions): ExpenseCaptureAction[] {
  if (state.status === 'HANDED_OFF') return handedOffActions(state);
  if (state.status !== 'OPEN') return [];
  const actions: ExpenseCaptureAction[] = [];
  // The intake flag closes NEW evidence only (A47): everything already in the group stays
  // reviewable, detachable and closable while it is off.
  if (state.intakeEnabled && state.canMutate) actions.push('add_file');
  if (state.canMutate && state.storedFiles > 0) actions.push('detach_file');
  // `review` also gates `POST …/facts`: both are the "change this group's data" authority of §6,
  // and `edit_facts` is not one of the six actions the W01 contract declares.
  if (state.canMutate && state.hasFacts) actions.push('review');
  const allocation = state.allocation;
  if (state.canMutate && allocation?.status === 'PREVIEW' && allocation.outcome !== 'BLOCKED') {
    actions.push('accept_allocation');
  }
  // Only an accepted allocation with company money to hand over can become derived sources (W05).
  if (state.canMutate && allocation?.status === 'ACCEPTED' && allocation.outcome === 'READY' && state.handoffState !== 'ACTIVE') {
    actions.push('handoff');
  }
  if (state.canMutate && state.handoffState !== 'ACTIVE') actions.push('close');
  return actions;
}
