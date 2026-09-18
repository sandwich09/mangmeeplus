/**
 * Buyer expense capture — turning ONE accepted allocation scope into ONE ordinary expense (W05).
 *
 * Appendix §4/§5 (derived expense sources), §7 (tax/date defaults) and §9 (`POST …/handoff`).
 * Pure: no database, no clock, no permissions — the use case owns those. What lives here is the
 * mapping, and the two refusals that have to happen BEFORE anything is written:
 *
 *  - the totals identity must already hold (`expenseTotalsIdentityError`). The allocation builds it
 *    that way by construction, so a failure here is a bug in the maths, never a number to patch up.
 *  - an unreadable amount, a mismatch or a missing date is a blocker, not a default. A scope that
 *    still carries one never becomes a money row.
 *
 * NOTHING here decides an amount. `computeCaptureAllocation` already did, and the scope it produced
 * is copied verbatim into the columns.
 */
import { EXPENSE_CAPTURE_BLOCKERS } from '@watchdog-bms/contracts';
import type {
  CaptureAllocationResult,
  CaptureAllocationScope,
  CaptureFactsDocument,
  CaptureFactsView,
  ExpenseCaptureIntakeChannel,
  SourceDocumentType,
} from '@watchdog-bms/contracts';
import { sourceDocumentTypeFromClassification, toSourceDocumentType } from './expense-document.logic';
import { expenseTotalsIdentityError, type DocumentTotalsLine } from './expense-totals.logic';
import type { CreateExpenseRecordInput, ExpenseLineInput } from '../models/expense.model';

/** The batch key of §2.2/§9. One accepted allocation = one batch, which is why a replay is free. */
export const captureHandoffBatchKey = (groupId: string, allocationId: string): string =>
  `${groupId}:${allocationId}`;

/** §3.2: a LINE single-document group hands itself off without any allocation at all. */
export const AUTO_HANDOFF_BATCH_SUFFIX = 'auto';
export const captureAutoHandoffBatchKey = (groupId: string): string =>
  `${groupId}:${AUTO_HANDOFF_BATCH_SUFFIX}`;

/** §3.1/§9: an expense that has not been used yet, so a regenerate may still rewrite or drop it. */
export const CAPTURE_UNCONSUMED_EXPENSE_STATUSES = ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as const;

/** The expense page a derived source lands on — the "กรอกข้อมูลต่อ" target of §10. */
export const expenseWebPath = (companyId: string, expenseId: string): string =>
  `/companies/${companyId}/expenses/${expenseId}`;

export type CaptureHandoffContext = {
  companyId: string;
  branchId: string | null;
  groupId: string;
  /** Null on the §3.2 auto handoff: there is no reviewed allocation behind it. */
  allocationId: string | null;
  intakeChannel: ExpenseCaptureIntakeChannel;
  lineChatKeyHash: string | null;
  fundingRoute: 'UNKNOWN' | 'COMPANY' | 'EMPLOYEE';
  payerUserId: string | null;
  /** Never forged: the person who pressed the button, or the system actor of the LINE lane. */
  actorUserId: string;
  policyVersion: string;
  summary: CaptureAllocationResult['summary'];
};

export type DerivedSourceDraft = {
  scopeKey: string;
  claimReady: boolean;
  fileIds: string[];
  create: CreateExpenseRecordInput & {
    status: 'NEEDS_REVIEW';
    aiVerificationStatus: 'NEEDS_REVIEW';
    vendorTaxIdSnapshot?: string;
    vendorBranchCodeSnapshot?: string;
    vendorDocumentNumber?: string;
    captureGroupId: string;
    captureAllocationId: string | null;
    captureScopeKey: string;
    payerUserId: string | null;
  };
  lines: Array<Omit<ExpenseLineInput, 'expenseId' | 'companyId'>>;
};

export class CaptureHandoffError extends Error {
  constructor(readonly code: string, readonly messageTh: string) {
    super(code);
  }
}

