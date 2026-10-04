import { REIMBURSEMENT_POLICY_TAB_LABEL, ATTACHMENT_SOURCE_TYPES_LABEL } from '@watchdog-bms/contracts';
import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { reimbursementHubBucket, type ReimbursementSourceOption, type ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import { ToastContext } from '@/common/components/toast/use-toast';

/*
 * Owner rule 2026-09-27/29 on the claim pages around the LINE draft page (that one has its own guard in
 * ReimbursementDraftActionPage.qa.spec.ts): the detail sections, the stale-approval dialog, the hub queues and
 * the create form read in plain Thai — no id, enum or category key, code, ISO date, currency code or 3+ decimals.
 */
(globalThis as typeof globalThis & { React: typeof React }).React = React;
// The pages reach the icon set through ExpensesUi; this runner has no SVG loader (as InventoryPages.spec.ts).
require.extensions['.svg'] = (module) => { module.exports = () => null; };
// Modal portals into document.body, which a server render has none of: render the dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const sections = require('./ReimbursementDetailSections') as typeof import('./ReimbursementDetailSections');
const { ReimbursementCreatePage } = require('./ReimbursementCreatePage') as typeof import('./ReimbursementCreatePage');
const { ReimbursementsHubPage, PolicySettings } = require('./ReimbursementsPages') as typeof import('./ReimbursementsPages');
const { ReimbursementSourceFacts } = require('./ReimbursementSourceFacts') as typeof import('./ReimbursementSourceFacts');
const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage') as typeof import('./ReimbursementJourneyPage');
const { approvalComparable, diffApprovalFields, draftSentBackNote, errorMessage, hubListKey, reimbursementListScope } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
const model = require('./reimbursements.model') as typeof import('./reimbursements.model');
const reactRuntime = require('react') as typeof React;

const h = React.createElement;
const noop = () => undefined;
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' };
const toast = { success: noop, warning: noop, error: noop };

/** Renders with some useState starting values swapped in, picked by the page's own initial value (as InventoryPages.spec.ts). */
function renderWithState(element: React.ReactElement, pick: (initial: any) => unknown): string {
  const realUseState = reactRuntime.useState;
  Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
    const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
    const picked = pick(typeof initial === 'function' ? (initial as () => unknown)() : initial);
    return [picked === undefined ? value : picked, set];
  });
  try { return renderToStaticMarkup(element); } finally { Reflect.set(reactRuntime, 'useState', realUseState); }
}

// Ids shaped like the real ones (cuid), so a leak into visible text cannot hide.
const ids = {
  request: 'cmg7x2k9p0001requestq8w3e5', requester: 'cmg7x2k9p0002userr4t6y8a1', approver: 'cmg7x2k9p0003useru1i3o5p7',
  expense: 'cmg7x2k9p0004expensep5a7s', attachment: 'cmg7x2k9p0005attachd9f1g3', category: 'cmg7x2k9p0006categoryh5j7',
  payment: 'cmg7x2k9p0007paymentk9l1z3', voided: 'cmg7x2k9p0008paymentb2n4m6', step: 'cmg7x2k9p0009stepx3c5v7b9',
  copy: 'cmg7x2k9p0010copyn1m3q5w7', note: 'cmg7x2k9p0011copyr8t0y2u4', certificate: 'cmg7x2k9p0012certe9r1t3y5',
  branch: 'cmg7x2k9p0013branchu7i9o1', line1: 'cmg7x2k9p0014lineq1w3e5r7', line2: 'cmg7x2k9p0015linet9y1u3i5', other: 'cmg7x2k9p0016expensea4s6d8',
};
/** Document numbers print on the documents themselves; customers quote them. */
const DOCUMENT_NUMBERS = ['RB-202609-00007', 'RBPAY-202609-00001', 'RBPAY-202609-00002', 'SRC-202609-00003', 'INV-0042'];

const bill: ReimbursementSourceSnapshot = {
  schemaVersion: 1, expenseId: ids.expense, expenseUpdatedAt: '2026-09-26T03:00:00.000Z', requesterUserId: ids.requester,
  expenseDate: '2026-09-26T00:00:00.000Z', paymentDate: null, paymentMethod: 'CASH', currency: 'THB',
  seller: { name: 'ร้านเครื่องเขียนสมใจ', taxId: '0105561234567', branchCode: '00000', documentNumber: 'INV-0042' },
  sourceDocumentType: 'TAX_INVOICE', vatMode: 'EXCLUSIVE', inputVatClaimStatus: 'CLAIMABLE', taxEvidenceStatus: 'COMPLETE',
  classification: { expenseCategoryId: ids.category, accountHintKey: 'office_supplies', taxCategory: null },
  totals: { subtotalAmount: '355.1400', discountAmount: '0.0000', taxableAmount: '355.1400', vatAmount: '24.8600', whtAmount: '0.0000',
    grandTotalAmount: '380.0000', netPayableAmount: '380.0000' },
  lines: [{ description: 'ปากกาและแฟ้ม', amount: '380.0000' }],
  attachments: [{ id: ids.attachment, fileName: 'ใบกำกับภาษี.pdf', checksumSha256: 'a'.repeat(64) }], certificate: null,
};
const substitute: ReimbursementSourceSnapshot = {
  ...bill, paymentDate: '2026-09-27T00:00:00.000Z', seller: { ...bill.seller, documentNumber: null },
  certificate: { id: ids.certificate, documentNumber: 'SRC-202609-00003', version: 2, fundingSource: 'PERSONAL_ADVANCE', payerUserId: ids.requester,
    payerName: 'พิม ใจดี', businessPurpose: 'ซื้อของใช้สำนักงาน', missingReceiptReason: 'ร้านไม่ออกใบเสร็จ', artifactChecksumSha256: null, wetSignedScanChecksumSha256: null },
};

// A LINE-made draft: its lines carry a category key but no label (#920), and amounts are the stored four places.
const taxi = { id: ids.line1, lineNo: 1, incurredDate: '2026-09-27T00:00:00.000Z', description: 'ค่าแท็กซี่', purpose: 'ไปพบลูกค้า',
  categoryKey: 'travel', categoryLabelSnapshot: null, amount: '1234.5000', attachmentId: ids.attachment };
const pens = { id: ids.line2, lineNo: 2, incurredDate: '2026-09-26T00:00:00.000Z', description: 'ปากกาและแฟ้ม', purpose: null,
  categoryKey: ids.category, categoryLabelSnapshot: '  ', amount: '380.0000', linkedExpenseId: ids.expense, sourceExpenseSnapshot: bill };
const draft = {
  id: ids.request, requestNo: undefined as string | undefined, status: 'DRAFT', paymentStatus: 'NOT_PAYABLE', financeReviewStatus: 'NOT_REQUIRED',
  receiptRequirementStatus: 'REQUIRED', duplicateStatus: 'NOT_CHECKED', requesterUserId: ids.requester, requesterDisplayNameSnapshot: 'พิม ใจดี',
  createdByName: 'พิม ใจดี', branchId: ids.branch, reason: 'ไปพบลูกค้า', amount: '1614.5000', outstandingAmount: '0.0000', currency: 'THB',
  categoryKey: 'travel', categoryLabelSnapshot: null as string | null, lines: [taxi, pens], lineCount: 2, currentDesk: { kind: 'REQUESTER' },
  signatures: [] as unknown[], signedCopies: [] as unknown[], approvalSteps: [] as unknown[], payments: [] as unknown[],
};
const paid = {
  ...draft, requestNo: 'RB-202609-00007', status: 'PAID', paymentStatus: 'PAID', financeReviewStatus: 'APPROVED_FOR_PAYMENT',
  financeReviewedByName: 'สมศรี การเงิน', financeReviewedAt: '2026-09-28T02:00:00.000Z', receiptRequirementStatus: 'ATTACHED', duplicateStatus: 'OVERRIDDEN',
  submittedAt: '2026-09-27T03:00:00.000Z', approvedAt: '2026-09-27T05:00:00.000Z', categoryLabelSnapshot: 'หลายหมวด (2 รายการ)', currentDesk: null,
  documentSignedVia: 'PAPER', claimFormLayout: 'TWO_SIGNERS',
  lines: [{ ...taxi, categoryLabelSnapshot: 'เดินทาง' }, { ...pens, sourceExpenseSnapshot: substitute }],
  approvalSteps: [{ id: ids.step, sequenceNo: 1, approverUserId: ids.approver, approverName: 'สมชาย', status: 'APPROVED', assignedAt: '2026-09-27T03:00:00.000Z',
    decidedAt: '2026-09-27T05:00:00.000Z', decisionByUserId: ids.approver, decidedByName: 'สมชาย', comment: 'ตรวจใบเสร็จแล้ว' }],
  payments: [
    { id: ids.voided, paymentNo: 'RBPAY-202609-00001', paidAmount: '1614.5000', currency: 'THB', paymentMethod: 'CHEQUE', paidAt: '2026-09-28T03:00:00.000Z',
      status: 'VOIDED', voidReason: 'บันทึกเลขอ้างอิงผิด', paidByName: 'สมชาย' },
    { id: ids.payment, paymentNo: 'RBPAY-202609-00002', paidAmount: '1614.5000', currency: 'THB', paymentMethod: 'BANK_TRANSFER', paidAt: '2026-09-29T03:00:00.000Z',
      status: 'RECORDED', paidByUserId: ids.approver, paidByName: 'สมชาย' },
  ],
  signatures: [{ role: 'REQUESTER', signedByName: 'พิม ใจดี', signedAt: '2026-09-29T04:00:00.000Z' }],
  signedCopies: [
    { attachmentId: ids.copy, fileName: 'ใบเบิกที่เซ็นแล้ว.pdf', uploadedAt: '2026-09-29T05:00:00.000Z', acknowledgedAt: '2026-09-29T05:00:00.000Z', acknowledgedByName: 'พิม ใจดี' },
    { attachmentId: ids.note, fileName: 'สำเนาเพิ่มเติม.jpg', uploadedAt: '2026-09-29T06:00:00.000Z' },
  ],
};
// Every enum the API may grow: the page must still say nothing machine-shaped.
const later = {
  ...paid, status: 'A_STATE_ADDED_LATER', paymentStatus: 'A_PAYMENT_STATE_ADDED_LATER', financeReviewStatus: 'A_REVIEW_ADDED_LATER',
  receiptRequirementStatus: 'A_RECEIPT_RULE_ADDED_LATER', duplicateStatus: 'A_DUPLICATE_STATE_ADDED_LATER', categoryLabelSnapshot: undefined,
  approvalSteps: [{ ...paid.approvalSteps[0]!, status: 'A_STEP_STATE_ADDED_LATER' }],
  payments: [{ ...paid.payments[1]!, paymentMethod: 'A_METHOD_ADDED_LATER', status: 'A_PAYMENT_STATE_ADDED_LATER' }],
};

const detailSections = (detail: object, userId: string, permissions: string[]) => renderToStaticMarkup(h(React.Fragment, null,
  h(sections.ClaimSummaryCard, { detail }),
  h(sections.ClaimDetailSections, { detail, userId, permissions, busy: false, onOpenAttachment: noop, onLineReceipt: noop, onSign: noop,
    onUploadSignedCopy: noop, onRequestVoidPayment: noop, onOpenPaymentSlip: noop, onAttachPaymentSlip: noop, onUseSignedCopyAsSlip: noop })));

function staleDialog(row: any, detail: any): string {
  const diff = diffApprovalFields(approvalComparable(row, row.lineCount ?? 1), approvalComparable(detail, detail.lines.length));
  Object.assign(globalThis, { document: { body: {} } }); // Modal's portal target; never touched by a server render
  try {
    return renderToStaticMarkup(h(sections.StaleApprovalDialog, { requestNo: detail.requestNo, diff, lines: detail.lines, currency: detail.currency,
      busy: false, error: null, onClose: noop, onConfirm: noop }));
  } finally { Reflect.deleteProperty(globalThis, 'document'); }
}

const createPage = (props: object = {}) => h(AppRouterContext.Provider, { value: router },
  h(ReimbursementCreatePage, { companyId: 'company-1', userId: ids.requester, canCreate: true, canPrepareForOthers: true, ...props }));
const sourceOption = (overrides: Partial<ReimbursementSourceOption> = {}): ReimbursementSourceOption => ({
  expenseId: ids.expense, label: 'INV-0042 · ร้านเครื่องเขียนสมใจ', eligible: true, updatedAt: bill.expenseUpdatedAt, incurredDate: '2026-09-26',
  description: 'ปากกาและแฟ้ม', purpose: '', categoryKey: ids.category, amount: '380', currency: 'THB', snapshot: bill, ...overrides,
});
const filledForm = {
  reason: 'ไปพบลูกค้า', currency: 'THB', missingReceiptReason: '',
  lines: [
    // Picked from a bill whose expense category arrived without a name: its key is an id.
    { incurredDate: '2026-09-26', description: 'ปากกาและแฟ้ม', purpose: '', categoryKey: ids.category, amount: '380', file: null, attachmentId: null,
      linkedExpenseId: ids.expense, sourceExpenseUpdatedAt: bill.expenseUpdatedAt, sourceExpenseSnapshot: substitute },
    // Typed by hand, one decimal place too many.
    { incurredDate: '2026-09-27', description: 'ค่าแท็กซี่', purpose: 'ไปพบลูกค้า', categoryKey: 'travel', amount: '1234.565', file: null,
      attachmentId: ids.attachment, attachmentFileName: 'ใบเสร็จแท็กซี่.jpg', linkedExpenseId: null },
  ],
};
// Rows bound to bills that can no longer be claimed: the closed picker shows the bound option, reason included.
const refusedForm = { ...filledForm, lines: [ids.other, ids.note].map(expenseId => ({ ...filledForm.lines[0]!, linkedExpenseId: expenseId,
  sourceExpenseSnapshot: undefined, categoryKey: 'other' })) };
const filledCreatePage = (form: object = filledForm) => renderWithState(createPage(), (initial) => {
  if (Array.isArray(initial?.lines)) return form;
  if (Array.isArray(initial?.items)) {
    return { requesters: [{ userId: ids.requester, displayName: 'พิม ใจดี' }, { userId: ids.approver, displayName: 'สมชาย' }],
      items: [sourceOption(), sourceOption({ expenseId: ids.other, label: 'ร้านกาแฟ', amount: '95.5', eligible: false, reason: 'expense_already_claimed' }),
        sourceOption({ expenseId: ids.note, label: 'ร้านอาหาร', amount: '120.25', eligible: false, reason: 'a_reason_added_later' })] };
  }
  // The one {} the page starts from is its collapsed-row map: fold both rows to their summaries.
  if (initial && typeof initial === 'object' && !Array.isArray(initial) && Object.keys(initial).length === 0) return { 0: true, 1: true };
  return undefined;
});

