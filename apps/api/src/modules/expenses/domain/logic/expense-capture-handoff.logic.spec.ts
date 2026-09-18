/**
 * Scope → expense (W05, appendix §5/§7/§9), and the §3.2 auto-handoff gate.
 *
 * The scopes here are built by `computeCaptureAllocation` from real facts rather than hand-written,
 * because the mapping's whole job is to carry ITS output into the columns intact — a hand-made
 * scope would let the mapping and the maths drift apart and both tests still pass.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPENSE_CAPTURE_ALLOCATION_POLICY,
  EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
  type CaptureAllocationResult,
  type CaptureFactsView,
  type ExpenseCaptureObservations,
} from '@watchdog-bms/contracts';
import { computeCaptureAllocation } from './expense-capture-allocation.logic';
import { assembleCaptureFacts } from './expense-capture-facts.logic';
import {
  CaptureHandoffError,
  buildDerivedSourceDraft,
  captureAutoHandoffBatchKey,
  captureAutoHandoffEligibility,
  captureHandoffBatchKey,
  expenseWebPath,
  scopeDocuments,
  type CaptureHandoffContext,
} from './expense-capture-handoff.logic';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const classification = (over: Record<string, unknown> = {}) => ({
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 1, evidenceSignals: [], amountSignals: [], settlementSignals: [],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  ...over,
} as ExpenseCaptureObservations['documents'][number]['classification']);

/** ร้านเอ: two goods rows, a 100 baht shop discount and a 50 baht delivery charge, paid 190. */
const observations = (over: Partial<ExpenseCaptureObservations> = {}): ExpenseCaptureObservations => ({
  documents: [{
    ref: 'D1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
    issuer: { name: 'ร้านเอ', taxId: '0105560012345', branchCode: '00000' },
    documentNumber: 'RC-0001', documentDate: '2026-09-10', currency: 'THB',
    classification: classification(),
  }],
  items: [
    { id: '1:1', documentRef: 'D1', description: 'กระดาษ', quantity: '2', unitPrice: '50.00', amount: '100.00', event: 'sale', evidenceSpan: 'กระดาษ' },
    { id: '1:2', documentRef: 'D1', description: 'หมึก', quantity: '1', unitPrice: '140.00', amount: '140.00', event: 'sale', evidenceSpan: 'หมึก' },
  ],
  components: [
    { id: '1:d', documentRef: 'D1', label: 'ส่วนลดร้าน', amount: '100.00', currency: 'THB', role: 'applied_discount', scope: 'order', appliedStatus: 'applied', evidenceSpan: 'ส่วนลด' },
    { id: '1:s', documentRef: 'D1', label: 'ค่าส่ง', amount: '50.00', currency: 'THB', role: 'charge', scope: 'shipping', appliedStatus: 'applied', evidenceSpan: 'ค่าส่ง' },
  ],
  totals: [{ documentRef: 'D1', kind: 'document_total', amount: '190.00', evidenceSpan: '190' }],
  payments: [{ documentRef: 'D1', status: 'paid', amount: '190.00', occurredAt: '2026-09-10T04:00:00.000Z', evidenceSpan: '190' }],
  refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  ...over,
});

const facts = (payload: ExpenseCaptureObservations = observations()): CaptureFactsView =>
  assembleCaptureFacts([{
    id: 'obs-1', companyId: 'co-1', groupId: 'g-1', fileId: 'f1', expenseId: null, version: 1,
    source: 'AI', stale: false, payloadJson: payload,
  }] as never);

const allocate = (view: CaptureFactsView, over: Record<string, unknown> = {}): CaptureAllocationResult =>
  computeCaptureAllocation({
    facts: view, businessUse: 'ALL_COMPANY', selection: {}, fundingRoute: 'EMPLOYEE',
    payerUserId: 'user-payer', taxReview: {}, expenseDateChoice: {},
    policy: EXPENSE_CAPTURE_ALLOCATION_POLICY, todayIso: '2026-09-19T00:00:00.000Z',
    ...over,
  } as never);

const handoffCtx = (over: Partial<CaptureHandoffContext> = {}): CaptureHandoffContext => ({
  companyId: 'co-1', branchId: 'branch-1', groupId: 'g-1', allocationId: 'alloc-1',
  intakeChannel: 'WEB', lineChatKeyHash: null, fundingRoute: 'EMPLOYEE', payerUserId: 'user-payer',
  actorUserId: 'user-1', policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
  summary: { companyAmount: '190.00', personalAmount: '0.00', paidTotal: '190.00' },
  ...over,
});

// ─── the mapping ──────────────────────────────────────────────────────────────

