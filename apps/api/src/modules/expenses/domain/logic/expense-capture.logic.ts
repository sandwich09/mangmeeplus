import {
  BUSINESS_DOCUMENT_KINDS,
  type BusinessDocumentKind,
  type ExpenseCaptureAction,
  type ExpenseCaptureBlocker,
  type ExpenseCaptureObservations,
} from '@watchdog-bms/contracts';

/** The group page (W04). Also the "กรอกข้อมูลต่อ" target for a group-shaped job (§10). */
export const expenseCaptureWebPath = (companyId: string, groupId: string): string =>
  `/companies/${companyId}/expenses/capture/${groupId}`;

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
};

/**
 * What the group is waiting for, and what the caller may do — decided HERE, on the server, and
 * returned in the read model. A client that hides a button is not a guard, and a client that
 * shows one it cannot use is a dead end; both read this.
 */
export function captureGroupBlockers(state: CaptureGroupStateForActions): ExpenseCaptureBlocker[] {
  const blockers: ExpenseCaptureBlocker[] = [];
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
  return blockers;
}

export function captureGroupAllowedActions(state: CaptureGroupStateForActions): ExpenseCaptureAction[] {
  if (state.status !== 'OPEN') return [];
  const actions: ExpenseCaptureAction[] = [];
  // The intake flag closes NEW evidence only (A47): everything already in the group stays
  // reviewable, detachable and closable while it is off.
  if (state.intakeEnabled && state.canMutate) actions.push('add_file');
  if (state.canMutate && state.storedFiles > 0) actions.push('detach_file');
  if (state.canMutate && state.hasFacts) actions.push('review');
  if (state.canMutate && state.handoffState !== 'ACTIVE') actions.push('close');
  return actions;
}