const queueRow = { ...draft, requestNo: 'RB-202609-00007', status: 'FINANCE_REVIEW', paymentStatus: 'UNPAID', financeReviewStatus: 'A_REVIEW_ADDED_LATER',
  outstandingAmount: '1614.5000', ageHours: 26, slaRisk: true, hasDuplicateBlocker: true, incurredDate: '2026-09-26T00:00:00.000Z',
  currentDesk: { kind: 'APPROVER', names: ['สมชาย', 'สมศรี การเงิน'] } };
const hubPermissions = ['reimbursement.read', 'reimbursement.create', 'reimbursement.submit', 'reimbursement.approve', 'reimbursement.finance_review',
  'reimbursement.payment.record'];
/**
 * What the list API answers for one hub list: the claims of the open filter, and the whole scope counted. The API
 * places a claim with `reimbursementHubBucket` for the counts and the filter alike (its own spec walks every page of
 * every bucket), so this fake uses the same rule and nothing of the page's.
 */
function served(claims: any[], filter?: string) {
  const counts = { all: claims.length, draft: 0, review: 0, payment: 0, paid: 0, closed: 0 };
  for (const claim of claims) counts[reimbursementHubBucket(claim)] += 1;
  const rows = filter ? claims.filter((claim) => reimbursementHubBucket(claim) === filter) : claims;
  return { rows, total: rows.length, summary: { counts, totalAmount: String(claims.reduce((sum, claim) => sum + Number(claim.amount), 0)),
    blockedDraftCount: claims.filter((claim) => claim.status === 'DRAFT' && claim.receiptRequirementStatus === 'REQUIRED').length } };
}
/**
 * One hub tab, its queue loaded with the rows (each queue starts as an empty list, loading); `filter` = a card or chip already tapped.
 * The hub's own list is held a page at a time: `held` overrides what it holds (pages still to come, a page that failed).
 * `search` = a search already typed and asked for: the rows are then what the API found, and so are the counts.
 * `financeStep`: whether the company has the finance-review step, as the page was told it; 'unread' = not told yet.
 * `mayReadPolicy`: the viewer holds a policy right and is told by the policy itself. Without one (`hubPermissions` has
 * none) the claims list answer tells them. Left out, both: a viewer with no policy right, told that the company has the step.
 */
const hubTab = (tab: string, rows: object[] = [queueRow], filter?: string, held: object = {}, search = '', financeStep?: boolean | 'unread',
  mayReadPolicy = financeStep !== undefined, told: boolean | 'unread' = financeStep ?? true) => renderWithState(
  h(AppRouterContext.Provider, { value: router }, h(SearchParamsContext.Provider, { value: new URLSearchParams(`tab=${tab}`) },
    h(ToastContext.Provider, { value: toast },
      h(ReimbursementsHubPage, { companyId: 'company-1', userId: ids.requester, roles: ['OWNER'],
        permissions: mayReadPolicy ? [...hubPermissions, 'reimbursement.policy.read'] : hubPermissions })))),
  (initial) => (initial && typeof initial === 'object' && 'financeStep' in initial ? (typeof told === 'boolean' ? { companyId: 'company-1', financeStep: told } : undefined)
    : Array.isArray(initial) && initial.length === 0 ? rows
      : Array.isArray(initial?.rows) ? { key: hubListKey('company-1', reimbursementListScope(hubPermissions), filter ?? 'all', 0, 0, search), nextPage: null, ...served(rows, filter), ...held }
        : initial === true ? false : initial === 'all' ? filter : initial === '' ? search : undefined),
);
// One claim per state the hub has to place: the desk is what the list API answers, and finished claims have none.
const hubClaims = ([
  ['DRAFT', 'REQUESTER'], ['PENDING_APPROVAL', 'APPROVER'], ['READY_FOR_PAYMENT', 'PAYMENT'], ['READY_FOR_PAYMENT', 'PAYMENT'],
  ['PAID', null], ['REJECTED', null], ['CANCELLED', null],
] as const).map(([status, kind], index) => ({ ...draft, id: `${ids.request}${index}`, requestNo: kind === 'REQUESTER' ? undefined : 'RB-202609-00007',
  status, amount: '100.0000', currentDesk: kind && { kind } }));

// The same claim sent back from the pay step for its payout account, as the list API answers it in each phase:
// PENDING_APPROVAL, first with its requester, then with the approvers its new account waits for. It was sent back
// holding an account and answered with another account; the answer is on a waiting row only.
const correctionRows = ([['AWAITING_REQUESTER', { kind: 'REQUESTER' }, {}], ['AWAITING_APPROVAL', { kind: 'APPROVER', names: ['สมชาย'] }, { payoutCorrectionAnswer: 'NEW_ACCOUNT' }]] as const)
  .map(([payoutCorrectionPhase, currentDesk, answered], index) => ({ ...draft, id: `${ids.request}round${index}`, requestNo: 'RB-202609-00007', status: 'PENDING_APPROVAL',
    receiptRequirementStatus: 'ATTACHED', payoutMethod: 'BANK_TRANSFER', amount: '100.0000', payoutCorrectionPhase, currentDesk, ...answered }));

/** The source of every claim screen, as one text. A comment is not a screen, so comments are left out. */
function claimScreenSources(): string {
  const source = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return readdirSync(__dirname).filter((name) => /\.tsx?$/.test(name) && !name.includes('.spec.')).map((name) => source(join(__dirname, name))).join('\n');
}