describe('scope → derived expense source', () => {
  it('copies the reviewed scope into an ordinary NEEDS_REVIEW expense with its lineage', () => {
    const view = facts();
    const result = allocate(view);
    const scope = result.scopes[0]!;
    const draft = buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx());

    assert.equal(draft.create.status, 'NEEDS_REVIEW');
    assert.equal(draft.create.aiVerificationStatus, 'NEEDS_REVIEW');
    assert.equal(draft.create.captureSource, 'WEB_UPLOAD');
    assert.equal(draft.create.createdByUserId, 'user-1', 'the creator is the caller, never forged');
    assert.equal(draft.create.payerUserId, 'user-payer');
    assert.equal(draft.create.vendorNameSnapshot, 'ร้านเอ');
    assert.equal(draft.create.vendorTaxIdSnapshot, '0105560012345');
    assert.equal(draft.create.vendorBranchCodeSnapshot, '00000');
    assert.equal(draft.create.vendorDocumentNumber, 'RC-0001');
    assert.equal(draft.create.sourceDocumentType, 'RECEIPT');
    assert.equal(draft.create.currency, 'THB');
    assert.equal(draft.create.captureGroupId, 'g-1');
    assert.equal(draft.create.captureAllocationId, 'alloc-1');
    assert.equal(draft.create.captureScopeKey, scope.scopeKey);
    // §7/A42: the reviewed payment date, never the upload day.
    assert.equal(draft.create.expenseDate.toISOString().slice(0, 10), '2026-09-10');
    assert.equal((draft.create.aiVerificationSummaryJson as Record<string, unknown>).dateStatus, 'verified');
  });

  it('carries the totals verbatim and keeps the identity that lets a claim cite it', () => {
    const view = facts();
    const scope = allocate(view).scopes[0]!;
    const draft = buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx());

    assert.equal(draft.create.grandTotalAmount, scope.totals.grandTotal);
    assert.equal(draft.create.netPayableAmount, scope.totals.netPayable);
    assert.equal(draft.create.outstandingAmount, scope.totals.netPayable);
    assert.equal(draft.create.whtAmount, '0.0000', 'the capture path never withholds');
    // 100 + 140 − 100 shop discount + 50 delivery = 190, which is what the document printed.
    assert.equal(draft.create.grandTotalAmount, '190.0000');
    const lineSum = draft.lines.reduce((total, line) => total + Number(line.lineTotalAmount), 0);
    assert.equal(lineSum.toFixed(2), Number(draft.create.netPayableAmount).toFixed(2),
      'the resolver adds the lines up against netPayable — they have to agree');
  });

  it('writes the goods first and the charge rows after, as an expense’s own lines must sort', () => {
    const view = facts();
    const scope = allocate(view).scopes[0]!;
    const draft = buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx());

    assert.deepEqual(draft.lines.map((line) => line.lineNumber), [1, 2, 3]);
    assert.deepEqual(draft.lines.map((line) => line.chargeKind), [null, null, 'DELIVERY']);
    assert.equal(draft.lines[2]!.lineTotalAmount, '50.0000');
    assert.deepEqual(draft.lines.map((line) => line.reviewStatus), ['NEEDS_REVIEW', 'NEEDS_REVIEW', 'NEEDS_REVIEW']);
  });

  it('records the channel, the group and the allocation in the source metadata', () => {
    const view = facts();
    const scope = allocate(view).scopes[0]!;
    const draft = buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx({
      intakeChannel: 'LINE', lineChatKeyHash: 'chat-hash',
    }));

    assert.equal(draft.create.captureSource, 'LINE_UPLOAD');
    assert.deepEqual(draft.create.sourceChannelMetadataJson, {
      channel: 'LINE', kind: 'capture_group', captureGroupId: 'g-1', allocationId: 'alloc-1',
      scopeKey: scope.scopeKey, chatKeyHash: 'chat-hash',
    });
    const summary = draft.create.aiVerificationSummaryJson as Record<string, unknown>;
    assert.equal(summary.paidTotal, '190.00');
    assert.equal(summary.companyAmount, scope.companyAmount);
    assert.equal(summary.policyVersion, EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION);
  });

  it('leaves the payer null on a company-funded route — there is nobody to repay', () => {
    const view = facts();
    const scope = allocate(view, { fundingRoute: 'COMPANY', payerUserId: null }).scopes[0]!;
    const draft = buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx({
      fundingRoute: 'COMPANY', payerUserId: 'user-payer',
    }));
    assert.equal(draft.create.payerUserId, null);
  });

  it('copies the tax review verbatim instead of forcing a value the resolver would accept', () => {
    const view = facts();
    const scope = allocate(view, {
      taxReview: { 'issuer:0105560012345': { vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY' } },
    }).scopes[0]!;
    const draft = buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx());

    assert.equal(draft.create.vatMode, 'NO_VAT');
    assert.equal(draft.create.inputVatClaimStatus, 'NON_CLAIMABLE');
    assert.equal(draft.create.taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.equal(scope.claimReady, true);

    // Undecided stays undecided: the source is created, the CLAIM is what waits (§7/A08).
    const undecided = allocate(view).scopes[0]!;
    assert.equal(undecided.taxEvidenceStatus, 'NEEDS_REVIEW');
    assert.equal(undecided.claimReady, false);
  });

  it('refuses a scope that still carries a blocker rather than writing a money row', () => {
    const view = facts(observations({
      items: [
        { id: '1:1', documentRef: 'D1', description: 'อ่านยอดไม่ได้', quantity: '1', event: 'sale', evidenceSpan: 'x' },
        { id: '1:2', documentRef: 'D1', description: 'หมึก', quantity: '1', unitPrice: '140.00', amount: '140.00', event: 'sale', evidenceSpan: 'หมึก' },
      ],
    }));
    const scope = allocate(view).scopes[0]!;
    assert.ok(scope.blockers.length > 0);
    assert.throws(
      () => buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx()),
      (error: unknown) => error instanceof CaptureHandoffError && error.code === 'expense_capture_handoff_blocked',
    );
  });

  it('refuses when the mapped rows do not add up to the reviewed totals', () => {
    const view = facts();
    const scope = allocate(view).scopes[0]!;
    // A mapping bug, simulated: the header says one thing and the rows another. Nothing is
    // rounded to close the gap — the write is refused (A24/A34).
    const broken = { ...scope, totals: { ...scope.totals, grandTotal: '999.0000', taxable: '999.0000' } };
    assert.throws(
      () => buildDerivedSourceDraft(broken, scopeDocuments(scope, view), handoffCtx()),
      (error: unknown) => error instanceof CaptureHandoffError && error.code === 'expense_capture_handoff_totals_invalid',
    );
  });

  it('refuses a scope with no reviewed date instead of defaulting to today', () => {
    const view = facts();
    const scope = allocate(view).scopes[0]!;
    assert.throws(
      () => buildDerivedSourceDraft({ ...scope, expenseDate: null }, scopeDocuments(scope, view), handoffCtx()),
      (error: unknown) => error instanceof CaptureHandoffError && error.code === 'expense_capture_expense_date_required',
    );
  });

  it('falls back to NEEDS_REVIEW when the document kind is not one the expense lane knows', () => {
    const view = facts(observations({
      documents: [{
        ref: 'D1', pageIndexes: [0], kind: 'NEEDS_REVIEW', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ร้านเอ', taxId: '0105560012345' }, currency: 'THB',
        classification: classification({ documentKind: 'NEEDS_REVIEW' }),
      }],
    }));
    const scope = allocate(view).scopes[0]!;
    const draft = buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx());
    assert.equal(draft.create.sourceDocumentType, 'NEEDS_REVIEW');
  });

  it('maps a supplier bill onto the review document type the expense lane uses', () => {
    const view = facts(observations({
      documents: [{
        ref: 'D1', pageIndexes: [0], kind: 'SUPPLIER_INVOICE_OR_BILL', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ร้านเอ', taxId: '0105560012345' }, documentNumber: 'INV-9', currency: 'THB',
        classification: classification({ documentKind: 'SUPPLIER_INVOICE_OR_BILL' }),
      }],
    }));
    const scope = allocate(view).scopes[0]!;
    assert.equal(buildDerivedSourceDraft(scope, scopeDocuments(scope, view), handoffCtx()).create.sourceDocumentType, 'SUPPLIER_BILL');
  });
});

