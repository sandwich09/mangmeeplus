import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  BusinessDocumentClassification, CaptureAllocationLine, CaptureAllocationResult, CaptureAllocationScope,
  CaptureFactsDocument, CaptureFactsItem, CaptureFactsView, ExpenseCaptureFileDto,
  ExpenseCaptureGroupDetailDto,
} from '@watchdog-bms/contracts';
import { workspaceDictionary } from '../../../common/i18n/workspace-dictionary';
import {
  captureAllocation, captureBlockerRows, captureClaimReady, captureDateChoicePayload, captureDateOption,
  captureDerivedRows, captureHandoffConfirmParams, captureItemEventKey, capturePayer,
  capturePersonalFromAllocation, capturePersonalMax, captureProvenanceRows, captureReadState,
  captureReconciliationChip, captureComponentRoleKey, capturePaymentNoticeKey, captureSelectionPayload,
  captureStateChips, captureSummary, captureText,
} from './expense-capture-review.logic';

/**
 * The derivations behind the group page (appendix §11, spec §13.2/§13.4). Every assertion here is a
 * rule a person would be misled by if it broke: a count claimed as complete, a green tick over six
 * separate states, a stepper that silently hands the company somebody's personal shopping, or a
 * "เตรียมใบเบิก" button on a source the resolver would refuse.
 */

const CLASSIFICATION: BusinessDocumentClassification = {
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 0.9, evidenceSignals: [], amountSignals: [], settlementSignals: [],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
};

const file = (over: Partial<ExpenseCaptureFileDto> = {}): ExpenseCaptureFileDto => ({
  fileId: 'file-1', attachmentId: 'att-1', position: 0, uploadState: 'STORED',
  originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 1_000, checksumSha256: null,
  pageCount: 1, readStatus: 'DONE', pagesRead: 1, pausedReason: null, lastErrorCode: null,
  electronicVerification: { status: 'NOT_CHECKED', method: null, checkedAt: null },
  addedByUserId: 'user-1', detachedReason: null, createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z', ...over,
});

const document = (over: Partial<CaptureFactsDocument> = {}): CaptureFactsDocument => ({
  ref: 'file-1:doc-1', pageIndexes: [2], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
  issuer: { name: 'ร้านเอ' }, classification: CLASSIFICATION, fileId: 'file-1', scopeKey: 'issuer:ร้านเอ',
  state: {
    reconciliation: 'reconciled', documentTotal: '1000.00', buyerPayable: '1000.00',
    paymentStatus: 'paid', unknownAmounts: [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  },
  ...over,
});

const item = (over: Partial<CaptureFactsItem> = {}): CaptureFactsItem => ({
  id: 'file-1:1:1', documentRef: 'file-1:doc-1', description: 'กระดาษ A4', quantity: '3',
  unitPrice: '100.00', amount: '300.00', event: 'sale', evidenceSpan: 'กระดาษ A4',
  fileId: 'file-1', scopeKey: 'issuer:ร้านเอ', ...over,
});

const facts = (over: Partial<CaptureFactsView> = {}): CaptureFactsView => ({
  documents: [document()], items: [item()], components: [], totals: [], payments: [], refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  files: [{ fileId: 'file-1', observationId: 'obs-1', version: 1, source: 'AI', completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] } }],
  summary: { documents: 1, items: 1, filesRead: 1, filesPartial: 0, unknownItems: 0 },
  ...over,
});

const line = (over: Partial<CaptureAllocationLine> = {}): CaptureAllocationLine => ({
  itemId: 'file-1:1:1', description: 'กระดาษ A4', quantity: '2', unitPrice: '100.00',
  discountAmount: '0.0000', vatRate: null,
  totals: { lineSubtotalAmount: '200.0000', discountAmount: '0.0000', taxableAmount: '200.0000', vatAmount: '0.0000', whtAmount: '0.0000', lineTotalAmount: '200.0000' },
  provenance: {
    itemId: 'file-1:1:1', companyQuantity: '2', quantity: '3', quantityInferred: false,
    unitPrice: '100.00', baseAmount: '300.00',
    discountShares: [{ componentId: 'file-1:c1', share: '30.00', remainderAdjust: true }],
    shippingShare: '10.00',
  },
  ...over,
});