/**
 * §4.3 documents carry the printed identity; the allocation scope carries only the issuer. The
 * document number and the document kind therefore come back from the facts the scope was built on,
 * matched by `documentRefs` — the facts cannot have moved, because any change to them invalidates
 * the allocation this scope belongs to (`PatchExpenseCaptureFactsUseCase`).
 */
export function scopeDocuments(
  scope: CaptureAllocationScope,
  facts: CaptureFactsView,
): CaptureFactsDocument[] {
  const refs = new Set(scope.documentRefs);
  return facts.documents.filter((document) => refs.has(document.ref));
}

function scopeSourceDocumentType(documents: readonly CaptureFactsDocument[]): SourceDocumentType {
  for (const document of documents) {
    const mapped = sourceDocumentTypeFromClassification(document.classification ?? null);
    if (mapped) {
      const resolved = toSourceDocumentType(mapped);
      if (resolved !== 'NEEDS_REVIEW') return resolved;
    }
  }
  return 'NEEDS_REVIEW';
}

/**
 * Scope → the create input of an ordinary expense. Products first, charges after, exactly as
 * spec §5.1 requires of an expense's own lines.
 */
export function buildDerivedSourceDraft(
  scope: CaptureAllocationScope,
  documents: readonly CaptureFactsDocument[],
  ctx: CaptureHandoffContext,
): DerivedSourceDraft {
  // §7/A04/A08: `tax_review_pending` is the ONE scope blocker a source may still be created with —
  // the expense exists and the CLAIM is what waits. Every other one is lifted to the group by
  // `computeCaptureAllocation` and already refused there; this is the second line, not the first.
  const blocking = scope.blockers.filter((entry) => entry.code !== EXPENSE_CAPTURE_BLOCKERS.TAX_REVIEW_PENDING);
  if (blocking.length > 0) {
    throw new CaptureHandoffError(
      'expense_capture_handoff_blocked',
      `ยังมีรายการที่ต้องตรวจก่อน จึงจะสร้างรายการค่าใช้จ่ายได้ (${blocking.map((entry) => entry.code).join(', ')})`,
    );
  }
  if (!scope.expenseDate) {
    throw new CaptureHandoffError(
      'expense_capture_expense_date_required',
      'ยังไม่มีวันที่ของรายการนี้ กรุณาเลือกวันที่จ่ายหรือวันที่บนเอกสาร',
    );
  }

  const lines: DerivedSourceDraft['lines'] = [];
  const totalsLines: DocumentTotalsLine[] = [];
  const pushLine = (
    description: string,
    quantity: string,
    unitPrice: string,
    discountAmount: string,
    vatRate: string | null,
    totals: CaptureAllocationScope['lines'][number]['totals'],
    chargeKind: ExpenseLineInput['chargeKind'],
  ): void => {
    lines.push({
      lineNumber: lines.length + 1,
      description,
      chargeKind: chargeKind ?? null,
      quantity,
      unitPrice,
      discountAmount,
      taxableAmount: totals.taxableAmount,
      vatRate,
      vatAmount: totals.vatAmount,
      whtRate: null,
      // The capture path never withholds (§4/§9): a WHT decision belongs to the review of the
      // expense this becomes, not to a split of what the document printed.
      whtAmount: totals.whtAmount,
      lineSubtotalAmount: totals.lineSubtotalAmount,
      lineTotalAmount: totals.lineTotalAmount,
      expenseCategoryId: null,
      accountHintKey: null,
      taxCategory: null,
      reviewStatus: 'NEEDS_REVIEW',
    });
    totalsLines.push({ ...totals, chargeKind: chargeKind ?? null });
  };

  for (const line of scope.lines) {
    pushLine(line.description, line.quantity, line.unitPrice, line.discountAmount, line.vatRate, line.totals, null);
  }
  for (const charge of scope.charges) {
    pushLine(charge.description, charge.quantity, charge.unitPrice, charge.discountAmount, charge.vatRate, charge.totals, charge.chargeKind);
  }

  // The identity of spec §5.1, proved on the rows that are about to be written rather than on the
  // ones the allocation held: a mapping bug is exactly the class of bug this catches.
  const identity = expenseTotalsIdentityError({
    vatMode: scope.vatMode,
    lines: totalsLines,
    totals: {
      subtotalAmount: scope.totals.subtotal,
      discountAmount: scope.totals.discount,
      taxableAmount: scope.totals.taxable,
      vatAmount: scope.totals.vat,
      grandTotalAmount: scope.totals.grandTotal,
    },
  });
  if (identity) {
    throw new CaptureHandoffError(
      'expense_capture_handoff_totals_invalid',
      `ยอดของรายการที่จะสร้างยังไม่ตรงกับยอดที่ตรวจไว้ (${identity}) กรุณาแจ้งผู้ดูแลระบบ`,
    );
  }

  const issuer = scope.issuer ?? {};
  const documentNumber = documents.find((document) => document.documentNumber)?.documentNumber;

  return {
    scopeKey: scope.scopeKey,
    claimReady: scope.claimReady,
    fileIds: scope.fileIds,
    lines,
    create: {
      companyId: ctx.companyId,
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      // §5: the channel the evidence came in on, so the export's `source_channel` still tells the
      // truth about where the document entered the system.
      captureSource: ctx.intakeChannel === 'LINE' ? 'LINE_UPLOAD' : 'WEB_UPLOAD',
      status: 'NEEDS_REVIEW',
      createdByUserId: ctx.actorUserId,
      // §5/A32: server-set from the reviewed allocation, and only on the route where somebody
      // actually put their own money in. A company-funded source has no payer to repay.
      payerUserId: ctx.fundingRoute === 'EMPLOYEE' ? ctx.payerUserId : null,
      expenseDate: new Date(scope.expenseDate),
      currency: scope.currency,
      // §7: copied from the scope, never forced to a value that would pass the resolver.
      vatMode: scope.vatMode,
      inputVatClaimStatus: scope.inputVatClaimStatus,
      taxEvidenceStatus: scope.taxEvidenceStatus,
      sourceDocumentType: scopeSourceDocumentType(documents),
      ...(issuer.name ? { vendorNameSnapshot: issuer.name } : {}),
      ...(issuer.taxId ? { vendorTaxIdSnapshot: issuer.taxId } : {}),
      ...(issuer.branchCode ? { vendorBranchCodeSnapshot: issuer.branchCode } : {}),
      ...(documentNumber ? { vendorDocumentNumber: documentNumber } : {}),
      subtotalAmount: scope.totals.subtotal,
      discountAmount: scope.totals.discount,
      taxableAmount: scope.totals.taxable,
      vatAmount: scope.totals.vat,
      whtAmount: '0.0000',
      grandTotalAmount: scope.totals.grandTotal,
      netPayableAmount: scope.totals.netPayable,
      outstandingAmount: scope.totals.netPayable,
      aiVerificationStatus: 'NEEDS_REVIEW',
      aiVerificationSummaryJson: {
        // `verified` because the date came off reviewed facts, not off the upload day (§5.2/A42).
        dateStatus: 'verified',
        expenseDateSource: scope.expenseDateSource,
        captureGroupId: ctx.groupId,
        allocationId: ctx.allocationId,
        scopeKey: scope.scopeKey,
        paidTotal: scope.paidTotal,
        companyAmount: scope.companyAmount,
        personalAmount: scope.personalAmount,
        policyVersion: ctx.policyVersion,
      },
      sourceChannelMetadataJson: {
        channel: ctx.intakeChannel,
        kind: 'capture_group',
        captureGroupId: ctx.groupId,
        allocationId: ctx.allocationId,
        scopeKey: scope.scopeKey,
        ...(ctx.lineChatKeyHash ? { chatKeyHash: ctx.lineChatKeyHash } : {}),
      },
      captureGroupId: ctx.groupId,
      captureAllocationId: ctx.allocationId,
      captureScopeKey: scope.scopeKey,
    },
  };
}