/** What the customer reads: text nodes plus aria labels, placeholders and tooltips; never other attributes such as links. */
const visible = (html: string) => [...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/gu)].map(match => match[1]!),
  ...html.replace(/<[^>]*>/gu, '\n').split('\n')]
  .map(text => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

describe('claim pages speak plain Thai (Owner rule 2026-09-27/29)', () => {
  it('names a category by its label or says none was chosen, never by its key (detail, dialog, queue, form)', () => {
    const texts = visible(detailSections(draft, ids.requester, ['reimbursement.update_own_draft']));
    assert.equal(texts.filter(text => text === 'ยังไม่ได้เลือกหมวด').length, 3, 'claim header and both lines');
    assert.ok(visible(hubTab('mine')).includes('ยังไม่ได้เลือกหมวด'));
    assert.ok(visible(filledCreatePage()).includes('ยังไม่ได้เลือกหมวด'), 'the category picker of a row whose key is an id');
    // Before: the queue row had no label; now: the claim's own label, and a blank line label reads as none chosen.
    const dialog = visible(staleDialog({ ...draft, status: 'PENDING_APPROVAL', amount: '1234.5000', lineCount: 1 }, { ...paid, status: 'PENDING_APPROVAL' }));
    for (const text of ['ยังไม่ได้เลือกหมวด', 'หลายหมวด (2 รายการ)', 'เดินทาง']) assert.ok(dialog.includes(text), text);
  });

  it('shows amounts as "1,234.50 บาท" and dates in Thai with the Buddhist year', () => {
    const facts = visible(renderToStaticMarkup(h(ReimbursementSourceFacts, { source: bill })));
    for (const text of ['380.00 บาท', '24.86 บาท / 0.00 บาท', '26 ก.ย. 2569', 'ไม่ได้ระบุ']) assert.ok(facts.includes(text), text);
    const form = visible(filledCreatePage());
    for (const text of ['26 ก.ย. 2569 · ปากกาและแฟ้ม · 380.00 บาท', '27 ก.ย. 2569 · ค่าแท็กซี่ · 1,234.57 บาท', 'INV-0042 · ร้านเครื่องเขียนสมใจ · 380.00 บาท',
      '1,614.57 บาท', 'บาท']) assert.ok(form.includes(text), text);
    assert.ok(visible(renderToStaticMarkup(createPage())).includes('0.00 บาท'));
    assert.ok(visible(filledCreatePage(refusedForm)).includes('ร้านกาแฟ · 95.50 บาท — ค่าใช้จ่ายนี้ถูกใช้เบิกในคำขออื่นอยู่แล้ว'));
    const diff = diffApprovalFields(approvalComparable({ ...draft, amount: '1234.5000', lineCount: 1 }, 1), approvalComparable(paid, 2));
    assert.deepEqual(diff.find(row => row.key === 'amount'), { key: 'amount', label: 'จำนวนเงิน', before: '1,234.50 บาท', after: '1,614.50 บาท', changed: true });
    assert.deepEqual(diff.find(row => row.key === 'currency'), { key: 'currency', label: 'สกุลเงิน', before: 'บาท', after: 'บาท', changed: false });
  });
});

describe('the claim lines fit a 390 px phone (Owner, 2026-09-30)', () => {
  it('shows each line as a card below xl, with the same receipt upload, and keeps the table from xl up', () => {
    const html = detailSections(draft, ids.requester, ['reimbursement.update_own_draft']);
    // Before: only the seven-column table, which squeezed Thai text to one letter per row on a phone.
    assert.match(html, /<div class="[^"]*\bxl:hidden\b[^"]*" data-testid="reimbursement-line-cards">/u);
    assert.match(html, /<div class="relative hidden overflow-x-auto break-normal xl:block" data-testid="reimbursement-lines-table"><table class="mangmee-table">/u);
    const cardsAt = html.indexOf('data-testid="reimbursement-line-cards"'), tableAt = html.indexOf('data-testid="reimbursement-lines-table"');
    // Not inside mangmee-table-scroll: its max-content cut the amount and receipt columns off a desktop card (2026-10-01).
    assert.doesNotMatch(html.slice(html.lastIndexOf('<section', tableAt), tableAt), /mangmee-table-scroll/u);
    const cards = html.slice(cardsAt, tableAt), table = html.slice(tableAt);
    const cardTexts = visible(cards);
    for (const text of ['ค่าแท็กซี่', '1,234.50 บาท', '27 ก.ย. 2569 · ยังไม่ได้เลือกหมวด', 'วัตถุประสงค์: ไปพบลูกค้า',
      'ปากกาและแฟ้ม', '380.00 บาท', '26 ก.ย. 2569 · ยังไม่ได้เลือกหมวด', 'ร้านเครื่องเขียนสมใจ', 'รวมเป็นเงิน', '1,614.50 บาท',
      ATTACHMENT_SOURCE_TYPES_LABEL, 'นำไฟล์ออก']) assert.ok(cardTexts.includes(text), text);
    // The typed line takes a receipt upload; the line picked from a saved bill keeps that bill's files instead.
    assert.equal(cards.match(/type="file"/gu)?.length, 1);
    assert.equal(table.match(/type="file"/gu)?.length, 1);
    assert.ok(visible(table).includes('ใบเสร็จ'), 'the table keeps its receipt column');
    assert.ok(visible(detailSections(paid, ids.requester, [])).includes('27 ก.ย. 2569 · เดินทาง'), 'a card names the line category by its label');
  });
});

describe('the hub cards and chips count what their filter shows (spec §18.1, AC38)', () => {
  /** The markup inside the element marked `from`, up to the tag that carries `to`. */
  const between = (html: string, from: string, to: string) => html.slice(html.indexOf('>', html.indexOf(from)) + 1, html.lastIndexOf('<', html.indexOf(to)));
  const cardsOf = (html: string) => between(html, 'data-testid="reimbursements-mine-summary"', 'data-testid="reimbursements-mine-filters"');
  const chipsOf = (html: string) => between(html, 'data-testid="reimbursements-mine-filters"', 'type="search"');
  /** Label → the number on it, one entry per card (the number comes first) or per chip (the number comes last). */
  const numbers = (html: string, numberFirst: boolean) => Object.fromEntries([...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gsu)].map(([, inner]) => {
    const texts = visible(inner!);
    return numberFirst ? [texts.slice(1).join(''), texts[0]!] : [texts.slice(0, -1).join(''), texts.at(-1)!];
  }));
  const rowsShown = (html: string) => html.match(/data-testid="reimbursements-mine-card"/gu)?.length ?? 0;

  it('splits claims waiting for payment from those waiting for approval, and every number is its list', () => {
    const html = hubTab('mine', hubClaims);
    // Before: คำขอทั้งหมด 7 and รออนุมัติ/ตรวจสอบ 3 (the two approved claims counted as waiting for approval).
    assert.deepEqual(numbers(cardsOf(html), true),
      { 'ร่างรอส่ง': '1', 'รออนุมัติ/ตรวจสอบ': '1', 'รอจ่ายเงินคืน': '2', 'ยอดรวมที่ขอเบิก': '700.00 บาท' });
    const chips = numbers(chipsOf(html), false);
    assert.deepEqual(chips, { 'ทั้งหมด': '7', 'ร่าง': '1', 'รออนุมัติ/ตรวจสอบ': '1', 'รอจ่าย': '2', 'จ่ายแล้ว': '1', 'ปฏิเสธ/ยกเลิก': '2' });
    assert.equal(rowsShown(html), 7);
    // Tapping a card or its chip shows exactly the claims it counted.
    for (const [filter, card, chip] of [['draft', 'ร่างรอส่ง', 'ร่าง'], ['review', 'รออนุมัติ/ตรวจสอบ', 'รออนุมัติ/ตรวจสอบ'],
      ['payment', 'รอจ่ายเงินคืน', 'รอจ่าย'], ['paid', null, 'จ่ายแล้ว'], ['closed', null, 'ปฏิเสธ/ยกเลิก']] as const) {
      const filtered = hubTab('mine', hubClaims, filter);
      assert.equal(String(rowsShown(filtered)), chips[chip], filter);
      if (card) assert.equal(numbers(cardsOf(filtered), true)[card], chips[chip], filter);
      assert.ok(visible(filtered).includes(`พบ ${chips[chip]} จาก 7 รายการ`), filter);
    }
    assert.equal(Object.entries(chips).reduce((sum, [label, count]) => sum + (label === 'ทั้งหมด' ? 0 : Number(count)), 0), 7);
  });

  // Payout spec §14.2: a claim sent back for its payout account is PENDING_APPROVAL and, while its requester gives the
  // account, with its requester. The server counts it under รออนุมัติ/ตรวจสอบ; its row must not read as a draft, or as
  // waiting for an approver nobody waits for.
  it('shows a claim in a payout account correction round where the server counts it, with its phase and whom it waits for', () => {
    const claims = [...hubClaims, ...correctionRows];
    const html = hubTab('mine', claims);
    assert.deepEqual(numbers(cardsOf(html), true), { 'ร่างรอส่ง': '1', 'รออนุมัติ/ตรวจสอบ': '3', 'รอจ่ายเงินคืน': '2', 'ยอดรวมที่ขอเบิก': '900.00 บาท' });
    assert.deepEqual([numbers(chipsOf(html), false)['ร่าง'], numbers(chipsOf(html), false)['รออนุมัติ/ตรวจสอบ']], ['1', '3']);
    const review = hubTab('mine', claims, 'review');
    assert.equal(rowsShown(review), 3);
    const texts = visible(review);
    // The badge of each row, in the table and on its phone card: the phase, never the bare status of a claim in a round.
    for (const label of ['รอผู้เบิกแก้บัญชีรับเงิน', 'รออนุมัติบัญชีรับเงินใหม่']) assert.equal(texts.filter((text) => text === label).length, 2, label);
    assert.equal(texts.filter((text) => text === 'รออนุมัติ').length, 2, 'the one claim that waits for its first approval');
    // "อยู่ที่" on the phone cards: the requester in the badge's own word, then the approvers by name.
    assert.deepEqual(texts.filter((text) => text.startsWith('อยู่ที่')), ['อยู่ที่ ผู้มีสิทธิ์อนุมัติ', 'อยู่ที่ ผู้เบิก', 'อยู่ที่ สมชาย']);
    // With its requester, and still no draft: nothing on the row sends it, and it is not among the drafts.
    assert.equal(texts.some((text) => text === 'ส่งอนุมัติ' || text === 'ตรวจบัญชีและส่งอนุมัติ' || text === 'เลือกวิธีรับเงินคืนและส่งอนุมัติ'), false);
    assert.equal(rowsShown(hubTab('mine', claims, 'draft')), 1);
    assert.equal(visible(hubTab('mine', claims, 'draft')).includes('รอผู้เบิกแก้บัญชีรับเงิน'), false);
  });

  // Before: every row of a round read one of two labels, written for a wrong account replaced by another one. A claim
  // sent back with no account, or one that asked for cash, read "รอผู้เบิกแก้บัญชีรับเงิน"; an account that was kept, a
  // first account, or cash read "รออนุมัติบัญชีรับเงินใหม่".
  it('says on each row of a round what that claim waits for: by what it holds, then by what was answered', () => {
    const cases = [
      [undefined, undefined, 'รอผู้เบิกเพิ่มบัญชีรับเงิน'], ['CASH', undefined, 'รอผู้เบิกเลือกวิธีรับเงินคืน'],
      ['BANK_TRANSFER', 'SAME_ACCOUNT', 'รออนุมัติบัญชีรับเงินเดิม'], ['BANK_TRANSFER', 'FIRST_ACCOUNT', 'รออนุมัติบัญชีรับเงิน'], ['CASH', 'CASH_INSTEAD', 'รออนุมัติการรับเป็นเงินสด'],
    ] as const;
    const rows = cases.map(([payoutMethod, payoutCorrectionAnswer], index) => ({ ...correctionRows[payoutCorrectionAnswer ? 1 : 0]!, id: `${ids.request}case${index}`, payoutMethod, payoutCorrectionAnswer }));
    const texts = visible(hubTab('mine', rows, 'review'));
    assert.equal(rowsShown(hubTab('mine', rows, 'review')), cases.length);
    // In the table and on the phone card of each row.
    for (const [, , label] of cases) assert.equal(texts.filter((text) => text === label).length, 2, label);
    for (const untrue of ['รอผู้เบิกแก้บัญชีรับเงิน', 'รออนุมัติบัญชีรับเงินใหม่', 'รออนุมัติ']) assert.equal(texts.includes(untrue), false, untrue);
    for (const text of texts) for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(text.replaceAll('RB-202609-00007', ''), pattern, `${name}: ${text}`);
  });

  it('keeps the four cards two by two on a 390 px phone, each one a button that filters', () => {
    const cards = cardsOf(hubTab('mine', hubClaims, 'payment'));
    assert.ok(hubTab('mine', hubClaims).includes('<div class="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="reimbursements-mine-summary">'));
    const buttons = [...cards.matchAll(/<button type="button" aria-pressed="(true|false)" class="([^"]*)"/gu)];
    assert.deepEqual(buttons.map(([, pressed]) => pressed), ['false', 'false', 'true', 'false'], 'รอจ่ายเงินคืน is the open filter');
    // Nothing with a fixed width: a card is as wide as its grid column and its text wraps inside it.
    for (const [, , className] of buttons) assert.match(className!, /^h-full w-full min-w-0 rounded-2xl text-left/u);
    assert.doesNotMatch(cards, /\b(?:min-)?w-\[|whitespace-nowrap/u);
    // The chips: two columns on a phone, three from sm, and no chip that refuses to wrap.
    const html = hubTab('mine', hubClaims);
    assert.ok(html.includes('<div class="grid w-full grid-cols-2 gap-2 sm:grid-cols-3" data-testid="reimbursements-mine-filters">'));
    const chipClasses = [...chipsOf(html).matchAll(/<button type="button" aria-pressed="(?:true|false)" class="([^"]*)"/gu)].map(([, className]) => className!);
    assert.equal(chipClasses.length, 6);
    for (const className of chipClasses) assert.doesNotMatch(className, /\b(?:min-)?w-\[|whitespace-nowrap/u);
    // A label wider than a 390 px chip (measured in a browser: 143 px needed, 132 there) breaks at its slash, never inside a Thai word.
    assert.ok(chipsOf(html).includes('<span class="min-w-0"><span class="whitespace-nowrap">รออนุมัติ/</span><span class="whitespace-nowrap">ตรวจสอบ</span></span>'));
  });
});

describe('the hub takes its list lazily and says when a page did not load (review follow-up 2026-10-01)', () => {
  const rowsShown = (html: string) => html.match(/data-testid="reimbursements-mine-card"/gu)?.length ?? 0;
  const cardNumbers = (html: string) => [...html.slice(html.indexOf('data-testid="reimbursements-mine-summary"'), html.indexOf('data-testid="reimbursements-mine-filters"'))
    .matchAll(/<button\b[^>]*>(.*?)<\/button>/gsu)].map(([, inner]) => visible(inner!)[0]);
  const reason = 'เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่อีกครั้ง';
  // A shop with 230 claims waiting for payment: the first answer carries 100 rows and the counts of all 230.
  const many = Array.from({ length: 100 }, (_, index) => ({ ...draft, id: `${ids.request}${index}`, requestNo: 'RB-202609-00007', status: 'READY_FOR_PAYMENT',
    amount: '100.0000', currentDesk: { kind: 'PAYMENT' } }));
  const of230 = { total: 230, nextPage: 2, summary: { counts: { all: 230, draft: 0, review: 0, payment: 230, paid: 0, closed: 0 }, totalAmount: '23000.0000', blockedDraftCount: 0 } };

  it('shows the cards and chips of the whole scope from the first page, with only that page of rows held', () => {
    // Before: the hub walked every page before it showed anything, and counted the rows it had loaded.
    const html = hubTab('mine', many, undefined, of230);
    const texts = visible(html);
    assert.deepEqual(cardNumbers(html), ['0', '0', '230', '23,000.00 บาท']);
    assert.ok(texts.includes('ทั้งหมด 230 รายการ'));
    // Ten rows a table page, out of the server's 230: the pager counts the whole list, not the rows held.
    assert.equal(rowsShown(html), 10);
    assert.ok(texts.includes('แสดง 1-10 จาก 230 รายการ'), texts.filter((text) => text.includes('แสดง')).join(' | '));
    assert.ok(texts.includes('1 / 23'));
    // Under the รอจ่าย filter the list is the server's 230, the number on its card and its chip.
    const filtered = visible(hubTab('mine', many, 'payment', of230));
    assert.ok(filtered.includes('พบ 230 จาก 230 รายการ'));
    assert.ok(filtered.includes('แสดง 1-10 จาก 230 รายการ'));
  });

  it('keeps the counts on the cards while another filter\'s rows are on their way, and shows none of the rows held before', () => {
    // First load: nothing to count yet.
    const first = visible(hubTab('mine', [], undefined, { summary: null, nextPage: 1 }));
    assert.ok(first.includes('กำลังโหลด...'));
    assert.equal(first.includes('ร่างรอส่ง'), false);
    // A filter was tapped and its first page has not arrived: the cards stay, the old rows do not.
    const switching = hubTab('mine', hubClaims, undefined, { key: 'the list held before the tap' });
    assert.equal(rowsShown(switching), 0);
    assert.deepEqual(cardNumbers(switching), ['1', '1', '2', '700.00 บาท']);
    const texts = visible(switching);
    assert.ok(texts.includes('กำลังโหลด...') && texts.includes('กำลังโหลดรายการ...'));
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีคำขอเบิก|ไม่พบรายการ/u);
  });

  it('shows the failure with a retry instead of "ยังไม่มีคำขอเบิก" when the first page fails', () => {
    // Before: the error banner sat above an empty state that told the person they had no claims.
    const texts = visible(hubTab('mine', [], undefined, { summary: null, nextPage: 1, failed: reason }));
    assert.ok(texts.includes(`⚠ โหลดรายการไม่สำเร็จ · ${reason}`), texts.join(' | '));
    assert.ok(texts.includes('ลองอีกครั้ง'));
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีคำขอเบิก|ทั้งหมด 0 รายการ|กำลังโหลด/u);
    // A scope that really is empty still says so, with no failure in sight.
    const empty = visible(hubTab('mine', []));
    assert.ok(empty.includes('ยังไม่มีคำขอเบิก') && empty.includes('ทั้งหมด 0 รายการ'));
    assert.equal(empty.includes('ลองอีกครั้ง'), false);
    // A filter with no claim in it is not an empty scope.
    const none = visible(hubTab('mine', hubClaims.filter((claim) => claim.status !== 'PAID'), 'paid'));
    assert.ok(none.includes('ไม่พบรายการที่ตรงกับตัวกรอง') && none.includes('พบ 0 จาก 6 รายการ'));
    assert.equal(none.includes('ยังไม่มีคำขอเบิก'), false);
  });

  it('keeps the rows already loaded when a later page fails, and the cards still count the whole scope', () => {
    // Before: one failed page threw the whole load away.
    const html = hubTab('mine', many, undefined, { ...of230, failed: reason });
    const texts = visible(html);
    assert.ok(texts.includes(`⚠ โหลดรายการได้ไม่ครบ รายการด้านล่างยังไม่ใช่ทั้งหมด · ${reason}`), texts.join(' | '));
    assert.ok(texts.includes('ลองอีกครั้ง'));
    assert.equal(rowsShown(html), 10);
    assert.deepEqual(cardNumbers(html), ['0', '0', '230', '23,000.00 บาท']);
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีคำขอเบิก/u);
    // The retry is a full-width button on a phone.
    assert.match(html, /data-testid="reimbursements-mine-load-failed">.*?<button type="button" class="[^"]*\bmin-h-11 w-full sm:w-auto\b[^"]*">ลองอีกครั้ง<\/button>/su);
  });
});

// Review 2026-10-01: the hub searched in the browser and counted the whole scope beside what the search showed. The
// search now goes to the API, whose counts are of what it found, so a card still shows the rows its filter returns.
describe('the hub search is asked of the API, and the cards count what it found (spec §25.1 I1 with a search)', () => {
  const rowsShown = (html: string) => html.match(/data-testid="reimbursements-mine-card"/gu)?.length ?? 0;
  const chipNumbers = (html: string) => [...html.slice(html.indexOf('data-testid="reimbursements-mine-filters"'), html.indexOf('type="search"'))
    .matchAll(/<button\b[^>]*>(.*?)<\/button>/gsu)].map(([, inner]) => visible(inner!).at(-1));
  const cardNumbers = (html: string) => [...html.slice(html.indexOf('data-testid="reimbursements-mine-summary"'), html.indexOf('data-testid="reimbursements-mine-filters"'))
    .matchAll(/<button\b[^>]*>(.*?)<\/button>/gsu)].map(([, inner]) => visible(inner!)[0]);
  // What the API answers for the search "แท็กซี่" in the shop of seven claims: three of them, one waiting for payment.
  const found = [hubClaims[0]!, hubClaims[2]!, hubClaims[4]!];

  it('shows the found claims with the cards, chips and line counting them, and each filter shows the rows its number says', () => {
    const html = hubTab('mine', found, undefined, {}, 'แท็กซี่');
    // Before: the cards kept the whole shop's 1, 1, 2 and 700 baht beside three rows, and the chip ทั้งหมด said 7.
    assert.deepEqual(cardNumbers(html), ['1', '0', '1', '300.00 บาท']);
    assert.deepEqual(chipNumbers(html), ['3', '1', '0', '1', '1', '0']);
    assert.equal(rowsShown(html), 3);
    const texts = visible(html);
    assert.ok(texts.includes('พบ 3 รายการที่ตรงกับคำค้น · ตัวเลขบนการ์ดและตัวกรองนับเฉพาะรายการที่ตรงกับคำค้น'), texts.filter((text) => text.includes('พบ')).join(' | '));
    assert.match(html, /<input [^>]*type="search"[^>]*value="แท็กซี่"/u);
    // A card or chip tapped while searching: its number is its rows.
    for (const [filter, rows] of [['payment', 1], ['draft', 1], ['review', 0]] as const) {
      const filtered = hubTab('mine', found, filter, {}, 'แท็กซี่');
      assert.equal(rowsShown(filtered), rows, filter);
      assert.ok(visible(filtered).includes(`พบ ${rows} จาก 3 รายการที่ตรงกับคำค้น · ตัวเลขบนการ์ดและตัวกรองนับเฉพาะรายการที่ตรงกับคำค้น`), filter);
    }
  });

  it('says a search found nothing, never that the shop has no claims', () => {
    // Before (with the counts of the search): "ยังไม่มีคำขอเบิก" and a prompt to create the first claim.
    const texts = visible(hubTab('mine', [], undefined, {}, 'ไม่มีใบไหนตรง'));
    assert.ok(texts.includes('ไม่พบรายการที่ตรงกับตัวกรอง') && texts.includes('ลองล้างคำค้นหรือเลือกสถานะอื่น'), texts.join(' | '));
    assert.ok(texts.includes('พบ 0 รายการที่ตรงกับคำค้น · ตัวเลขบนการ์ดและตัวกรองนับเฉพาะรายการที่ตรงกับคำค้น'));
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีคำขอเบิก|สร้างคำขอแรก/u);
    // A shop that really has none still says so when nothing is searched.
    assert.ok(visible(hubTab('mine', [])).includes('ยังไม่มีคำขอเบิก'));
  });

  it('names what the search box finds, in plain Thai', () => {
    const html = hubTab('mine', hubClaims);
    // Every column the API searches, and short enough to read whole in the field of a 390 px phone (measured with the
    // app's fonts at the field's 16 px: 254 px of 266; the wordings before the requester was "ผู้เบิก" here needed 248, 291 and 365).
    assert.match(html, /placeholder="ค้นหาเลขที่ ผู้เบิก เหตุผล หมวด ยอดเงิน"/u);
    // Before: "ค้นหาทุกข้อมูลในตาราง เช่น … สถานะ". The status is what the chips filter, and the API does not search it.
    assert.doesNotMatch(html, /ค้นหาทุกข้อมูลในตาราง/u);
  });
});