const scope = (over: Partial<CaptureAllocationScope> = {}): CaptureAllocationScope => ({
  scopeKey: 'issuer:ร้านเอ', fileIds: ['file-1'], documentRefs: ['file-1:doc-1'],
  issuer: { name: 'ร้านเอ' }, currency: 'THB', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
  taxEvidenceStatus: 'NEEDS_REVIEW', taxSource: 'facts', expenseDate: '2026-09-01',
  expenseDateSource: 'payment', lines: [line()], charges: [],
  totals: { subtotal: '200.0000', discount: '0.0000', taxable: '200.0000', vat: '0.0000', grandTotal: '200.0000', netPayable: '200.0000' },
  companyAmount: '810.00', personalAmount: '480.00', paidTotal: '1290.00', claimReady: false, blockers: [],
  ...over,
});

const allocationResult = (over: Partial<CaptureAllocationResult> = {}): CaptureAllocationResult => ({
  policyVersion: 'shared-discount-v1+shipping-by-eligible-item-v1',
  outcome: 'READY', scopes: [scope()], blockers: [],
  summary: { companyAmount: '810.00', personalAmount: '480.00', paidTotal: '1290.00' },
  ...over,
});

const group = (over: Partial<ExpenseCaptureGroupDetailDto> = {}): ExpenseCaptureGroupDetailDto => ({
  groupId: 'grp-1', companyId: 'co-1', branchId: null, intakeChannel: 'WEB', status: 'OPEN', revision: 3,
  businessUse: 'UNKNOWN', fundingRoute: 'UNKNOWN', payerUserId: null, handoffState: 'NONE',
  acceptedAllocationId: null, note: null, closedReason: null, closedAt: null, createdByUserId: 'user-1',
  createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
  facts: facts(), files: [file()], allocation: null, derivedSources: [], blockers: [],
  allowedActions: ['review'], webPath: '/companies/co-1/expenses/capture/grp-1',
  capability: { maxBytes: 10_485_760, allowedMimeTypes: ['application/pdf'], pdfAutomaticRead: true, pdfMaxPagesAutomatic: 60 },
  ...over,
});

const withAllocation = (result: CaptureAllocationResult, over: Partial<ExpenseCaptureGroupDetailDto> = {}) => group({
  allocation: {
    allocationId: 'alloc-1', groupRevision: 3, policyVersion: result.policyVersion, status: 'PREVIEW',
    fundingRoute: 'EMPLOYEE', payerUserId: 'user-2', computedByUserId: 'user-1',
    computedAt: '2026-09-18T01:00:00.000Z', acceptedByUserId: null, acceptedAt: null,
    invalidatedReason: null, result,
  },
  ...over,
});

// ─── Summary (§13.4) ──────────────────────────────────────────────────────────

test('the shop/item count always says how much of the evidence it came from', () => {
  const complete = captureSummary(group(), 'user-1');
  assert.deepEqual(complete.headline, {
    key: 'expenses.capture.summary_documents', params: { documents: '1', items: '1' },
  });
  assert.equal(complete.incomplete, null, 'every stored file was read');

  // A second file is stored but its read failed: the count is real, the claim of completeness is not.
  const partial = captureSummary(group({
    files: [file(), file({ fileId: 'file-2', attachmentId: 'att-2', readStatus: 'FAILED' })],
  }), 'user-1');
  assert.deepEqual(partial.incomplete, {
    key: 'expenses.capture.summary_incomplete', params: { read: '1', total: '2' },
  });
});

test('money is only stated once the server has allocated it', () => {
  const before = captureSummary(group(), 'user-1');
  assert.equal(before.paidTotal, null);
  assert.equal(before.companyAmount, null);

  const after = captureSummary(withAllocation(allocationResult()), 'user-1');
  assert.equal(after.paidTotal, '1290.00');
  assert.equal(after.companyAmount, '810.00');
  assert.equal(after.personalAmount, '480.00');
});