// ─── §3.2 auto handoff of a single-document LINE group ────────────────────────

export type CaptureAutoHandoffSkip =
  | 'group_not_open'
  | 'handoff_exists'
  | 'not_line_channel'
  | 'not_single_file'
  | 'read_not_done'
  | 'not_single_document'
  | 'not_single_issuer'
  | 'not_expense_document'
  | 'document_mismatch'
  | 'unknown_amounts'
  | 'blocked';

export type CaptureAutoHandoffInput = {
  status: 'OPEN' | 'HANDED_OFF' | 'CLOSED_NO_HANDOFF' | 'CANCELLED';
  handoffState: 'NONE' | 'ACTIVE' | 'RELEASED';
  intakeChannel: ExpenseCaptureIntakeChannel;
  /** Every file the group still claims, with the status of its read job. */
  files: ReadonlyArray<{ uploadState: string; readStatus: string | null }>;
  facts: CaptureFactsView | null;
  allocation: CaptureAllocationResult | null;
};

/**
 * §3.2: "อ่านครบ, พบเอกสารเดียว, ผู้ออกเดียว, eligible, ไม่มี blocker". Anything else leaves the
 * group OPEN for a person to review on the web — a near miss is never rounded up into an expense.
 *
 * The eligibility test is the expense-document family/kind set the single-receipt lane already
 * uses; the printed-amount half of `isExpenseExtractionEligible` is replaced by the allocation
 * itself, which only emits a scope when the money adds up (a capture read produces no
 * `amountSignals`, so calling that function directly would refuse every document).
 */