// The three lists were tables forced to 980 px from 768 px up. A 1280 px screen leaves their card 901 px (the side menu takes
// the rest), so the table scrolled sideways inside its card and hid its action column; at 1024 and 768 px by more.
describe('a hub list is a table only where its card is wide enough for it, and cards below (owner 2026-10-02)', () => {
  const lists = [['mine', '80rem'], ['approvals', '70rem'], ['finance', '58rem']] as const;
  const html = (tab: string) => hubTab(tab, [{ ...queueRow, status: 'PENDING_APPROVAL', reason: 'ค่าเดินทางไปพบลูกค้า', approvalActions: { canApprove: true, canReject: true } }]);

  it('switches by the width of the card that holds it, never by the screen, and forces no width on the table', () => {
    for (const [tab, width] of lists) {
      const page = html(tab);
      // The table and its cards sit in one box that is their container; each names the width the table needs.
      assert.match(page, new RegExp(`<div class="\\[container-type:inline-size\\]"><div class="hidden @\\[${width}\\]:block" data-testid="reimbursements-${tab}-table">`, 'u'), tab);
      assert.match(page, new RegExp(`<div class="mt-3 grid grid-cols-1 gap-3 @\\[44rem\\]:grid-cols-2 @\\[${width}\\]:hidden" data-testid="reimbursements-${tab}-card-list">`, 'u'), tab);
      const table = page.slice(page.indexOf(`data-testid="reimbursements-${tab}-table"`), page.indexOf(`data-testid="reimbursements-${tab}-card-list"`));
      // Only free text wraps; no forced width and no max-content scroller around it.
      assert.match(table, /<div class="mt-3 overflow-x-auto"><table class="mangmee-table \[&amp;_td\]:whitespace-nowrap \[&amp;_th\]:whitespace-nowrap">/u, tab);
      assert.doesNotMatch(table, /min-w-\[980px\]|mangmee-table-scroll|md:block/u, tab);
    }
  });

  // Seen on a 390 px screen (2026-10-02): the requester's list held a claim with a long reason. Its card keeps the
  // reason on one line, and the list's one column was unnamed, so the column took the width of that line: every card
  // of the list was 483 px wide on a 390 px screen, with the date, the amount and the end of its button past the edge.
  it('keeps a card as wide as its list and no wider: the one column of a phone is named', () => {
    for (const [tab] of lists) {
      const list = html(tab).match(new RegExp(`<div class="([^"]*)" data-testid="reimbursements-${tab}-card-list">`, 'u'))?.[1].split(' ') ?? [];
      // `grid-cols-1` is one column of minmax(0, 1fr); a grid with no named column sizes it by its content.
      assert.ok(list.includes('grid') && list.includes('grid-cols-1'), `${tab}: ${list.join(' ')}`);
    }
  });

  it('says on a card what its table row says of the claim: the reason to an approver, the review to a finance desk', () => {
    const cards = (page: string, tab: string) => visible(page.slice(page.indexOf(`data-testid="reimbursements-${tab}-card-list"`)));
    assert.ok(cards(html('approvals'), 'approvals').includes('ค่าเดินทางไปพบลูกค้า'), 'the reason, which the approval card left out');
    const review = { ...queueRow, financeReviewStatus: 'BLOCKED' };
    assert.ok(cards(hubTab('finance', [review], undefined, {}, '', true), 'finance').some((text) => text.includes('ระงับ')), 'the review state');
  });

  it('names what each queue\'s search box finds, short enough for a 390 px phone and true of cards', () => {
    assert.match(html('approvals'), /placeholder="ค้นหาเลขที่ ผู้เบิก เหตุผล ยอดเงิน"/u);
    assert.match(html('finance'), /placeholder="ค้นหาเลขที่ ผู้เบิก ยอดเงิน สถานะ"/u);
    for (const [tab] of lists) assert.doesNotMatch(html(tab), /ในตาราง/u, tab);
  });
});

// Audit B20: a viewer who may only reject was offered อนุมัติ on every queue row, and the API answered 403.
describe('the approval queue offers only what the server says this viewer can do', () => {
  const row = (approvalActions?: { canApprove: boolean; canReject: boolean }) => ({ ...queueRow, status: 'PENDING_APPROVAL', approvalActions });
  /** The decision buttons of one queue row: once in the table, once on the phone card. */
  const decisions = (html: string) => visible(html).filter((text) => text === 'อนุมัติ' || text === 'ปฏิเสธ');

  it('shows อนุมัติ and ปฏิเสธ from the row\'s own approvalActions, never from the viewer\'s role or permissions', () => {
    assert.deepEqual(decisions(hubTab('approvals', [row({ canApprove: true, canReject: true })])), ['อนุมัติ', 'ปฏิเสธ', 'อนุมัติ', 'ปฏิเสธ']);
    assert.deepEqual(decisions(hubTab('approvals', [row({ canApprove: false, canReject: true })])), ['ปฏิเสธ', 'ปฏิเสธ']);
    assert.deepEqual(decisions(hubTab('approvals', [row({ canApprove: true, canReject: false })])), ['อนุมัติ', 'อนุมัติ']);
    // The viewer here is an OWNER holding reimbursement.approve: a row that says nothing still offers nothing.
    assert.ok(hubPermissions.includes('reimbursement.approve'));
    assert.deepEqual(decisions(hubTab('approvals', [row()])), []);
    // The row stays readable either way.
    assert.ok(visible(hubTab('approvals', [row({ canApprove: false, canReject: true })])).includes('ดูรายละเอียด'));
  });

  // Before: the mark was on finance-queue rows alone, so an approver first met it on the claim page.
  it('marks a claim that may repeat another one อาจซ้ำ on its row, in the table and on the phone card', () => {
    const marks = (duplicateStatus: string) => visible(hubTab('approvals', [{ ...row({ canApprove: true, canReject: true }), duplicateStatus }])).filter((text) => text === 'อาจซ้ำ').length;
    assert.deepEqual([marks('POSSIBLE_DUPLICATE'), marks('CONFIRMED_DUPLICATE')], [2, 2]);
    assert.deepEqual([marks('NO_MATCH'), marks('NOT_CHECKED'), marks('OVERRIDDEN')], [0, 0, 0]);
  });

  // Payout Phase 1 on the same rows: a claim paid by transfer is approved on its own page, where the account is
  // shown and attested, and its button says so. It is still offered only where the row allows approving.
  it('names the approve button of a transfer claim for what it does, and offers it under the same rule', () => {
    const transfer = (approvalActions?: { canApprove: boolean; canReject: boolean }) => ({ ...row(approvalActions), payoutMethod: 'BANK_TRANSFER' });
    const offered = (html: string) => visible(html).filter((text) => ['อนุมัติ', 'ตรวจบัญชีและอนุมัติ', 'ปฏิเสธ'].includes(text));
    assert.deepEqual(offered(hubTab('approvals', [transfer({ canApprove: true, canReject: true })])),
      ['ตรวจบัญชีและอนุมัติ', 'ปฏิเสธ', 'ตรวจบัญชีและอนุมัติ', 'ปฏิเสธ']);
    assert.deepEqual(offered(hubTab('approvals', [transfer({ canApprove: false, canReject: true })])), ['ปฏิเสธ', 'ปฏิเสธ']);
    assert.deepEqual(offered(hubTab('approvals', [transfer()])), []);
    // Cash has no account to attest: the row approves in place, as before.
    assert.deepEqual(offered(hubTab('approvals', [{ ...row({ canApprove: true, canReject: false }), payoutMethod: 'CASH' }])), ['อนุมัติ', 'อนุมัติ']);
  });

  // Payout spec §14.6: what a round's approvers approve is what was answered, which a row does not show. Its row
  // leads to the claim page for whoever decides the waiting step, and offers no "ปฏิเสธ": a round never rejects.
  // Before: its one button read "ตรวจบัญชีรับเงินใหม่" whatever was answered: an account that was kept, a first one, or cash.
  it('leads a row of a correction round to the claim page: no approval in place and no ปฏิเสธ, its button named for what was answered', () => {
    const BUTTONS = {
      NEW_ACCOUNT: ['BANK_TRANSFER', 'ตรวจบัญชีรับเงินใหม่', 'รออนุมัติบัญชีรับเงินใหม่'], SAME_ACCOUNT: ['BANK_TRANSFER', 'ตรวจบัญชีรับเงินเดิม', 'รออนุมัติบัญชีรับเงินเดิม'],
      ACCOUNT_INSTEAD: ['BANK_TRANSFER', 'ตรวจบัญชีรับเงิน', 'รออนุมัติบัญชีรับเงิน'], FIRST_ACCOUNT: ['BANK_TRANSFER', 'ตรวจบัญชีรับเงิน', 'รออนุมัติบัญชีรับเงิน'],
      CASH_INSTEAD: ['CASH', 'ตรวจการรับเป็นเงินสด', 'รออนุมัติการรับเป็นเงินสด'], SAME_CASH: ['CASH', 'ตรวจการรับเป็นเงินสด', 'รออนุมัติการรับเป็นเงินสด'],
      FIRST_CASH: ['CASH', 'ตรวจการรับเป็นเงินสด', 'รออนุมัติการรับเป็นเงินสด'],
    } as const;
    const all = ['อนุมัติ', 'ตรวจบัญชีและอนุมัติ', 'ปฏิเสธ', 'ตรวจวิธีรับเงินคืน', ...Object.values(BUTTONS).map(([, button]) => button)] as string[];
    const offered = (html: string) => visible(html).filter((text) => all.includes(text));
    const inRound = (approvalActions: { canApprove: boolean; canReject: boolean } | undefined, payoutCorrectionAnswer?: keyof typeof BUTTONS) =>
      ({ ...correctionRows[1]!, ageHours: 3, slaRisk: false, approvalActions, payoutMethod: payoutCorrectionAnswer ? BUTTONS[payoutCorrectionAnswer][0] : 'BANK_TRANSFER', payoutCorrectionAnswer, approvalSnapshotHash: 'hash' });
    for (const [answer, [, button, badge]] of Object.entries(BUTTONS) as Array<[keyof typeof BUTTONS, typeof BUTTONS[keyof typeof BUTTONS]]>) {
      // In the table and on the phone card.
      assert.deepEqual(offered(hubTab('approvals', [inRound({ canApprove: true, canReject: true }, answer)])), [button, button], answer);
      // Whoever may only send the answer back gets the same way in.
      assert.deepEqual(offered(hubTab('approvals', [inRound({ canApprove: false, canReject: true }, answer)])), [button, button], answer);
      assert.deepEqual(offered(hubTab('approvals', [inRound(undefined, answer)])), [], answer);
      // The row says what it waits for: in the table beside its age, and on its phone card. The button names the same thing.
      const texts = visible(hubTab('approvals', [inRound({ canApprove: true, canReject: true }, answer)]));
      assert.equal(texts.filter((text) => text === badge).length, 2, answer);
      assert.equal(texts.includes('รออนุมัติ'), false, answer);
      assert.equal(badge, `รออนุมัติ${button.slice('ตรวจ'.length)}`);
    }
    // A row with no answer on it (a page fed by an older server): the method, which is true of every answer.
    assert.deepEqual(offered(hubTab('approvals', [inRound({ canApprove: true, canReject: true })])), ['ตรวจวิธีรับเงินคืน', 'ตรวจวิธีรับเงินคืน']);
    // A row of no round has no such badge in the table, only its status on the card.
    assert.equal(visible(hubTab('approvals', [row({ canApprove: true, canReject: true })])).filter((text) => text === 'รออนุมัติ').length, 1);
  });
});

// Payout Phase 1 on the paged list: a row shows no account, so a draft is sent from its row only when the draft
// itself chose cash. Any other draft may be paid into an account, and its button opens the claim page instead.
describe('a draft row of the hub list is sent from the row only when nothing unseen would be frozen', () => {
  const sending = (html: string) => visible(html).filter((text) => text === 'ส่งอนุมัติ' || text === 'ตรวจบัญชีและส่งอนุมัติ' || text === 'เลือกวิธีรับเงินคืนและส่งอนุมัติ');
  const ready = { ...draft, receiptRequirementStatus: 'ATTACHED' };

  it('names the missing receiving method, transfer account check or cash submission in both list layouts', () => {
    // Table row and phone card, both from the rows of the held list.
    assert.deepEqual(sending(hubTab('mine', [{ ...ready, payoutMethod: 'CASH' }])), ['ส่งอนุมัติ', 'ส่งอนุมัติ']);
    for (const [payoutMethod, label] of [[undefined, 'เลือกวิธีรับเงินคืนและส่งอนุมัติ'], [null, 'เลือกวิธีรับเงินคืนและส่งอนุมัติ'], ['BANK_TRANSFER', 'ตรวจบัญชีและส่งอนุมัติ']] as const) {
      assert.deepEqual(sending(hubTab('mine', [{ ...ready, payoutMethod }])), [label, label], String(payoutMethod));
    }
    // A claim already sent has no send button, whatever it is paid by.
    assert.deepEqual(sending(hubTab('mine', [{ ...ready, status: 'PENDING_APPROVAL', payoutMethod: 'CASH', currentDesk: { kind: 'APPROVER' } }])), []);
  });
});

// The policy form of the hub's ตั้งค่านโยบาย tab, with the policy and the role options already loaded.
const policyForm = { id: 'policy-1', updatedAt: '2026-10-01T03:00:00.000Z', status: 'ACTIVE', approvalRequiredFromAmount: '1.00', approverMode: 'CUSTOM_ROLE',
  defaultApproverRoles: ['MANAGER', 'CHECKER'], allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: true, duplicatePolicy: 'WARN',
  financeReviewRequired: false, slaHours: null };