test('the payer is never the person looking at the page', () => {
  assert.deepEqual(capturePayer({ fundingRoute: 'UNKNOWN', payerUserId: null }, 'user-1'), { kind: 'unknown' });
  // Even with an uploader on the record, an unanswered route stays unanswered (spec §3 step 5).
  assert.deepEqual(capturePayer({ fundingRoute: 'UNKNOWN', payerUserId: 'user-9' }, 'user-1'), { kind: 'unknown' });
  assert.deepEqual(capturePayer({ fundingRoute: 'COMPANY', payerUserId: null }, 'user-1'), { kind: 'company' });
  assert.deepEqual(capturePayer({ fundingRoute: 'EMPLOYEE', payerUserId: 'user-1' }, 'user-1'), { kind: 'self', userId: 'user-1' });
  assert.deepEqual(capturePayer({ fundingRoute: 'EMPLOYEE', payerUserId: 'user-2' }, 'user-1'), { kind: 'member', userId: 'user-2' });
});

// ─── The four axes (§13.2) ────────────────────────────────────────────────────

test('read, money, payer and tax are four chips — never one green state', () => {
  const chips = captureStateChips(group());
  assert.deepEqual(chips.map((chip) => chip.axis), ['read', 'money', 'payer', 'tax']);
  assert.deepEqual(chips.map((chip) => chip.key), [
    'expenses.capture.chip_read_done',
    'expenses.capture.chip_money_unknown',
    'expenses.capture.chip_payer_unknown',
    'expenses.capture.chip_tax_unknown',
  ]);

  // A finished read says nothing about the money, and allocated money says nothing about the tax.
  const allocated = captureStateChips(withAllocation(allocationResult(), { fundingRoute: 'COMPANY' }));
  assert.deepEqual(allocated.map((chip) => chip.key), [
    'expenses.capture.chip_read_done',
    'expenses.capture.chip_money_ready',
    'expenses.capture.chip_payer_company',
    'expenses.capture.chip_tax_facts',
  ]);
});

test('each axis reports its own state', () => {
  const byAxis = (detail: ExpenseCaptureGroupDetailDto) =>
    Object.fromEntries(captureStateChips(detail).map((chip) => [chip.axis, chip.key]));

  assert.equal(byAxis(group({ files: [file({ readStatus: 'READING' })] })).read, 'expenses.capture.chip_read_running');
  assert.equal(byAxis(group({ files: [file({ readStatus: 'PARTIAL' })] })).read, 'expenses.capture.chip_read_incomplete');
  assert.equal(byAxis(group({ files: [] })).read, 'expenses.capture.chip_read_none');

  const blocked = allocationResult({ outcome: 'BLOCKED', blockers: [{ code: 'expense_capture_payer_required', messageTh: 'x' }] });
  assert.equal(byAxis(withAllocation(blocked, { fundingRoute: 'EMPLOYEE' })).money, 'expenses.capture.chip_money_blocked');
  assert.equal(byAxis(withAllocation(blocked, { fundingRoute: 'EMPLOYEE' })).payer, 'expenses.capture.chip_payer_required');

  const noPortion = allocationResult({ outcome: 'NO_COMPANY_PORTION', scopes: [] });
  assert.equal(byAxis(withAllocation(noPortion)).money, 'expenses.capture.chip_money_none');

  const waitingTax = allocationResult({
    scopes: [scope({ blockers: [{ code: 'expense_capture_tax_review_pending', messageTh: 'รอตรวจภาษี' }] })],
  });
  assert.equal(byAxis(withAllocation(waitingTax)).tax, 'expenses.capture.chip_tax_pending');
  assert.equal(byAxis(withAllocation(allocationResult({ scopes: [scope({ taxSource: 'review' })] }))).tax, 'expenses.capture.chip_tax_reviewed');
});

test('the read state follows the files the group still holds', () => {
  assert.equal(captureReadState([file({ uploadState: 'DETACHED', readStatus: 'READING' })]), 'none');
  assert.equal(captureReadState([file(), file({ fileId: 'f2', readStatus: null })]), 'none');
  assert.equal(captureReadState([file(), file({ fileId: 'f2', readStatus: 'PAUSED' })]), 'incomplete');
});

// ─── Blockers ─────────────────────────────────────────────────────────────────