export function captureAutoHandoffEligibility(
  input: CaptureAutoHandoffInput,
): { ok: true; scope: CaptureAllocationScope } | { ok: false; skipped: CaptureAutoHandoffSkip } {
  const skip = (skipped: CaptureAutoHandoffSkip) => ({ ok: false as const, skipped });
  if (input.handoffState !== 'NONE') return skip('handoff_exists');
  if (input.status !== 'OPEN') return skip('group_not_open');
  if (input.intakeChannel !== 'LINE') return skip('not_line_channel');

  const live = input.files.filter((file) => file.uploadState !== 'DETACHED' && file.uploadState !== 'REJECTED');
  if (live.length !== 1 || live[0]!.uploadState !== 'STORED') return skip('not_single_file');
  if (live[0]!.readStatus !== 'DONE') return skip('read_not_done');

  const facts = input.facts;
  if (!facts || facts.documents.length !== 1) return skip('not_single_document');
  const document = facts.documents[0]!;
  if (new Set(facts.documents.map((row) => row.scopeKey)).size !== 1) return skip('not_single_issuer');
  if (!isCaptureExpenseDocument(document)) return skip('not_expense_document');
  if (document.state.reconciliation === 'mismatch') return skip('document_mismatch');
  if (document.state.unknownAmounts.length > 0) return skip('unknown_amounts');

  const scopes = input.allocation?.scopes ?? [];
  // Same rule as `buildDerivedSourceDraft`: a pending tax review never stops the source existing.
  const blocking = scopes[0]?.blockers.filter((entry) => entry.code !== EXPENSE_CAPTURE_BLOCKERS.TAX_REVIEW_PENDING) ?? [];
  if (scopes.length !== 1 || blocking.length > 0) return skip('blocked');
  return { ok: true, scope: scopes[0]! };
}

/** The document kinds the single-receipt lane already turns into an expense (§3.2 eligibility). */
const CAPTURE_EXPENSE_DOCUMENT_KINDS = new Set<string>([
  'RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'SUPPLIER_INVOICE_OR_BILL',
  'TRANSFER_SLIP', 'MARKETPLACE_ORDER', 'HANDWRITTEN_CASH_BILL',
]);

export function isCaptureExpenseDocument(document: CaptureFactsDocument): boolean {
  const classification = document.classification;
  if (classification?.requiresClarification) return false;
  if (classification && classification.contentKind !== 'DOCUMENT') return false;
  return CAPTURE_EXPENSE_DOCUMENT_KINDS.has(classification?.documentKind ?? document.kind);
}