const roleOption = (key: string, name: string, canRecordPayment: boolean, selectable = true) => ({ key, name, optionLabel: name, eligibleApproverCount: 1, coverage: 'COMPLETE',
  uncoveredBranchNames: [], selectable, canRecordPayment });
/** The settings form with the policy and the role options already loaded: the form is the component's first state. */
const policySettingsHtml = (loaded: object, options: object[]) => {
  let formLoaded = false;
  return renderWithState(h(ToastContext.Provider, { value: toast }, h(PolicySettings, { companyId: 'company-1' })), (initial) => {
    if (initial === null && !formLoaded) { formLoaded = true; return loaded; }
    return Array.isArray(initial) && initial.length === 0 ? options : initial === true ? false : undefined;
  });
};
const policySettings = (loaded: object, options: object[]) => visible(policySettingsHtml(loaded, options));

describe('ตั้งค่านโยบาย warns about an approver role that cannot record payment (spec §13.3 F2)', () => {
  const policy = policyForm, option = roleOption, settings = policySettings;
  const warning = 'บทบาท ผู้ตรวจ อนุมัติได้ แต่บันทึกจ่ายไม่ได้ ใบที่อนุมัติแล้วจะรอผู้ที่มีสิทธิ์บันทึกจ่าย ถ้าต้องการให้ผู้อนุมัติจ่ายเองได้ ให้เพิ่มสิทธิ์บันทึกจ่ายให้บทบาทนี้ในหน้าบทบาทและสิทธิ์';

  it('names the chosen role under the role list while finance review is off, and saving stays possible', () => {
    const options = [option('MANAGER', 'Manager', true), option('CHECKER', 'ผู้ตรวจ', false)];
    const texts = settings(policy, options);
    assert.ok(texts.includes(warning), texts.filter((text) => text.includes('บันทึกจ่าย')).join(' | '));
    assert.ok(texts.includes('บันทึกนโยบาย'));
    for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(warning, pattern, name);
    // Nothing to say once finance review pays, once the role is unticked, or when every chosen role can pay.
    for (const quiet of [settings({ ...policy, financeReviewRequired: true }, options), settings({ ...policy, defaultApproverRoles: ['MANAGER'] }, options),
      settings(policy, [option('MANAGER', 'Manager', true), option('CHECKER', 'ผู้ตรวจ', true)])]) {
      assert.equal(quiet.some((text) => text.includes('บันทึกจ่ายไม่ได้')), false);
      assert.ok(quiet.includes('ส่งใบเบิกให้ใครอนุมัติ?'), 'the form rendered');
    }
  });

  // Before: the warning named every ticked role, so a role that could no longer approve was said to "อนุมัติได้".
  it('leaves a ticked role that can no longer approve out of the warning; the form already says it is not ready', () => {
    const texts = settings(policy, [option('MANAGER', 'Manager', true), option('CHECKER', 'ผู้ตรวจ', false, false)]);
    assert.equal(texts.some((text) => text.includes('อนุมัติได้ แต่บันทึกจ่ายไม่ได้')), false);
    assert.ok(texts.includes('บางบทบาทที่เลือกยังไม่มีคนพร้อมอนุมัติ กรุณาเอาออกหรือเลือกบทบาทอื่น'));
    // Two ticked roles lack the pay right; only the one that can still approve is named.
    const both = settings({ ...policy, defaultApproverRoles: ['MANAGER', 'CHECKER', 'LEAD'] },
      [option('MANAGER', 'Manager', true), option('CHECKER', 'ผู้ตรวจ', false), option('LEAD', 'หัวหน้าสาขา', false, false)]);
    assert.ok(both.includes(warning), both.filter((text) => text.includes('บันทึกจ่าย')).join(' | '));
  });
});

// Owner's model 2026-10-01: a claim has a requester and an approver, and a finance desk exists only where the company turned the
// finance-review step on. A shop without the step still had a tab "คิวการเงิน", empty with "ไม่มีรายการรอการเงิน".
describe('the hub\'s third tab is the pay queue where the company has no finance-review step (owner 2026-10-02)', () => {
  const ready = { ...queueRow, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', hasDuplicateBlocker: false, currentDesk: { kind: 'PAYMENT' } };
  const underReview = { ...queueRow, id: `${ids.request}review`, financeReviewStatus: 'PENDING', hasDuplicateBlocker: false, currentDesk: { kind: 'FINANCE' } };
  /** The work tabs of the hub's own navigation. */
  const tabsOf = (html: string) => visible(html.slice(html.indexOf('>', html.indexOf('<nav')) + 1, html.indexOf('</nav>')));

  it('names it คิวรอจ่าย and says nothing of finance: the tab, its description, its count, its empty text and its columns', () => {
    const empty = hubTab('finance', [], undefined, {}, '', false);
    assert.deepEqual(tabsOf(empty), ['รายการที่เกี่ยวข้อง', 'คิวอนุมัติ', 'คิวรอจ่าย']);
    for (const text of ['บันทึกการจ่ายเงินของคำขอที่อนุมัติแล้ว', 'รอจ่าย', 'ไม่มีใบรอจ่าย', 'คำขอที่อนุมัติแล้วและรอจ่ายเงินคืนจะแสดงที่นี่']) assert.ok(visible(empty).includes(text), text);
    const filled = visible(hubTab('finance', [ready], undefined, {}, '', false));
    for (const text of ['พร้อมจ่าย', 'บันทึกจ่าย', 'รอจ่าย']) assert.ok(filled.includes(text), text);
    // Before: the tab and its empty text named a finance desk, and every row read "ไม่ต้องตรวจ" under "ตรวจการเงิน".
    for (const text of [...visible(empty), ...filled]) assert.doesNotMatch(text, /การเงิน|ไม่ต้องตรวจ|รอตรวจ/u);
  });

  it('keeps the finance wording where the step is on', () => {
    const empty = hubTab('finance', [], undefined, {}, '', true);
    assert.deepEqual(tabsOf(empty), ['รายการที่เกี่ยวข้อง', 'คิวอนุมัติ', 'คิวการเงิน']);
    for (const text of ['ตรวจสอบคำขอที่อนุมัติแล้ว และบันทึกการจ่ายเงิน', 'รอตรวจ/รอจ่าย', 'ไม่มีรายการรอการเงิน', 'คำขอที่ผ่านการอนุมัติแล้วจะแสดงที่นี่']) assert.ok(visible(empty).includes(text), text);
    const filled = visible(hubTab('finance', [ready, underReview], undefined, {}, '', true));
    for (const text of ['ตรวจการเงิน', 'ไม่ต้องตรวจ', 'รอตรวจสอบ', 'อนุมัติจ่าย']) assert.ok(filled.includes(text), text);
  });

  // The policy is frozen on a claim when it is sent, so a claim sent while the step was on is still reviewed after it is turned off.
  it('keeps the review column and its count for a queue that still holds such a claim, under the tab the company now has', () => {
    const html = hubTab('finance', [ready, underReview], undefined, {}, '', false);
    assert.deepEqual(tabsOf(html), ['รายการที่เกี่ยวข้อง', 'คิวอนุมัติ', 'คิวรอจ่าย']);
    for (const text of ['รอตรวจ/รอจ่าย', 'ตรวจการเงิน', 'รอตรวจสอบ']) assert.ok(visible(html).includes(text), text);
    // The claim beside it never had the step: it says nothing of a review (before: "ตรวจการเงิน: ไม่ต้องตรวจ").
    assert.equal(visible(html).includes('ไม่ต้องตรวจ'), false);
  });

  // Upgrade test 2026-10-02, on the owner's own company: six claims wait for payment, and one of them passed a finance
  // review while the company still had that step. Every card of the queue then read "ตรวจการเงิน: ไม่ต้องตรวจ", also the
  // five that never had a review, and the count read "รอตรวจ/รอจ่าย" though nothing waited for one.
  it('says a claim\'s finance review only on the claim that had one, and counts "รอจ่าย" when nothing waits for a review', () => {
    const reviewed = { ...ready, id: `${ids.request}reviewed`, requestNo: 'RB-202609-00028', financeReviewStatus: 'APPROVED_FOR_PAYMENT' };
    const others = [1, 2, 3].map((index) => ({ ...ready, id: `${ids.request}plain${index}`, requestNo: `RB-202609-0003${index}` }));
    const html = hubTab('finance', [others[0]!, reviewed, others[1]!, others[2]!], undefined, {}, '', false);
    const texts = visible(html);
    assert.deepEqual(tabsOf(html), ['รายการที่เกี่ยวข้อง', 'คิวอนุมัติ', 'คิวรอจ่าย']);
    // The count: nothing in the queue waits for a review.
    assert.ok(texts.includes('รอจ่าย') && !texts.includes('รอตรวจ/รอจ่าย'), texts.filter((text) => text.includes('รอ')).join(' | '));
    assert.equal(texts.includes('ไม่ต้องตรวจ'), false);
    // On the phone cards: one finance line, on the claim that was reviewed, with what happened.
    const cards = html.slice(html.indexOf('data-testid="reimbursements-finance-card-list"')).split('<a ').slice(0, -1);
    const lineOf = (card: string) => /ตรวจการเงิน: (?:<!-- -->)?([^<]*)</u.exec(card)?.[1] ?? null;
    assert.deepEqual(cards.map((card) => [/RB-202609-000\d\d/u.exec(card)?.[0], lineOf(card)]),
      [['RB-202609-00031', null], ['RB-202609-00028', 'อนุมัติจ่าย'], ['RB-202609-00032', null], ['RB-202609-00033', null]]);
    // In the table: the column is there for that one claim, and the cells of the others are empty.
    const table = html.slice(html.indexOf('data-testid="reimbursements-finance-table"'), html.indexOf('data-testid="reimbursements-finance-card-list"'));
    assert.ok(visible(table).includes('ตรวจการเงิน'));
    assert.deepEqual([...table.matchAll(/<td class="text-xs text-gray-500">([^<]*)<\/td>/gu)].map((match) => match[1]), ['—', 'อนุมัติจ่าย', '—', '—']);
    // A queue with no such claim says nothing of a review at all, as before.
    const plain = visible(hubTab('finance', others, undefined, {}, '', false));
    for (const text of plain) assert.doesNotMatch(text, /การเงิน|ไม่ต้องตรวจ|รอตรวจ/u);
    // The search finds a claim by the finance words its row shows, and no claim by words its row does not show.
    const found = (query: string) => hubTab('finance', [others[0]!, reviewed, others[1]!], undefined, {}, query, false).match(/data-testid="reimbursements-finance-card"/gu)?.length ?? 0;
    assert.deepEqual([found('อนุมัติจ่าย'), found('ไม่ต้องตรวจ')], [1, 0]);
  });

  it('names no third tab before the page is told, with a policy right or without one', () => {
    for (const mayReadPolicy of [true, false]) {
      const unread = hubTab('finance', [ready], undefined, {}, '', 'unread', mayReadPolicy);
      assert.deepEqual(tabsOf(unread), ['รายการที่เกี่ยวข้อง', 'คิวอนุมัติ']);
      for (const text of visible(unread)) assert.doesNotMatch(text, /คิวการเงิน|คิวรอจ่าย|ไม่มีใบรอจ่าย|รอตรวจ\/รอจ่าย/u);
      assert.ok(visible(unread).includes('กำลังโหลด...'));
    }
  });

  // The policy endpoint asks for a policy right, which an accountant does not hold: they review claims for finance and
  // record no policy. Before, such a viewer read "คิวการเงิน" and "ไม่มีรายการรอการเงิน" in a shop with no finance step.
  it('names the tab by the company for a finance reviewer who may not read the policy, as the claims list answer tells it', () => {
    const off = hubTab('finance', [], undefined, {}, '', false, false);
    assert.deepEqual(tabsOf(off), ['รายการที่เกี่ยวข้อง', 'คิวอนุมัติ', 'คิวรอจ่าย']);
    assert.ok(visible(off).includes('ไม่มีใบรอจ่าย'));
    for (const text of visible(off)) assert.doesNotMatch(text, /การเงิน|รอตรวจ/u);
    const on = hubTab('finance', [], undefined, {}, '', true, false);
    assert.deepEqual(tabsOf(on), ['รายการที่เกี่ยวข้อง', 'คิวอนุมัติ', 'คิวการเงิน']);
    assert.ok(visible(on).includes('ไม่มีรายการรอการเงิน'));
    // Which of the two it asks is the page's own choice: the policy where the session may read it, else the list answer.
    const page = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
    assert.match(page, /void \(canReadPolicy \? getReimbursementPolicy\(companyId\) : getReimbursementFinanceStep\(companyId, listScope\)\)/);
    assert.match(page, /const financeStep = !hasThirdTab \? true : policyRead\.companyId === companyId \? policyRead\.financeStep : undefined;/);
  });
});

// Phone first: whatever a person presses is 44 px high at 390 px. The real look measured 18 px (the back link of every
// claim page), 24 px (the header of a line on the claim form) and 38 px (an approver role on the policy tab).
describe('what a person presses on a claim screen is 44 px high on a phone (owner 2026-10-02)', () => {
  it('gives the back link its own 44 px box on a phone, without making the pill it sits in taller', () => {
    const html = filledCreatePage();
    // 44 px high with 13 px taken back above and below: the pill around it still measures the 18 px of its text.
    assert.match(html, /<a class="-my-\[13px\] inline-flex min-h-11 items-center sm:my-0 sm:min-h-0" href="\/companies\/company-1\/reimbursements">← กลับไปการเบิกจ่าย<\/a>/);
    // One link for the claim form, the claim page and the payout-account page.
    for (const file of ['ReimbursementCreatePage.tsx', 'ReimbursementJourneyPage.tsx', 'ReimbursementPayoutAccountPage.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      assert.match(source, /<BackToClaimsLink href=\{hubHref\} \/>/, file);
      assert.doesNotMatch(source, /<Link href=\{hubHref\}>←/, file);
    }
  });

  it('gives the header of a line on the claim form, and the button that removes a line, a 44 px height', () => {
    const html = filledCreatePage(); // two lines
    const headers = [...html.matchAll(/<button type="button" class="([^"]*)" aria-expanded="(?:true|false)">/gu)].map((match) => match[1]!);
    assert.equal(headers.length, 2);
    for (const cls of headers) assert.match(cls, /\bmin-h-11\b/, cls);
    const removers = [...html.matchAll(/<button type="button" aria-label="ลบรายการ" class="([^"]*)">/gu)].map((match) => match[1]!);
    assert.equal(removers.length, 2);
    for (const cls of removers) assert.match(cls, /\bh-11 w-11\b/, cls);
  });

  // The second look (the owner's own case, with paper copies and a slip) measured 37 px and 29 px wide on two links of two
  // words, and the notes of a claim had two with no height of their own.
  it('gives the short links of a claim page 44 px both ways: ดูสำเนา, ดูสลิป, and a note\'s แก้ไข and ลบ', () => {
    const html = detailSections({ ...paid, payments: [{ ...(paid.payments[1] as object), slipCount: 1, slips: [{ attachmentId: ids.attachment }], viewerCanOpenSlips: true }],
      signedCopies: [{ attachmentId: ids.attachment, fileName: 'ใบเบิกเซ็นแล้ว.pdf', uploadedAt: '2026-09-29T05:00:00.000Z', acknowledgedAt: '2026-09-29T05:00:00.000Z' }], signatures: [] },
      ids.requester, ['reimbursement.read_own']);
    for (const label of ['ดูสำเนา', 'ดูสลิป']) {
      const buttons = [...html.matchAll(new RegExp(`<button[^>]*class="([^"]*)"[^>]*>${label}</button>`, 'gu'))].map((match) => match[1]!);
      assert.ok(buttons.length > 0, label);
      for (const cls of buttons) assert.match(cls, /\bmin-h-11 min-w-11\b/u, `${label}: ${cls}`);
    }
    const page = readFileSync(join(__dirname, 'ReimbursementJourneyPage.tsx'), 'utf8');
    for (const label of ['แก้ไขโน้ตของ', 'ลบโน้ตของ']) {
      assert.match(page, new RegExp(`className="min-h-11 min-w-11 [^"]*" aria-label=\\{\`${label} `, 'u'), label);
    }
  });

  it('gives each approver role on the policy tab a 44 px height', () => {
    const html = policySettingsHtml(policyForm, [roleOption('MANAGER', 'Manager', true), roleOption('CHECKER', 'ผู้ตรวจ', false)]);
    const roles = [...html.matchAll(/<label class="([^"]*)"><span class="min-w-0">[^<]*<\/span><input type="checkbox"/gu)].map((match) => match[1]!);
    assert.equal(roles.length, 2, html.slice(html.indexOf('ส่งใบเบิกให้ใครอนุมัติ'), html.indexOf('ส่งใบเบิกให้ใครอนุมัติ') + 900));
    for (const cls of roles) assert.match(cls, /\bmin-h-11\b/, cls);
  });
});

// Upgrade test 2026-10-02: a claim that needed no approval read as finished ("ลงนามในระบบครบแล้ว") beside a signature block
// "ผู้อนุมัติ · ยังไม่ลงนาม" that nobody could ever sign.
describe('the signature card has an approver block only where the claim has an approver (owner 2026-10-02)', () => {
  /** The blocks of the card "ลายเซ็นในใบเบิก": each role with what it says. */
  const blocks = (detail: object) => {
    const html = detailSections(detail, ids.requester, ['reimbursement.read_own']);
    const card = html.slice(html.indexOf('id="reimbursement-signatures"'), html.indexOf('id="reimbursement-signed-copies"'));
    return {
      roles: [...card.matchAll(/<div class="font-semibold text-gray-700">([^<]*)<\/div><div class="mt-2">(?:<span[^>]*>)?([^<]*)/gu)].map((match) => `${match[1]}: ${match[2]}`),
      texts: visible(card), html: card,
    };
  };
  const noApproval = { ...paid, documentSignedVia: null, financeReviewStatus: 'NOT_REQUIRED', financeReviewedByName: undefined, approvalSteps: [] };

  it('shows the requester\'s block alone on a claim that needed no approval, and says why', () => {
    const card = blocks(noApproval);
    assert.deepEqual(card.roles, ['ผู้เบิก: ลงนามแล้ว']);
    assert.ok(card.texts.includes('ใบนี้ไม่ต้องอนุมัติตามนโยบาย จึงมีเฉพาะลายเซ็นของผู้เบิก'));
    assert.equal(card.texts.includes('ผู้อนุมัติ') || card.texts.includes('ยังไม่ลงนาม'), false);
    // One block is as wide as the card, not half of it beside nothing.
    assert.doesNotMatch(card.html, /class="grid gap-2 grid-cols-2/u);
    // A declared paper copy changes nothing: there is still no approver to have signed it.
    assert.deepEqual(blocks({ ...noApproval, documentSignedVia: 'PAPER', signatures: [] }).roles, ['ผู้เบิก: ลงนามบนกระดาษ']);
    assert.equal(model.claimHasNoApprover(noApproval), true);
  });

  it('keeps both blocks where someone approved the claim, where it still waits for its approval, and while its account is corrected', () => {
    assert.deepEqual(blocks({ ...paid, documentSignedVia: null }).roles, ['ผู้เบิก: ลงนามแล้ว', 'ผู้อนุมัติ: ยังไม่ลงนาม']);
    const waiting = { ...paid, documentSignedVia: null, status: 'PENDING_APPROVAL', paymentStatus: 'NOT_PAYABLE', approvedAt: undefined, payments: [], signatures: [],
      approvalSteps: [{ id: ids.step, sequenceNo: 1, approverUserId: ids.approver, approverName: 'สมชาย', status: 'PENDING', assignedAt: '2026-09-27T03:00:00.000Z' }] };
    assert.deepEqual(blocks(waiting).roles, ['ผู้เบิก: ยังไม่ลงนาม', 'ผู้อนุมัติ: ยังไม่ลงนาม']);
    // A correction round sets the approval aside: the new account still has to be approved, by an approver.
    const inRound = { ...paid, documentSignedVia: null, status: 'PENDING_APPROVAL', payoutCorrectionPhase: 'AWAITING_REQUESTER', signatures: [], payments: [],
      approvalSteps: [{ ...(paid.approvalSteps[0] as object), invalidatedAt: '2026-09-28T01:00:00.000Z', invalidatedReason: 'payout_account_correction' }] };
    assert.deepEqual(blocks(inRound).roles, ['ผู้เบิก: ยังไม่ลงนาม', 'ผู้อนุมัติ: ยังไม่ลงนาม']);
    for (const detail of [paid, waiting, inRound, draft]) assert.equal(model.claimHasNoApprover(detail), false);
  });
});

// Upgrade test 2026-10-02: the edit page of a draft made before the release said "แก้ไขข้อมูลตามเหตุผลที่ส่งกลับ แล้วบันทึกร่าง
// ก่อนส่งอนุมัติใหม่", although nobody had sent that draft back.
describe('the edit page speaks of a reason for sending back only for a draft someone sent back (owner 2026-10-02)', () => {
  /**
   * The edit page with its draft loaded. Its states in the order it declares them: `loading` is its one `true`,
   * `editLoaded` its fourth `false`, and the note of a draft that was sent back its sixth `null`.
   */
  const editPage = (note: string | null) => {
    let falses = 0;
    let nulls = 0;
    return visible(renderWithState(createPage({ requestId: ids.request, canUpdate: true }), (initial) => {
      if (Array.isArray(initial?.lines)) return filledForm;
      if (initial === true) return false;
      if (initial === false) { falses += 1; return falses === 4 ? true : undefined; }
      if (initial === null) { nulls += 1; return nulls === 6 && note ? note : undefined; }
      return undefined;
    }));
  };
  const SENT_BACK = 'แก้ไขข้อมูลตามเหตุผลที่ส่งกลับ แล้วบันทึกร่างก่อนส่งอนุมัติใหม่';
  const JUST_EDITED = 'แก้ไขข้อมูลคำขอ แล้วบันทึกร่างก่อนส่งอนุมัติ';

  it('says a plain draft is edited and sent, and says "ตามเหตุผลที่ส่งกลับ" beside the reason of one that was sent back', () => {
    const plain = editPage(null);
    assert.ok(plain.includes('แก้ไขคำขอเบิก') && plain.includes(JUST_EDITED), JSON.stringify(plain.slice(0, 12)));
    assert.equal(plain.some((text) => text.includes('ส่งกลับ')), false, 'nobody sent it back');
    const returned = editPage('ส่งกลับให้แก้ไขที่ขั้นตรวจการเงิน: แนบใบเสร็จตัวจริง');
    assert.ok(returned.includes(SENT_BACK));
    assert.ok(returned.includes('⚠ ส่งกลับให้แก้ไขที่ขั้นตรวจการเงิน: แนบใบเสร็จตัวจริง'), 'the reason is on the page that speaks of it');
    assert.equal(returned.includes(JUST_EDITED), false);
  });

  it('knows a draft that was sent back from the claim itself: finance asked for a correction, or its approver rejected it', () => {
    const step = (status: string, assignedAt: string, extra: object = {}) => ({ id: `step-${assignedAt}`, sequenceNo: 1, status, assignedAt, ...extra });
    assert.equal(draftSentBackNote({ ...draft }), null, 'never sent');
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [] }), null);
    // Whoever holds the finance-review right returns a claim, so the note names the step and that person, not a department.
    assert.equal(draftSentBackNote({ ...draft, financeReviewStatus: 'NEEDS_INFO', financeReviewNote: 'แนบใบเสร็จตัวจริง' }), 'ส่งกลับให้แก้ไขที่ขั้นตรวจการเงิน: แนบใบเสร็จตัวจริง');
    assert.equal(draftSentBackNote({ ...draft, financeReviewStatus: 'NEEDS_INFO' }), 'ส่งกลับให้แก้ไขที่ขั้นตรวจการเงิน');
    assert.equal(draftSentBackNote({ ...draft, financeReviewStatus: 'NEEDS_INFO', financeReviewedByName: 'อรอนงค์ ใจดี', financeReviewNote: 'แนบใบเสร็จตัวจริง' }),
      'ส่งกลับให้แก้ไขที่ขั้นตรวจการเงิน โดย อรอนงค์ ใจดี: แนบใบเสร็จตัวจริง');
    // Rejected, then reopened by its requester: the step it was last put before says why.
    const rejected = step('REJECTED', '2026-09-28T02:00:00.000Z', { rejectionReason: 'ยอดไม่ตรงกับใบเสร็จ' });
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [rejected] }), 'ผู้อนุมัติปฏิเสธคำขอนี้: ยอดไม่ตรงกับใบเสร็จ');
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [step('REJECTED', '2026-09-28T02:00:00.000Z')] }), 'ผู้อนุมัติปฏิเสธคำขอนี้');
    // Taken back by the requester themselves, also after an earlier rejection: nobody sent it back this time.
    const withdrawn = step('CANCELLED', '2026-09-29T02:00:00.000Z', { invalidatedReason: 'withdrawn_by_requester' });
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [withdrawn] }), null);
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [withdrawn, rejected] }), null, 'by when each was assigned, not by the order of the list');
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [step('CANCELLED', '2026-09-27T02:00:00.000Z'), rejected] }), 'ผู้อนุมัติปฏิเสธคำขอนี้: ยอดไม่ตรงกับใบเสร็จ');
  });
});