test('every blocker carries the problem and a way out', () => {
  const rows = captureBlockerRows([
    { code: 'expense_capture_payer_required', messageTh: 'ยังไม่ได้ระบุผู้จ่าย' },
    { code: 'expense_capture_document_mismatch', messageTh: 'ยอดในเอกสารยังไม่ตรงกัน' },
    { code: 'something_new', messageTh: '' },
  ], (code) => `แปลแล้ว:${code}`);
  assert.deepEqual(rows.map((row) => row.wayOutKey), [
    'expenses.capture.way_out_payer',
    'expenses.capture.way_out_document_mismatch',
    'expenses.capture.way_out_generic',
  ]);
  // A server that sends no Thai text still gets the product's own sentence for that code.
  assert.equal(rows[2]!.message, 'แปลแล้ว:something_new');
  for (const row of rows) {
    assert.ok(workspaceDictionary.th[row.wayOutKey].length > 0, row.wayOutKey);
    assert.ok(workspaceDictionary.en[row.wayOutKey].length > 0, `${row.wayOutKey} has no English`);
  }
});

test('every capture blocker code the engine can emit has its own way out', () => {
  const codes = [
    'expense_capture_no_evidence', 'expense_capture_read_pending', 'expense_capture_facts_unavailable',
    'expense_capture_review_required', 'expense_capture_business_use_required',
    'expense_capture_funding_route_required', 'expense_capture_payer_required',
    'expense_capture_company_paid_personal_portion', 'expense_capture_item_amount_unknown',
    'expense_capture_document_mismatch', 'expense_capture_component_unclassified',
    'expense_capture_expense_date_required', 'expense_capture_currency_unsupported',
    'expense_capture_totals_identity_failed', 'expense_capture_tax_review_pending',
  ];
  for (const code of codes) {
    const [row] = captureBlockerRows([{ code, messageTh: 'x' }], () => 'x');
    assert.notEqual(row!.wayOutKey, 'expenses.capture.way_out_generic', `${code} falls back to the generic way out`);
  }
});

// ─── Facts copy ───────────────────────────────────────────────────────────────

test('reconciliation, payment and role wording come from the document, not from hope', () => {
  assert.equal(captureReconciliationChip(document().state).key, 'expenses.capture.recon_reconciled');
  assert.equal(captureReconciliationChip({ ...document().state, reconciliation: 'mismatch' }).key, 'expenses.capture.recon_mismatch');
  assert.equal(captureReconciliationChip({ ...document().state, reconciliation: 'insufficient' }).key, 'expenses.capture.recon_insufficient');

  // An order total with no payment evidence says exactly that (spec §13.4 row 1).
  assert.equal(capturePaymentNoticeKey({ ...document().state, paymentStatus: 'unknown' }), 'expenses.capture.payment_unpaid');
  assert.equal(capturePaymentNoticeKey({ ...document().state, paymentStatus: 'pending' }), 'expenses.capture.payment_unpaid');
  assert.match(workspaceDictionary.th['expenses.capture.payment_unpaid'], /ยังไม่พบหลักฐานว่าจ่ายสำเร็จ/);

  assert.equal(captureComponentRoleKey({ role: 'charge', scope: 'shipping' }), 'expenses.capture.role_shipping');
  assert.equal(captureComponentRoleKey({ role: 'charge', scope: 'order' }), 'expenses.capture.role_charge');
  assert.equal(captureComponentRoleKey({ role: 'future_reward', scope: 'order' }), 'expenses.capture.role_future_reward');
  assert.match(workspaceDictionary.th['expenses.capture.role_future_reward'], /ไม่ลดยอด/);
  assert.equal(captureItemEventKey('sale'), null, 'an ordinary purchase gets no chip');
  assert.equal(captureItemEventKey('void'), 'expenses.capture.event_void');
  assert.equal(captureItemEventKey('zero_price_promo'), 'expenses.capture.event_gift');
});

// ─── Selection (spec §3 step 4 / §16.2) ───────────────────────────────────────

test('a row the document never counted is all-or-nothing, and a non-purchase row has no stepper', () => {
  assert.equal(capturePersonalMax(item()), 3);
  assert.equal(capturePersonalMax(item({ quantity: undefined })), 1);
  assert.equal(capturePersonalMax(item({ event: 'void' })), 0);
  assert.equal(capturePersonalMax(item({ event: 'discount' })), 0);
});