describe('batch keys and links', () => {
  it('derives one batch key per accepted allocation, and a named one for the auto lane', () => {
    assert.equal(captureHandoffBatchKey('g-1', 'alloc-1'), 'g-1:alloc-1');
    assert.equal(captureAutoHandoffBatchKey('g-1'), 'g-1:auto');
  });

  it('points at the expense page a derived source lands on', () => {
    assert.equal(expenseWebPath('co-1', 'exp-1'), '/companies/co-1/expenses/exp-1');
  });

  it('picks only this scope’s documents out of the group’s facts', () => {
    const view = facts();
    const scope = allocate(view).scopes[0]!;
    assert.deepEqual(scopeDocuments(scope, view).map((document) => document.ref), scope.documentRefs);
    assert.deepEqual(scopeDocuments({ ...scope, documentRefs: ['nope'] }, view), []);
  });
});

// ─── §3.2 auto handoff ────────────────────────────────────────────────────────

describe('single-document auto handoff eligibility', () => {
  const eligible = (over: Record<string, unknown> = {}) => {
    const view = facts();
    return captureAutoHandoffEligibility({
      status: 'OPEN', handoffState: 'NONE', intakeChannel: 'LINE',
      files: [{ uploadState: 'STORED', readStatus: 'DONE' }],
      facts: view,
      allocation: allocate(view, { fundingRoute: 'UNKNOWN', payerUserId: null }),
      ...over,
    } as never);
  };

  it('accepts one LINE file, read, one document, one issuer, nothing unknown', () => {
    const result = eligible();
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.scope.companyAmount, '190.00');
  });

  it('skips everything that is not exactly that', () => {
    assert.deepEqual(eligible({ status: 'CLOSED_NO_HANDOFF' }), { ok: false, skipped: 'group_not_open' });
    assert.deepEqual(eligible({ handoffState: 'ACTIVE' }), { ok: false, skipped: 'handoff_exists' });
    assert.deepEqual(eligible({ intakeChannel: 'WEB' }), { ok: false, skipped: 'not_line_channel' });
    assert.deepEqual(
      eligible({ files: [{ uploadState: 'STORED', readStatus: 'DONE' }, { uploadState: 'STORED', readStatus: 'DONE' }] }),
      { ok: false, skipped: 'not_single_file' },
    );
    assert.deepEqual(eligible({ files: [{ uploadState: 'PENDING_UPLOAD', readStatus: null }] }), { ok: false, skipped: 'not_single_file' });
    assert.deepEqual(eligible({ files: [{ uploadState: 'STORED', readStatus: 'PARTIAL' }] }), { ok: false, skipped: 'read_not_done' });
    assert.deepEqual(eligible({ facts: null }), { ok: false, skipped: 'not_single_document' });
  });

  it('ignores a detached file when counting what the group still holds', () => {
    const result = eligible({
      files: [{ uploadState: 'DETACHED', readStatus: 'CANCELLED' }, { uploadState: 'STORED', readStatus: 'DONE' }],
    });
    assert.equal(result.ok, true);
  });

  it('skips two documents, two issuers, and a kind the expense lane does not take', () => {
    const twoDocuments = facts(observations({
      documents: [
        { ref: 'D1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้านเอ', taxId: '0105560012345' }, currency: 'THB', classification: classification() },
        { ref: 'D2', pageIndexes: [1], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้านบี', taxId: '0105560099999' }, currency: 'THB', classification: classification() },
      ],
    }));
    assert.deepEqual(eligible({ facts: twoDocuments, allocation: allocate(twoDocuments, { fundingRoute: 'UNKNOWN', payerUserId: null }) }),
      { ok: false, skipped: 'not_single_document' });

    const quotation = facts(observations({
      documents: [{
        ref: 'D1', pageIndexes: [0], kind: 'QUOTATION', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ร้านเอ', taxId: '0105560012345' }, currency: 'THB',
        classification: classification({ documentKind: 'QUOTATION' }),
      }],
    }));
    assert.deepEqual(eligible({ facts: quotation, allocation: allocate(quotation, { fundingRoute: 'UNKNOWN', payerUserId: null }) }),
      { ok: false, skipped: 'not_expense_document' });
  });

  it('skips a document with an unreadable amount and one whose totals do not reconcile', () => {
    const unknownAmount = facts(observations({
      items: [
        { id: '1:1', documentRef: 'D1', description: 'อ่านยอดไม่ได้', quantity: '1', event: 'sale', evidenceSpan: 'x' },
        { id: '1:2', documentRef: 'D1', description: 'หมึก', quantity: '1', unitPrice: '140.00', amount: '140.00', event: 'sale', evidenceSpan: 'หมึก' },
      ],
    }));
    assert.deepEqual(
      eligible({ facts: unknownAmount, allocation: allocate(unknownAmount, { fundingRoute: 'UNKNOWN', payerUserId: null }) }),
      { ok: false, skipped: 'unknown_amounts' },
    );

    const mismatch = facts(observations({
      totals: [{ documentRef: 'D1', kind: 'document_total', amount: '900.00', evidenceSpan: '900' }],
    }));
    assert.deepEqual(
      eligible({ facts: mismatch, allocation: allocate(mismatch, { fundingRoute: 'UNKNOWN', payerUserId: null }) }),
      { ok: false, skipped: 'document_mismatch' },
    );
  });

  it('skips when the allocation itself has nothing to hand over', () => {
    assert.deepEqual(eligible({ allocation: null }), { ok: false, skipped: 'blocked' });
    assert.deepEqual(eligible({ allocation: { scopes: [], blockers: [], outcome: 'BLOCKED', summary: { companyAmount: '0.00', personalAmount: '0.00', paidTotal: '0.00' }, policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION } }),
      { ok: false, skipped: 'blocked' });
  });
});