// The three totals read "฿7,219.5": a currency sign, and a satang digit dropped. Every other amount of a claim reads "7,219.50 บาท".
describe('the totals on the hub read as money in baht, like every other amount of a claim (owner 2026-09-27/29)', () => {
  const ready = { ...queueRow, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', hasDuplicateBlocker: false, currentDesk: { kind: 'PAYMENT' } };
  const MONEY = /^\d{1,3}(,\d{3})*\.\d{2} บาท$/u;

  it('shows the total of each tab as "1,234.50 บาท", with no currency sign and both satang digits', () => {
    for (const [tab, html] of [['mine', hubTab('mine', hubClaims)], ['approvals', hubTab('approvals', [queueRow])], ['finance', hubTab('finance', [ready], undefined, {}, '', false)]] as const) {
      const texts = visible(html);
      assert.ok(texts.some((text) => MONEY.test(text)), `${tab}: ${JSON.stringify(texts.filter((text) => /\d/u.test(text)))}`);
      for (const text of texts) assert.doesNotMatch(text, /฿|THB/u, `${tab}: ${text}`);
    }
    assert.ok(visible(hubTab('mine', hubClaims)).includes('700.00 บาท'));
  });
});

// The dialog told a signer to wait for the signature to become ready, and the refusal said to wait for its approval, while
// the signature page says a saved signature signs at once: nothing is waited for, and nobody approves a signature.
describe('a signer with no saved signature is told what is true and what to do (owner 2026-10-02)', () => {
  const dialog = () => {
    Object.assign(globalThis, { document: { body: {} } }); // Modal's portal target; never touched by a server render
    try { return visible(renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(sections.MissingSavedSignatureModal, { companyId: 'company-1', onClose: noop })))); }
    finally { Reflect.deleteProperty(globalThis, 'document'); }
  };

  it('says where to save one and that it signs at once, in the signature page\'s own words, and never to wait', () => {
    const texts = dialog();
    for (const text of ['ยังไม่มีลายเซ็นของคุณ', 'ไปหน้าลายเซ็น', 'ไว้ภายหลัง']) assert.ok(texts.includes(text), text);
    const body = texts.find((text) => text.includes('ลายเซ็นของฉัน')) ?? '';
    assert.match(body, /เซ็นบนหน้าจอหรืออัปโหลดรูปลายเซ็น บันทึกแล้วใช้ลงนามได้ทันที จากนั้นกลับมากดลงนามในใบนี้อีกครั้ง$/u);
    const refusal = errorMessage('claim_saved_signature_required');
    assert.match(refusal, /ใช้ลงนามได้ทันที$/u);
    for (const text of [...texts, refusal]) assert.doesNotMatch(text, /รอให้|รออนุมัติ|พร้อมใช้งาน/u);
    // What the dialog promises is what the signature page itself says after a save.
    const signaturePage = readFileSync(join(__dirname, '../expenses/ExpensesWorkspacePanels.tsx'), 'utf8');
    for (const text of ['ยังไม่มีลายเซ็นของคุณ', 'บันทึกลายเซ็นแล้ว ใช้ลงนามได้ทันที']) assert.ok(signaturePage.includes(text), text);
  });

  // Upgrade test 2026-10-02: after the signature was saved, nothing on the signature page led back to the claim.
  it('carries the claim to the signature page, which offers the way back to it before and after a signature is saved', () => {
    Object.assign(globalThis, { document: { body: {} } });
    let html: string;
    try { html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(sections.MissingSavedSignatureModal, { companyId: 'company-1', requestId: ids.request, onClose: noop }))); }
    finally { Reflect.deleteProperty(globalThis, 'document'); }
    assert.match(html, new RegExp(`<a[^>]*href="/companies/company-1/expenses/signatures\\?fromClaim=${ids.request}"[^>]*>ไปหน้าลายเซ็น</a>`, 'u'));
    const panel = require('../expenses/ExpensesWorkspacePanels') as typeof import('../expenses/ExpensesWorkspacePanels');
    assert.equal(panel.signatureReturnText(false), 'เมื่อบันทึกลายเซ็นแล้ว กลับไปกดลงนามในใบเบิกได้ทันที');
    assert.equal(panel.signatureReturnText(true), 'ลายเซ็นของคุณพร้อมใช้แล้ว กลับไปกดลงนามในใบเบิกได้เลย');
    // Only a plain id is taken from the address, and only ever as the last part of this company's own claim page.
    assert.equal(panel.RETURN_CLAIM_ID.test(ids.request), true);
    for (const other of ['', 'a/b', '../settings', 'https://example.com', 'x'.repeat(65), 'claim 1', 'claim?x=1']) assert.equal(panel.RETURN_CLAIM_ID.test(other), false, other);
    const source = readFileSync(join(__dirname, '../expenses/ExpensesWorkspacePanels.tsx'), 'utf8');
    assert.match(source, /setFromClaimId\(RETURN_CLAIM_ID\.test\(id\) \? id : ''\);/);
    assert.match(source, /href=\{`\/companies\/\$\{companyId\}\/reimbursements\/\$\{fromClaimId\}#reimbursement-signatures`\}/);
    assert.match(source, /className=\{cx\(current \? btnClass : ghostClass, 'mt-2 min-h-11 w-full sm:w-auto'\)\}>\s+กลับไปที่ใบเบิก/);
  });

  // Seen in the real look: the dialog opened under a red error toast that said the same thing in other words.
  it('is the one answer to that refusal: the sign call leaves it to the page, with no error toast beside the dialog', () => {
    const api = readFileSync(join(__dirname, 'reimbursements.api.ts'), 'utf8');
    assert.match(api, /claim-form\/signatures`, \{ method: 'POST', body: JSON\.stringify\(body\), suppressErrorToast: true \}\)/);
    // The page still answers every refusal of a signature: this dialog, or the banner of its step card.
    const page = readFileSync(join(__dirname, 'ReimbursementJourneyPage.tsx'), 'utf8');
    assert.match(page, /if \(!isMissingSavedSignatureError\(e\)\) return false; setMissingSignatureFor\(roles\[0\] \?\? null\); return true;/);
    assert.match(page, /dialogOpened = handled\?\.\(e\) \?\? false;\s+if \(!dialogOpened\) setActionError\(errorText\(e\)\);/);
  });
});

// Seen in the real look: an approver whose claim was edited after it was sent got the dialog that says so, under a red
// toast that said "ข้อมูลใบเบิกที่ใช้อนุมัติไม่ครบ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง": another reason, and another thing to do.
describe('a refused approval gets one answer, from the screen that asked (owner 2026-10-02)', () => {
  it('leaves the refusal to the claim page and the approval queue, which answer every one, with no error toast beside them', () => {
    const api = readFileSync(join(__dirname, 'reimbursements.api.ts'), 'utf8');
    assert.match(api, /\/approve`, \{\s+method: 'POST', body: JSON\.stringify\(\{ comment, approvalSnapshotHash, payoutVerifiedVersion \}\), suppressErrorToast: true,\s+\}\)/);
    // The queue: the dialog of a claim edited after it was sent, or its own banner. Both of its approvals.
    const hub = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
    assert.match(hub, /if \(isStaleApprovalError\(e\)\) \{\s+try \{\s+setStaleReview\(\{ row: r, detail: await getReimbursement\(companyId, r\.id\) \}\);\s+\} catch \(e2\) \{ setError\(err\(e2\)\); \}\s+\} else \{/);
    // A refusal of any other kind: the claim moved on while the queue was open. The queue is read again, and the banner
    // says what was refused above the claims as they are now (seen in the real look: the cancelled claim's card stayed, with its buttons).
    assert.match(hub, /\} else \{\s+const failure = err\(e\);\s+await load\(\);\s+setError\(failure\);\s+\}/);
    assert.equal((hub.match(/try \{ await fn\(\); \} catch \(e\) \{ failure = err\(e\); \}\s+await load\(\);\s+if \(failure\) setError\(failure\);/g) ?? []).length, 2, 'the approval queue and the pay queue');
    assert.match(hub, /toast\.success\('อนุมัติคำขอเรียบร้อยแล้ว'\);\s+\} catch \(e\) \{ setError\(err\(e\)\); \}/);
    // Its banner is brought into view (the row pressed may be far below it on a phone), except under that dialog, which shows it.
    assert.match(hub, /\{error && <ErrorBanner message=\{error\} focus=\{!staleReview\} \/>\}/);
    assert.match(hub, /<StaleApprovalDialog[\s\S]{0,700}?error=\{error\}/);
    // The words of that dialog, and of the claim screens' own sentence for the refusal: the claim was edited, look again.
    assert.match(readFileSync(join(__dirname, 'ReimbursementDetailSections.tsx'), 'utf8'), /คำขอนี้ถูกแก้ไขหลังจากส่งอนุมัติ กรุณาตรวจสอบข้อมูลล่าสุดก่อนตัดสินใจ/);
    assert.match(errorMessage('stale_approval_snapshot'), /^คำขอถูกแก้ไขหลังส่งอนุมัติ/u);
  });
});