test('MIXED sends every selectable row, because a row left out is a row given away', () => {
  const rows = [item(), item({ id: 'file-1:1:2', quantity: '1' }), item({ id: 'file-1:1:3', event: 'void' })];
  assert.deepEqual(captureSelectionPayload(rows, { 'file-1:1:1': 1 }, 'MIXED'), {
    'file-1:1:1': { companyQuantity: '2' },
    'file-1:1:2': { companyQuantity: '1' },
  });
  // ALL_COMPANY sends nothing: the engine gives every unit to the company and a stale selection
  // must not survive the answer changing.
  assert.deepEqual(captureSelectionPayload(rows, { 'file-1:1:1': 1 }, 'ALL_COMPANY'), {});
  assert.deepEqual(captureSelectionPayload(rows, {}, 'UNKNOWN'), {});
  // Over- and under-asking is clamped before it reaches the money.
  assert.deepEqual(captureSelectionPayload([item()], { 'file-1:1:1': 99 }, 'MIXED'), { 'file-1:1:1': { companyQuantity: '0' } });
  assert.deepEqual(captureSelectionPayload([item()], { 'file-1:1:1': -4 }, 'MIXED'), { 'file-1:1:1': { companyQuantity: '3' } });
});

test('reopening the page shows the split that is stored, not a fresh "all company"', () => {
  const stored = withAllocation(allocationResult(), {
    businessUse: 'MIXED',
    facts: facts({ items: [item(), item({ id: 'file-1:1:2', quantity: '1' })] }),
  });
  // The line says 2 of 3 are the company's, so 1 is personal; a row with no line at all was
  // entirely personal — and a row with no readable amount is not flipped behind the reviewer.
  assert.deepEqual(capturePersonalFromAllocation(stored), { 'file-1:1:1': 1, 'file-1:1:2': 1 });
  const unreadable = withAllocation(allocationResult(), {
    businessUse: 'MIXED',
    facts: facts({ items: [item({ id: 'file-1:1:9', amount: undefined, unitPrice: undefined })] }),
  });
  assert.deepEqual(capturePersonalFromAllocation(unreadable), { 'file-1:1:9': 0 });
  assert.deepEqual(capturePersonalFromAllocation(group({ businessUse: 'ALL_COMPANY' })), {});
});

// ─── Provenance, handoff and the claim link ───────────────────────────────────

test('the split shows where every satang came from, in the order it was applied', () => {
  assert.deepEqual(captureProvenanceRows(line()), [
    { kind: 'base', amount: '300.00' },
    { kind: 'discount', amount: '30.00', remainderAdjust: true },
    { kind: 'shipping', amount: '10.00' },
    { kind: 'quantity', company: '2', quantity: '3', inferred: false },
  ]);
  const noShipping = captureProvenanceRows(line({
    provenance: { ...line().provenance, shippingShare: undefined, discountShares: [] },
  }));
  assert.deepEqual(noShipping.map((row) => row.kind), ['base', 'quantity']);
});

test('the handoff confirm names how many records and which shops', () => {
  const params = captureHandoffConfirmParams(allocationResult({
    scopes: [scope(), scope({ scopeKey: 'issuer:ร้านบี', issuer: { storefront: 'ร้านบี' } })],
  }));
  assert.deepEqual(params, { count: '2', shops: 'ร้านเอ, ร้านบี' });
  const message = captureText(workspaceDictionary.th['expenses.capture.handoff_confirm_message'], params);
  assert.match(message, /2 รายการ/);
  assert.match(message, /ร้านเอ, ร้านบี/);
  // §3 step 9: what the records are NOT is part of the sentence.
  assert.match(message, /รอตรวจสอบ/);
  assert.match(message, /ยังไม่ส่งอนุมัติ/);
  assert.match(workspaceDictionary.th['expenses.capture.handoff_done'], /ยังไม่ได้ส่งอนุมัติ/);
});

test('"เตรียมใบเบิก" appears only for an employee-funded source whose tax review passed', () => {
  assert.equal(captureClaimReady(scope({ claimReady: true }), 'EMPLOYEE'), true);
  assert.equal(captureClaimReady(scope({ claimReady: true }), 'COMPANY'), false);
  assert.equal(captureClaimReady(scope({ claimReady: false }), 'EMPLOYEE'), false);

  const detail = withAllocation(allocationResult({ scopes: [scope({ claimReady: true })] }), {
    fundingRoute: 'EMPLOYEE',
    derivedSources: [{ expenseId: 'exp-1', scopeKey: 'issuer:ร้านเอ', status: 'NEEDS_REVIEW', grandTotalAmount: '810.00', payerUserId: 'user-2' }],
  });
  const [row] = captureDerivedRows(detail, 'co-1');
  assert.equal(row!.label, 'ร้านเอ');
  assert.equal(row!.claimHref, '/companies/co-1/reimbursements/new?expenseId=exp-1');

  const waiting = captureDerivedRows(withAllocation(allocationResult(), {
    fundingRoute: 'EMPLOYEE',
    derivedSources: [{ expenseId: 'exp-1', scopeKey: 'issuer:ร้านเอ', status: 'NEEDS_REVIEW', grandTotalAmount: '810.00', payerUserId: 'user-2' }],
  }), 'co-1');
  assert.equal(waiting[0]!.claimHref, null, 'a source waiting for its tax review gets no claim link');
});

// ─── Dates (A42) ──────────────────────────────────────────────────────────────

test('the expense date defaults to what the server resolved, never to today', () => {
  assert.equal(captureDateOption(scope({ expenseDateSource: 'document' })), 'document');
  assert.equal(captureDateOption(scope({ expenseDateSource: 'explicit' })), 'custom');
  assert.equal(captureDateOption(scope({ expenseDateSource: null })), 'payment');
  assert.equal(captureDateChoicePayload('document', null), 'document');
  assert.deepEqual(captureDateChoicePayload('custom', '2026-09-01'), { date: '2026-09-01' });
  assert.equal(captureDateChoicePayload('custom', ''), null, 'an empty custom date is not sent');
  assert.equal(captureDateChoicePayload('custom', 'วันนี้'), null);
});

test('the allocation snapshot is only read when the server actually sent one', () => {
  assert.equal(captureAllocation(group()), null);
  assert.equal(captureAllocation(group({
    allocation: { ...withAllocation(allocationResult()).allocation!, result: null },
  })), null);
  assert.equal(captureAllocation(withAllocation(allocationResult()))?.outcome, 'READY');
});

test('the whole expenses.capture namespace exists in both locales', () => {
  const missing = Object.keys(workspaceDictionary.th)
    .filter((key) => key.startsWith('expenses.capture.'))
    .filter((key) => !(key in workspaceDictionary.en));
  assert.deepEqual(missing, [], 'half the users would get a key name instead of a sentence');
});

test('every key this file can return exists in both locales', () => {
  const keys = [
    ...captureStateChips(group()).map((chip) => chip.key),
    ...captureStateChips(withAllocation(allocationResult())).map((chip) => chip.key),
    'expenses.capture.summary_documents', 'expenses.capture.summary_incomplete',
    'expenses.capture.recon_reconciled', 'expenses.capture.recon_mismatch', 'expenses.capture.recon_insufficient',
    'expenses.capture.payment_unpaid', 'expenses.capture.payment_paid', 'expenses.capture.unknown_value',
    'expenses.capture.role_shipping', 'expenses.capture.event_void', 'expenses.capture.claim_ready',
    'expenses.capture.claim_waiting_tax', 'expenses.capture.no_company_portion_result',
    'expenses.capture.accept_hint', 'expenses.capture.handoff', 'expenses.capture.handoff_done',
    'expenses.capture.handoff_unknown', 'expenses.capture.derived_certificate',
    'expenses.capture.after_handoff_note', 'expenses.capture.list_title', 'expenses.capture.from_group_badge',
  ] as const;
  for (const key of keys) {
    assert.ok(workspaceDictionary.th[key]?.trim().length, `${key} has no Thai`);
    assert.ok(workspaceDictionary.en[key]?.trim().length, `${key} has no English`);
  }
});