// Owner 2026-10-02: "SLA" is no word a shop owner reads. A claim that waited past the company's deadline reads "เกินกำหนด",
// the words of the notice the server sends for it, and the policy page names the deadline for what it is.
describe('the deadline of a claim is said in plain Thai (owner 2026-10-02)', () => {
  it('marks a claim past it เกินกำหนด in the approval queue: the count, the table row and the phone card', () => {
    const texts = visible(hubTab('approvals', [{ ...queueRow, status: 'PENDING_APPROVAL', approvalActions: { canApprove: true, canReject: true } }]));
    assert.equal(texts.filter((text) => text === 'เกินกำหนด').length, 3);
    for (const text of texts) assert.doesNotMatch(text, /SLA/u);
  });

  it('names the deadline on the policy page, its card and its summary', () => {
    const texts = policySettings({ ...policyForm, slaHours: 24 }, [roleOption('MANAGER', 'Manager', true)]);
    for (const text of ['การเงินและกำหนดเวลา', 'กำหนดเวลาอนุมัติและจ่าย (ชั่วโมง)', 'กำหนดเวลาอนุมัติและจ่าย', '24 ชั่วโมง']) assert.ok(texts.includes(text), text);
    for (const text of texts) assert.doesNotMatch(text, /SLA/u);
    assert.ok(policySettings(policyForm, [roleOption('MANAGER', 'Manager', true)]).includes('ไม่กำหนด'), 'a company that set no deadline');
    // No screen says it anywhere else either: the tab's description, a tooltip, a message.
    assert.equal(claimScreenSources().includes('SLA'), false);
  });
});

// The summary beside the policy form read "≥ 1.00 บาท": a sign where the field and the preview say "ตั้งแต่" in words.
describe('the policy summary says the approval threshold in the words of its field (owner 2026-10-02)', () => {
  it('reads "ตั้งแต่ 1.00 บาท", with no comparison sign anywhere on the policy tab', () => {
    const texts = policySettings(policyForm, [roleOption('MANAGER', 'Manager', true)]);
    assert.ok(texts.includes('ตั้งแต่ 1.00 บาท'), JSON.stringify(texts.filter((text) => text.includes('บาท'))));
    for (const text of texts) assert.doesNotMatch(text, /[≥≤<>]/u, text);
  });
});

// The same claim as `paid`, on the default route: approved, then paid by whoever holds the pay right.
const noFinance = { ...paid, financeReviewStatus: 'NOT_REQUIRED', financeReviewRequired: false, financeReviewedByName: undefined, financeReviewedAt: undefined };
const waiting = { ...noFinance, status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', documentSignedVia: null, payments: [], signatures: [], signedCopies: [],
  currentDesk: { kind: 'PAYMENT' }, paymentDesk: { names: ['สมชาย', 'วิชัย'], moreCount: 0 } };

describe('a claim with no finance-review step never says ฝ่ายการเงิน (spec §18.3, AC39)', () => {
  it('names who records the payment in the claim timeline instead', () => {
    const texts = visible(detailSections(waiting, ids.requester, []));
    // Before: "กำลังรอฝ่ายการเงินบันทึกจ่าย", in a shop that has no finance desk.
    assert.ok(texts.includes('กำลังรอ สมชาย หรือ วิชัย บันทึกจ่าย'));
    assert.ok(visible(detailSections({ ...waiting, paymentDesk: undefined }, ids.requester, [])).includes('กำลังรอผู้มีสิทธิ์บันทึกจ่าย'));
    for (const [state, detail] of [['draft', { ...draft, financeReviewRequired: false }], ['waiting for payment', waiting], ['paid', noFinance]] as const) {
      for (const text of visible(detailSections(detail, ids.requester, []))) assert.doesNotMatch(text, /ฝ่ายการเงิน/u, state);
    }
    // A claim that does pass finance review keeps its finance rows. The row of a review that was done says what was done
    // and by whom, in the name of the step: whoever reviewed may be the owner or the claim's approver, not a department.
    assert.ok(visible(detailSections(paid, ids.requester, [])).includes('ตรวจการเงินแล้ว โดย สมศรี การเงิน'));
    assert.equal(visible(detailSections(paid, ids.requester, [])).some((text) => text.startsWith('ฝ่ายการเงินตรวจแล้ว')), false);
    assert.ok(visible(detailSections({ ...draft, financeReviewRequired: true }, ids.requester, [])).includes('รอฝ่ายการเงินตรวจ'));
  });

  // Seen in the real look: every claim of a company with no finance-review step read "ตรวจสอบการเงิน: ไม่ต้องตรวจ" in its
  // card of facts, a row about a review that company does not have. The hub's pay queue already leaves that column out.
  it('has no row about a finance review in the facts of a claim that passes none, under any name', () => {
    for (const [state, detail] of [['draft', { ...draft, financeReviewRequired: false }], ['waiting for payment', waiting], ['paid', noFinance]] as const) {
      const texts = visible(detailSections(detail, ids.requester, []));
      for (const text of texts) assert.doesNotMatch(text, /การเงิน|ไม่ต้องตรวจ/u, `${state}: ${text}`);
    }
    // A claim that does pass the review says where it stands, under the name the step and the queue use.
    const reviewed = visible(detailSections(paid, ids.requester, []));
    for (const text of ['ตรวจการเงิน', 'อนุมัติจ่าย', 'ผู้ตรวจการเงิน', 'สมศรี การเงิน']) assert.ok(reviewed.includes(text), `${text}: ${JSON.stringify(reviewed.filter((shown) => shown.includes('ตรวจ')))}`);
    assert.equal(reviewed.includes('ตรวจสอบการเงิน'), false, 'one name for the step');
  });
});

// Review follow-up 2026-10-01: the model's `currentDeskText` was tested, but nothing held the claim page to passing it
// the detail's `paymentDesk`. The page is rendered here with the claim already loaded.
describe('the claim page says "อยู่ที่" with the people who can record the payment (spec §18.3)', () => {
  /** The journey page with `detail` loaded: its claim is the page's second null state, after the confirm dialog's. */
  const claimPage = (detail: object) => {
    let nulls = 0;
    return renderWithState(h(AppRouterContext.Provider, { value: router }, h(ToastContext.Provider, { value: toast },
      h(ReimbursementJourneyPage, { companyId: 'company-1', requestId: ids.request, userId: ids.requester, permissions: ['reimbursement.read_own'] }))),
    (initial) => (initial === null && ++nulls === 2 ? detail : undefined));
  };
  const deskLine = (detail: object) => visible(claimPage(detail)).filter((text) => text.startsWith('อยู่ที่'));

  it('names them from the detail\'s paymentDesk, and prints the pool label when the detail names nobody', () => {
    assert.ok(visible(claimPage(waiting)).includes('RB-202609-00007'), 'the claim rendered');
    // Before the page passed `paymentDesk` on, this line said "ผู้มีสิทธิ์บันทึกจ่าย" whoever could pay.
    assert.deepEqual(deskLine(waiting), ['อยู่ที่ สมชาย หรือ วิชัย']);
    assert.deepEqual(deskLine({ ...waiting, paymentDesk: { names: ['สมชาย', 'วิชัย', 'มานี', 'ปิติ', 'สุดา'], moreCount: 2 } }),
      ['อยู่ที่ สมชาย หรือ วิชัย หรือ มานี หรือ ปิติ หรือ สุดา และอีก 2 คน']);
    // No list (a claim nobody can pay: part paid, or with no branch) and an empty list both fall back to the pool.
    for (const paymentDesk of [undefined, { names: [], moreCount: 0 }]) {
      assert.deepEqual(deskLine({ ...waiting, paymentDesk }), ['อยู่ที่ ผู้มีสิทธิ์บันทึกจ่าย']);
    }
    assert.deepEqual(deskLine({ ...waiting, status: 'PARTIALLY_PAID', paymentStatus: 'PARTIALLY_PAID', paymentDesk: undefined }), ['อยู่ที่ ผู้มีสิทธิ์บันทึกจ่าย']);
    // The same party as the step note and the timeline row of the same claim.
    const texts = visible(claimPage(waiting));
    assert.ok(texts.includes('รอ สมชาย หรือ วิชัย บันทึกจ่าย'), 'step note');
    assert.ok(texts.includes('กำลังรอ สมชาย หรือ วิชัย บันทึกจ่าย'), 'timeline row');
    const pool = visible(claimPage({ ...waiting, paymentDesk: undefined }));
    assert.ok(pool.includes('รอผู้มีสิทธิ์บันทึกจ่าย') && pool.includes('กำลังรอผู้มีสิทธิ์บันทึกจ่าย'));
    // The payers belong to the payment desk only: an approval desk keeps its own names, a finished claim has no line.
    assert.deepEqual(deskLine({ ...waiting, status: 'PENDING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['สมศรี'] } }), ['อยู่ที่ สมศรี']);
    assert.deepEqual(deskLine(paid), []);
  });

  // Payout Phase 1 on the same page: the claim's own account, masked, with who can record its payment.
  it('shows the claim\'s frozen payout account, masked, on the page that names who can pay it', () => {
    const frozen = { ...waiting, payoutMethod: 'BANK_TRANSFER', payout: { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย',
      accountName: 'พิม ใจดี', accountLast4: '6789', version: 1, source: 'DEFAULT_ACCOUNT' } };
    const texts = visible(claimPage(frozen));
    assert.deepEqual(deskLine(frozen), ['อยู่ที่ สมชาย หรือ วิชัย']);
    for (const text of ['การรับเงินคืน', 'โอนเข้าบัญชี', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789', 'ยังไม่มีผู้ตรวจบัญชีนี้']) assert.ok(texts.includes(text), text);
    // The detail did not say this viewer may see the number, so the page offers no way to it.
    assert.equal(texts.includes('แสดงเลขบัญชี'), false);
    assert.ok(visible(claimPage({ ...frozen, payout: { ...frozen.payout, canRevealAccountNumber: true } })).includes('แสดงเลขบัญชี'));
    // The same claim sent before claims carried an account says so instead, and the desk line is unchanged.
    assert.ok(visible(claimPage(waiting)).includes('ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ'));
  });
});

// The same claim through a payout account correction round (payout spec §14), with every code the API may grow: a
// reason, a phase and a kind of event added later print nothing machine-shaped either.
const correctionEvents = [
  { kind: 'SENT_BACK', at: '2026-09-28T03:00:00.000Z', byUserId: ids.approver, byName: 'สมชาย', reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าไม่พบบัญชีนี้' },
  { kind: 'ACCOUNT_SUBMITTED', at: '2026-09-28T04:00:00.000Z', byUserId: ids.requester, byName: 'พิม ใจดี', payoutMethod: 'BANK_TRANSFER', payoutVersion: 2 },
  { kind: 'REAPPROVED', at: '2026-09-28T05:00:00.000Z', byUserId: ids.approver, byName: 'สมชาย', approvalStepId: ids.step },
  { kind: 'SENT_BACK', at: '2026-09-28T06:00:00.000Z', byUserId: ids.other, reasonCode: 'A_REASON_ADDED_LATER' },
  { kind: 'A_KIND_ADDED_LATER', at: '2026-09-28T07:00:00.000Z', byUserId: ids.other },
];
const inRound = { ...waiting, status: 'PENDING_APPROVAL', paymentStatus: 'NOT_PAYABLE', approvedAt: undefined, paymentDesk: undefined, payoutMethod: 'BANK_TRANSFER',
  payout: { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'พิม ใจดี', accountLast4: '6789', version: 2, source: 'REQUESTER' },
  approvalSteps: [{ ...paid.approvalSteps[0]!, invalidatedAt: '2026-09-28T03:00:00.000Z', invalidatedReason: 'payout_account_correction' }],
  signedCopies: [{ attachmentId: ids.copy, fileName: 'ใบเบิกที่เซ็นแล้ว.pdf', uploadedAt: '2026-09-27T06:00:00.000Z', beforePayoutCorrection: true }],
  payoutCorrectionHistory: correctionEvents };
const correctionDetails: Array<[string, object]> = [
  ['in a round, waiting for the requester', { ...inRound, payoutCorrectionPhase: 'AWAITING_REQUESTER', currentDesk: { kind: 'REQUESTER' } }],
  ['in a round, the new account waiting', { ...inRound, payoutCorrectionPhase: 'AWAITING_APPROVAL', currentDesk: { kind: 'APPROVER', names: ['สมชาย'] } }],
  ['in a round, a phase added later', { ...inRound, payoutCorrectionPhase: 'A_PHASE_ADDED_LATER', currentDesk: { kind: 'APPROVER' } }],
  ['after a round', { ...waiting, payoutCorrectionHistory: correctionEvents.slice(0, 3), signedCopies: inRound.signedCopies }],
];

// Owner 2026-10-02: one thing has one name. The requester was also "ผู้ขอ", "ผู้ยื่น" and "ผู้สำรองจ่ายและรับเงินคืน", the admin
// role names now come from the shared standard-role list, and messages gave the policy tab and its self-approval switch names the hub never printed.
describe('one thing has one name on the claim screens (owner 2026-10-02)', () => {
  const screens = claimScreenSources();

  it('uses no second name for the requester, the admin role, the policy tab or its self-approval switch', () => {
    assert.ok(screens.includes('ผู้เบิก') && screens.includes('THAI_SYSTEM_ROLE_NAMES') && screens.includes('POLICY_TAB_LABEL') && REIMBURSEMENT_POLICY_TAB_LABEL === 'ตั้งค่านโยบาย', 'the screens were read');
    for (const retired of ['ผู้ขอ', 'ผู้ยื่น', 'ผู้รับเงินคืน', 'ผู้สำรองจ่ายและรับเงินคืน', 'แอดมิน', 'ตั้งค่าเบิกจ่าย', 'อนุญาตให้อนุมัติคำขอตนเอง']) {
      assert.equal(screens.includes(retired), false, retired);
    }
    // The sentences the API's refusals are said in, for the codes of a claim that name one of them.
    for (const code of ['reimbursement_source_payer_unlinked', 'reimbursement_source_wrong_payer', 'reimbursement_requester_unavailable', 'invalid_primary_attachment',
      'invalid_linked_expense', 'payout_account_edit_denied', 'reimbursement_policy_inactive', 'self_approval_denied']) {
      assert.doesNotMatch(errorMessage(code), /ผู้ขอ|ผู้ยื่น|ผู้รับเงินคืน|แอดมิน|ตั้งค่าเบิกจ่าย|คำขอตนเอง"/u, code);
    }
  });

  // Seen in the real look: the role page listed the claim rights under "ขอเงินคืน", a name no menu or screen uses for claims.
  it('names the claims module on the role page as the menu and the hub do', () => {
    const rolePage = readFileSync(join(__dirname, '../employee-access/EmployeeAccessPages.tsx'), 'utf8');
    assert.match(rolePage, /reimbursement: 'การเบิกจ่าย'/);
    assert.equal(rolePage.includes('ขอเงินคืน'), false);
    assert.match(readFileSync(join(__dirname, '../../common/i18n/workspace-dictionary.ts'), 'utf8'), /'module\.reimbursements': 'การเบิกจ่าย'/);
  });
});

const MACHINE_TOKENS: Array<[string, RegExp]> = [ // ReimbursementDraftActionPage.qa.spec.ts's set
  ['cuid/uuid/hash-like id', /\b[a-z0-9]{20,}\b|[0-9a-f]{8}-[0-9a-f]{4}-/iu], ['enum or code', /[A-Z_]{4,}/u],
  ['field path', /\w+\.\d+\.\w+|\b[a-zA-Z]\w*\.(?:\d|[a-z]\w*\b)/u], ['camelCase key', /\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u],
  ['ISO date', /\d{4}-\d{2}-\d{2}/u], ['3+ decimal amount', /\d\.\d{3,}/u], ['category key or currency code', /\b(?:travel|meals|supplies|accommodation|other|THB)\b/u],
  ['raw JSON', /[{}[\]"]/u],
];

describe('no customer-visible claim page text carries a machine token (Owner rule 2026-09-27/29)', () => {
  it('holds for the detail, dialog, hub queues and create form in every state', () => {
    const pages: Array<[string, string]> = [
      ['source facts: bill', renderToStaticMarkup(h(ReimbursementSourceFacts, { source: bill }))],
      ['source facts: substitute receipt', renderToStaticMarkup(h(ReimbursementSourceFacts, { source: substitute }))],
      ['detail: LINE-made draft', detailSections(draft, ids.requester, ['reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own'])],
      ['detail: paid, signed on paper', detailSections(paid, ids.requester, ['reimbursement.payment.void', 'reimbursement.finance_review'])],
      ['detail: enums added later', detailSections(later, ids.approver, [])],
      ['detail: waiting for payment, payers named', detailSections(waiting, ids.approver, [])],
      ['stale-approval dialog', staleDialog({ ...draft, status: 'PENDING_APPROVAL', amount: '1234.5000', lineCount: 1 }, { ...paid, status: 'PENDING_APPROVAL' })],
      ['stale-approval dialog: enums added later, LINE-made lines', staleDialog({ ...later, lineCount: 1 }, { ...later, lines: draft.lines })],
      ['create form: new claim', renderToStaticMarkup(createPage())],
      ['create form: source picked, rows folded', filledCreatePage()],
      ['create form: rows bound to bills that were refused', filledCreatePage(refusedForm)],
      ...['mine', 'approvals', 'finance'].map((tab): [string, string] => [`hub: ${tab}`, hubTab(tab)]),
      ['hub: mine, a claim in every state', hubTab('mine', hubClaims)],
      ['hub: mine, claims in a payout account correction round', hubTab('mine', correctionRows)],
      ['hub: approvals, a claim whose new payout account waits', hubTab('approvals', [{ ...correctionRows[1]!, ageHours: 3, slaRisk: false, approvalActions: { canApprove: true, canReject: true } }])],
      ...correctionDetails.map(([state, detail]): [string, string] => [`detail: ${state}`, detailSections(detail, ids.requester, ['reimbursement.update_own_draft', 'reimbursement.payment.record'])]),
    ];
    let checked = 0;
    for (const [page, html] of pages) {
      for (const raw of visible(html)) {
        // "LINE" is the app's name; JPEG/HEIC/HEIF name the file types a person picks.
        const shown = DOCUMENT_NUMBERS.reduce((text, number) => text.replaceAll(number, ''), raw).replace(/\b(?:LINE|JPEG|HEIC|HEIF)\b/gu, '');
        for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name} on ${page}: ${raw}`);
        checked += 1;
      }
    }
    assert.ok(checked > 300, `only ${checked} texts rendered`);
  });
});

describe('claim policy shares the employee and role-page names', () => {
  it('renders the same Thai label on every surface for every standard role and never prints its stored English name', () => {
    const picker = require('../employee-access/role-picker.logic') as typeof import('../employee-access/role-picker.logic');
    const { CompanySwitcher } = require('../web-core-workspace/WorkspaceScope') as typeof import('../web-core-workspace/WorkspaceScope');
    const switcher = (key: string, name: string) => visible(renderWithState(h(CompanySwitcher, { companyId: 'co', fallbackName: 'บริษัท' }),
      (initial) => Array.isArray(initial) ? [{ companyId: 'co', companyName: 'บริษัท', roles: [key], roleNames: { [key]: name } }, { companyId: 'other', companyName: 'บริษัทอื่น', roles: [] }] : initial === false ? true : undefined));
    const rolePage = require('../employee-access/EmployeeAccessPages') as typeof import('../employee-access/EmployeeAccessPages');
    const builderName = (key: string, name: string) => renderToStaticMarkup(h(rolePage.RoleBuilder, {
      companyId: 'co', packModules: [], allPacks: [], templates: [], roleOptionsAvailable: true,
      initial: { key, name, isSystem: false, permissionKeys: [] }, onCancel: noop, onSubmit: async () => undefined,
    })).match(/<input[^>]*value="([^"]*)"/)?.[1];
    const stored = { OWNER: 'Owner', SYSTEM_ADMIN: 'System Admin', COMPANY_VIEW: 'Company owner', ADMIN: 'Admin',
      MANAGER: 'Manager', HR: 'HR', SALES: 'Sales', INVENTORY: 'Inventory', FINANCE: 'Finance', ACCOUNTANT: 'Accountant',
      MARKETING: 'Marketing', STAFF: 'Staff', AUDITOR_READONLY: 'Auditor (Read-only)', MANGMEE_SALES_LEAD: 'Mangmee Sales Lead', MANGMEE_SALES: 'Mangmee Sales' };
    for (const [key, name] of Object.entries(stored)) {
      const expected = picker.roleKeyDisplayName(key);
      assert.equal(builderName(key, name), expected, `editor ${key}`);
      assert.ok(switcher(key, name).includes(expected), `switcher ${key}`);
      assert.doesNotMatch(expected, /[A-Za-z_]/u, key);
      for (const isSystem of [true, false]) {
        const role = { key, name, isSystem };
        assert.equal(picker.roleDisplayName(role), expected, key);
        assert.equal(rolePage.roleDisplayName(role, 'th'), expected, key);
      }
      const texts = policySettings({ ...policyForm, defaultApproverRoles: [key] }, [roleOption(key, name, false)]);
      assert.ok(texts.includes(expected), `${key}: ${texts.join(' | ')}`);
      assert.ok(texts.some((text) => text.includes(`บทบาท ${expected} อนุมัติได้ แต่บันทึกจ่ายไม่ได้`)), key);
      assert.equal(texts.includes(name), false, key);
    }
    for (const key of ['ADMIN', 'ACCOUNTANT', 'AUDITOR_READONLY', 'CUSTOM']) {
      const texts = policySettings({ ...policyForm, defaultApproverRoles: [key] }, [roleOption(key, 'ผู้ตรวจประจำบริษัท', false)]);
      assert.equal(builderName(key, 'ผู้ตรวจประจำบริษัท'), 'ผู้ตรวจประจำบริษัท', `editor ${key}`);
      assert.ok(switcher(key, 'ผู้ตรวจประจำบริษัท').includes('ผู้ตรวจประจำบริษัท'), `switcher ${key}`);
      assert.ok(texts.includes('ผู้ตรวจประจำบริษัท'), key);
      assert.ok(texts.some((text) => text.includes('บทบาท ผู้ตรวจประจำบริษัท อนุมัติได้ แต่บันทึกจ่ายไม่ได้')), key);
    }
  });
});

describe('claims self-approval policy words', () => {
  it('explains the switch for all roles, the solo exception, and the frozen submitted route', () => {
    const texts = policySettings(policyForm, [roleOption('MANAGER', 'ผู้จัดการ', true)]);
    assert.ok(texts.includes('เมื่อเปิด ผู้อนุมัติที่ได้รับมอบหมายอนุมัติใบเบิกของตัวเองได้ เมื่อปิด ไม่มีใครอนุมัติใบเบิกของตัวเองได้ไม่ว่าบทบาทใด ยกเว้นเมื่อตอนส่ง ผู้เบิกเป็นคนเดียวที่อนุมัติใบนี้ได้ ใบที่ส่งไปแล้วใช้ผู้อนุมัติตามที่กำหนดไว้ตอนส่ง'));
  });
});


it('both pay-queue layouts reuse the same duplicate reason and clearing notice as the payment refusal', () => {
  const source = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
  assert.equal((source.match(/reimbursementDuplicateBlockNotice\(r\.duplicateReasons, r\.status === 'FINANCE_REVIEW'\)/g) ?? []).length, 2);
});

it('duplicate-clear success says the review was recorded without promising every blocker is gone', () => {
  const source = readFileSync(join(__dirname, 'ReimbursementJourneyPage.tsx'), 'utf8');
  assert.match(source, /success: REIMBURSEMENT_DUPLICATE_RESOLUTION_SAVED/);
});
