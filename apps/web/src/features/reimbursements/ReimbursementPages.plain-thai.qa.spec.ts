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
require.extensions['.css'] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }; };
require.extensions['.svg'] = (module) => { module.exports = () => null; };
require.extensions['.css'] = module => { module.exports = { menu: 'menu', panel: 'panel' }; };
// Modal portals into document.body, which a server render has none of: render the dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const sections = require('./ReimbursementDetailSections') as typeof import('./ReimbursementDetailSections');
const { ReimbursementCreatePage } = require('./ReimbursementCreatePage') as typeof import('./ReimbursementCreatePage');
const selectModule = require('@/common/components/field/ThemedSelect');
require.cache[require.resolve('@/common/components/field/ThemedSelect')]!.exports = { ...selectModule,
  ThemedSelect: (props: any) => props['aria-label'] === 'สถานะ' ? React.createElement('select', props, props.children) : React.createElement(selectModule.ThemedSelect, props),
};
const { ReimbursementsHubPage, PolicySettings } = require('./ReimbursementsPages') as typeof import('./ReimbursementsPages');
const { ReimbursementSourceFacts } = require('./ReimbursementSourceFacts') as typeof import('./ReimbursementSourceFacts');
const { ReimbursementJourneyPage } = require('./ReimbursementJourneyPage') as typeof import('./ReimbursementJourneyPage');
const { approvalComparable, diffApprovalFields, draftSentBackNote, errorMessage, hubListKey, reimbursementListScope } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
const model = require('./reimbursements.model') as typeof import('./reimbursements.model');
const reactRuntime = require('react') as typeof React;

for (const [now, yesterday, today, tomorrow] of [
  ['2026-10-04T12:00:00.000Z', '2026-10-03', '2026-10-04', '2026-10-05'],
  ['2026-10-04T17:30:00.000Z', '2026-10-04', '2026-10-05', '2026-10-06'],
]) {
  it(`the payment form caps its calendar at Bangkok today, explains and disables a future paid date at ${now}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now!) });
    const previousDocument = globalThis.document;
    // Open the real calendar in the existing static renderer; no browser or storage is used.
    Object.assign(globalThis, { document: { body: {} } });
    try {
      for (const paidAt of [yesterday, today, tomorrow]) {
        let falseStates = 0;
        const html = renderWithState(React.createElement(ToastContext.Provider, { value: toast }, React.createElement(sections.PaymentForm, {
          companyId: 'company-1', request: { outstandingAmount: '500', currency: 'THB' }, onCancel: noop, onDone: noop, onOpenFile: noop,
        })), (initial) => {
          if (initial && typeof initial === 'object' && 'paidAmount' in initial) return { ...initial, paidAt, paymentMethod: 'CASH' };
          if (initial === false && ++falseStates > 1) return true; // Leave the form idle; open its field popovers.
          return undefined;
        });
        const submit = /<button\b([^>]*\btype="submit"[^>]*)>/.exec(html)?.[1];
        assert.ok(submit, 'payment submit button rendered');
        assert.equal(/\bdisabled=""/.test(submit), paidAt === tomorrow, paidAt);
        assert.equal(html.includes('วันที่จ่ายเงินจริงต้องไม่เกินวันนี้'), paidAt === tomorrow, paidAt);
        for (const [day, blocked] of [[today, false], [tomorrow, true]] as const) {
          const attrs = new RegExp(`<button\\b([^>]*)>${Number(day!.slice(-2))}</button>`).exec(html)?.[1];
          assert.ok(attrs, `calendar day ${day} rendered`);
          assert.equal(/\bdisabled=""/.test(attrs), blocked, `calendar day ${day}`);
        }
      }
    } finally {
      if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
      else globalThis.document = previousDocument;
    }
  });
}

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

const createPage = (props: object = {}) => h(AppRouterContext.Provider, { value: router }, h(ToastContext.Provider, { value: toast },
  h(ReimbursementCreatePage, { companyId: 'company-1', userId: ids.requester, canCreate: true, canPrepareForOthers: true, ...props })));
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
const filledCreatePage = (form: object = filledForm, receiptPolicy = { requireReceipt: true, allowMissingReceiptWithReason: true }) => renderWithState(createPage(), (initial) => {
  if (Array.isArray(initial?.lines)) return form;
  if (Array.isArray(initial?.items)) {
    return { receiptPolicy, requesters: [{ userId: ids.requester, displayName: 'พิม ใจดี' }, { userId: ids.approver, displayName: 'สมชาย' }],
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
  const counts = { all: claims.length, draft: 0, correction: 0, review: 0, payment: 0, duplicate_blocked: 0, paid: 0, closed: 0 };
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
  h(AppRouterContext.Provider, { value: router }, h(SearchParamsContext.Provider, { value: new URLSearchParams(`tab=${tab}&filter=${filter ?? 'all'}`) },
    h(ToastContext.Provider, { value: toast },
      h(ReimbursementsHubPage, { companyId: 'company-1', userId: ids.requester, roles: ['OWNER'],
        permissions: mayReadPolicy ? [...hubPermissions, 'reimbursement.policy.read'] : hubPermissions })))),
  (initial) => (initial && typeof initial === 'object' && 'financeStep' in initial ? (typeof told === 'boolean' ? { companyId: 'company-1', financeStep: told } : undefined)
    : Array.isArray(initial) && initial.length === 0 ? rows
      : Array.isArray(initial?.rows) ? { key: hubListKey('company-1', reimbursementListScope(hubPermissions), filter ?? 'all', 0, 0, search, 'newest'), nextPage: null, ...served(rows, filter), ...held }
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
  ...html.replace(/<span class="text-red-600"(?: aria-hidden="true")?> \*<\/span>/gu, ' *').replace(/<[^>]*>/gu, '\n').split('\n')]
  .map(text => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

describe('claim pages speak plain Thai (Owner rule 2026-09-27/29)', () => {
  it('names a category by its label or says none was chosen, never by its key (detail, dialog, queue, form)', () => {
    const texts = visible(detailSections(draft, ids.requester, ['reimbursement.update_own_draft']));
    assert.equal(texts.filter(text => text === 'ยังไม่ได้เลือกหมวด').length, 2, 'both lines (the claim-level category row went with the card of facts)');
    // The list names a claim by its reason: a row carries no category, so no key of one either.
    for (const text of visible(hubTab('mine'))) assert.doesNotMatch(text, /travel|ยังไม่ได้เลือกหมวด/u);
    assert.ok(visible(filledCreatePage()).includes('ยังไม่ได้เลือกหมวด'), 'the category picker of a row whose key is an id');
    // Before: the queue row had no label; now: the claim's own label, and a blank line label reads as none chosen.
    const dialog = visible(staleDialog({ ...draft, status: 'PENDING_APPROVAL', amount: '1234.5000', lineCount: 1 }, { ...paid, status: 'PENDING_APPROVAL' }));
    for (const text of ['ยังไม่ได้เลือกหมวด', 'หลายหมวด (2 รายการ)', 'เดินทาง']) assert.ok(dialog.includes(text), text);
  });

  it('shows the per-line rounded claim total before saving, in baht', () => {
    const html = filledCreatePage({ ...filledForm, lines: filledForm.lines.map(line => ({ ...line, amount: '10.005' })) });
    assert.match(html, /ยอดรวม/);
    assert.match(html, /20\.02 บาท/);
    assert.doesNotMatch(html, /20\.01/);
  });

  it('shows amounts as "฿1,234.50" and dates in Thai with the Buddhist year', () => {
    const facts = visible(renderToStaticMarkup(h(ReimbursementSourceFacts, { source: bill })));
    for (const text of ['฿380.00', '฿24.86 / ฿0.00', '26 ก.ย. 2569', 'ไม่ได้ระบุ']) assert.ok(facts.includes(text), text);
    const form = visible(filledCreatePage());
    for (const text of ['26 ก.ย. 2569 · ปากกาและแฟ้ม · ฿380.00', '27 ก.ย. 2569 · ค่าแท็กซี่ · ฿1,234.57', 'INV-0042 · ร้านเครื่องเขียนสมใจ · ฿380.00',
      '1,614.57 บาท', 'บาท']) assert.ok(form.includes(text), text);
    // A form of one line shows no total: it repeated the amount typed above it (and "฿0.00" before anything was typed).
    const fresh = visible(renderToStaticMarkup(createPage()));
    assert.equal(fresh.includes('ยอดรวม') || fresh.includes('฿0.00'), false);
    assert.ok(form.includes('ยอดรวม'), 'two lines are added up');
    // An amount is typed as text with the number keypad, with its unit beside it: a typed comma is kept and read.
    assert.match(filledCreatePage(), /<input aria-label="จำนวนเงิน" class="mangmee-input mangmee-input-icon-end text-right tabular-nums"[^>]*type="text" inputMode="decimal"/u);
    const { typedAmount } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
    assert.deepEqual(['1,200.50', ' 1 200 ', '350', ''].map(typedAmount), ['1200.50', '1200', '350', '']);
    assert.ok(visible(filledCreatePage({ ...filledForm, lines: [{ ...filledForm.lines[1]!, amount: '1,234.5' }, filledForm.lines[1]!] })).includes('27 ก.ย. 2569 · ค่าแท็กซี่ · ฿1,234.50'));
    assert.ok(visible(filledCreatePage(refusedForm)).includes('ร้านกาแฟ · ฿95.50 — ค่าใช้จ่ายนี้ถูกใช้เบิกในใบเบิกอื่นอยู่แล้ว'));
    const diff = diffApprovalFields(approvalComparable({ ...draft, amount: '1234.5000', lineCount: 1 }, 1), approvalComparable(paid, 2));
    assert.deepEqual(diff.find(row => row.key === 'amount'), { key: 'amount', label: 'จำนวนเงิน', before: '฿1,234.50', after: '฿1,614.50', changed: true });
    assert.deepEqual(diff.find(row => row.key === 'currency'), { key: 'currency', label: 'สกุลเงิน', before: 'บาท', after: 'บาท', changed: false });
  });
});

describe('the claim lines fit a 390 px phone (Owner, 2026-09-30)', () => {
  it('shows each line as a read-only card where narrow and a table where wide; receipt upload belongs to the items step', () => {
    const html = detailSections(draft, ids.requester, ['reimbursement.update_own_draft']);
    // Before: only the seven-column table, which squeezed Thai text to one letter per row on a phone.
    assert.match(html, /<div class="[^"]*@\[44rem\]:hidden[^"]*" data-testid="reimbursement-line-cards">/u);
    assert.match(html, /<div class="relative hidden overflow-x-auto break-normal @\[44rem\]:block" data-testid="reimbursement-lines-table"><table class="mangmee-table">/u);
    const cardsAt = html.indexOf('data-testid="reimbursement-line-cards"'), tableAt = html.indexOf('data-testid="reimbursement-lines-table"');
    // Not inside mangmee-table-scroll: its max-content cut the amount and receipt columns off a desktop card (2026-10-01).
    assert.doesNotMatch(html.slice(html.lastIndexOf('<section', tableAt), tableAt), /mangmee-table-scroll/u);
    const cards = html.slice(cardsAt, tableAt), table = html.slice(tableAt);
    // The file-type names are each kept whole on screen (one unbreakable span a name); the words read are the shared sentence.
    const cardTexts = visible(cards.replace(/<span class="whitespace-nowrap">([^<]*)<\/span>/gu, '$1'));
    for (const text of ['ค่าแท็กซี่', '1,234.50 บาท', '27 ก.ย. 2569 · ยังไม่ได้เลือกหมวด', 'วัตถุประสงค์: ไปพบลูกค้า',
      'ปากกาและแฟ้ม', '380.00 บาท', '26 ก.ย. 2569 · ยังไม่ได้เลือกหมวด', 'ร้านเครื่องเขียนสมใจ', 'รวมเป็นเงิน', '1,614.50 บาท']) assert.ok(cardTexts.includes(text), text);
    // The typed line takes a receipt upload; the line picked from a saved bill keeps that bill's files instead.
    assert.doesNotMatch(cards, /type="file"/u);
    assert.doesNotMatch(table, /type="file"/u);
    assert.ok(visible(table).includes('ใบเสร็จ'), 'the table keeps its receipt column');
    assert.ok(visible(detailSections(paid, ids.requester, [])).includes('27 ก.ย. 2569 · เดินทาง'), 'a card names the line category by its label');
  });
});

// 2026-10-13: the four tiles above the list repeated its filter (and added paid, refused and cancelled claims into one
// "ยอดรวมที่ขอเบิก"). The filter alone counts now: the shared filter tabs, one row that scrolls inside itself on a phone.
describe('the hub filter counts what it shows (spec §18.1, AC38)', () => {
  /** The markup inside the element marked `from`, up to the tag that carries `to`. */
  const between = (html: string, from: string, to: string) => html.slice(html.indexOf('>', html.indexOf(from)) + 1, html.lastIndexOf('<', html.indexOf(to)));
  const chipsOf = (html: string) => between(html, 'data-testid="reimbursements-mine-filters"', 'type="search"');
  /** Label → the number on it, one entry per chip (the number comes last). */
  const numbers = (html: string) => Object.fromEntries([...html.matchAll(/<option\b[^>]*>(.*?) \((\d+)\)<\/option>/gsu)].map(([, label, count]) => [label, count]));
  const rowsShown = (html: string) => html.match(/data-testid="reimbursements-mine-card"/gu)?.length ?? 0;
  /** What the list itself says, in its table and its stacked rows: without the tabs and the filter above it, which use the same words. */
  const listOf = (html: string) => visible(html.slice(html.indexOf('>', html.indexOf('data-testid="reimbursements-mine-table"')) + 1));
  /** The facts of the one line above a queue, each kept whole. */
  const factsOf = (html: string) => {
    const at = html.indexOf('<div class="text-sm text-gray-700" role="status">');
    return [...html.slice(at, html.indexOf('</div>', at)).matchAll(/<span class="mangmee-unit[^"]*">([^<]*)<\/span>/gu)].map(([, text]) => text!);
  };

  it('Round 4: the duplicate chip keeps blocked rows visible, and the payable filter matches its count', () => {
    const blocked = { ...hubClaims.find((row) => row.status === 'READY_FOR_PAYMENT'), id: 'blocked', hasDuplicateBlocker: true };
    const claims = [...hubClaims, blocked];
    assert.equal(numbers(chipsOf(hubTab('mine', claims)))['ติดรายการซ้ำ'], '1');
    assert.equal(rowsShown(hubTab('mine', claims, 'duplicate_blocked')), 1);
    assert.equal(rowsShown(hubTab('mine', claims, 'payment')), 2);
    assert.equal(numbers(chipsOf(hubTab('mine', hubClaims)))['ติดรายการซ้ำ'], undefined);
  });

  it('Round 4: each queue says in one line how many rows it lists and how much, with what is held or late beside it', () => {
    const payable = { ...queueRow, status: 'READY_FOR_PAYMENT', hasDuplicateBlocker: false, amount: '100.00' };
    const blocked = { ...payable, id: 'blocked', amount: '900.00', hasDuplicateBlocker: true };
    for (const tab of ['finance', 'approvals']) {
      const html = hubTab(tab, [payable, blocked], undefined, {}, '', false);
      assert.match(html, /ยอดรวม 1,000.00 บาท/);
      assert.match(html, /ใบเบิก/); assert.match(html, /รออนุมัติ/); assert.match(html, /รอจ่าย/);
      assert.doesNotMatch(html, /฿|รอจ่าย 2 ใบ|รอคุณอนุมัติ 2 ใบ/);
    }
  });

  it('splits claims waiting for payment from those waiting for approval, and every number is its list', () => {
    const html = hubTab('mine', hubClaims);
    // Before: ใบเบิกทั้งหมด 7 and รออนุมัติ/ตรวจสอบ 3 (the two approved claims counted as waiting for approval).
    const chips = numbers(chipsOf(html));
    assert.deepEqual(chips, { 'ทั้งหมด': '7', 'ร่าง': '1', 'ต้องแก้ไข': '1', 'รออนุมัติ/ตรวจสอบ': '1', 'รอจ่าย': '2', 'จ่ายแล้ว': '1', 'ยกเลิก': '1' });
    assert.equal(rowsShown(html), 7);
    // No tile, and no total that adds paid, refused and cancelled claims together.
    assert.doesNotMatch(html, /reimbursements-mine-summary/u);
    for (const text of visible(html)) assert.doesNotMatch(text, /ยอดรวมที่ขอเบิก|ร่างรอส่ง|รอจ่ายเงินคืน/u);
    // A filter tapped shows exactly the claims it counted, and is the one marked as chosen.
    for (const [filter, chip] of [['draft', 'ร่าง'], ['review', 'รออนุมัติ/ตรวจสอบ'], ['payment', 'รอจ่าย'], ['paid', 'จ่ายแล้ว'], ['closed', 'ยกเลิก']] as const) {
      const filtered = hubTab('mine', hubClaims, filter);
      assert.equal(String(rowsShown(filtered)), chips[chip], filter);
      assert.match(chipsOf(filtered), new RegExp(`<option[^>]*value="${filter}"[^>]*selected=""`), filter);
    }
    assert.equal(Object.entries(chips).reduce((sum, [label, count]) => sum + (label === 'ทั้งหมด' ? 0 : Number(count)), 0), 7);
  });

  // Payout spec §14.2: a claim sent back for its payout account is PENDING_APPROVAL and, while its requester gives the
  // account, with its requester. The server counts it under รออนุมัติ/ตรวจสอบ; its row must not read as a draft, or as
  // waiting for an approver nobody waits for.
  it('shows a claim in a payout account correction round where the server counts it, with its phase and whom it waits for', () => {
    const claims = [...hubClaims, ...correctionRows];
    const html = hubTab('mine', claims);
    assert.deepEqual([numbers(chipsOf(html))['ร่าง'], numbers(chipsOf(html))['รออนุมัติ/ตรวจสอบ']], ['1', '3']);
    const review = hubTab('mine', claims, 'review');
    assert.equal(rowsShown(review), 3);
    const texts = listOf(review);
    // The badge of each row, in the table and in its stacked row: the phase, never the bare status of a claim in a round.
    for (const label of ['รอผู้เบิกแก้บัญชีรับเงิน', 'รออนุมัติบัญชีรับเงินใหม่']) assert.equal(texts.filter((text) => text === label).length, 2, label);
    assert.equal(texts.filter((text) => text === 'รออนุมัติ').length, 2, 'the one claim that waits for its first approval');
    // "อยู่ที่" under each row, in both layouts: the requester in the badge's own word, then the approvers by name.
    const desks = ['อยู่ที่ ผู้มีสิทธิ์อนุมัติ', 'อยู่ที่ ผู้เบิก', 'อยู่ที่ สมชาย'];
    assert.deepEqual(texts.filter((text) => text.startsWith('อยู่ที่')), [], 'one badge replaces the separate desk line');
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
    const texts = listOf(hubTab('mine', rows, 'review'));
    assert.equal(rowsShown(hubTab('mine', rows, 'review')), cases.length);
    // In the table and in the stacked row of each claim.
    for (const [, , label] of cases) assert.equal(texts.filter((text) => text === label).length, 2, label);
    for (const untrue of ['รอผู้เบิกแก้บัญชีรับเงิน', 'รออนุมัติบัญชีรับเงินใหม่', 'รออนุมัติ']) assert.equal(texts.includes(untrue), false, untrue);
    for (const text of texts) for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(text.replaceAll('RB-202609-00007', ''), pattern, `${name}: ${text}`);
  });

  it('filters with the shared filter tabs: one row that scrolls inside itself on a phone, compact tabs from 640 px', () => {
    const html = hubTab('mine', hubClaims, 'payment');
    assert.match(chipsOf(html), /<select[^>]*aria-label="สถานะ"/);
    assert.match(chipsOf(html), /<option value="payment" selected="">รอจ่าย \(2\)<\/option>/);
    assert.doesNotMatch(chipsOf(html), /aria-pressed|ติดรายการซ้ำ/);
    assert.deepEqual(Object.keys(numbers(chipsOf(html))), ['ทั้งหมด', 'ร่าง', 'ต้องแก้ไข', 'รออนุมัติ/ตรวจสอบ', 'รอจ่าย', 'จ่ายแล้ว', 'ยกเลิก']);
  });
});

describe('the hub takes its list lazily and says when a page did not load (review follow-up 2026-10-01)', () => {
  const rowsShown = (html: string) => html.match(/data-testid="reimbursements-mine-card"/gu)?.length ?? 0;
  /** The number on each of the eight filter chips, in their order. */
  const chipNumbers = (html: string) => [...html.slice(html.indexOf('data-testid="reimbursements-mine-filters"'), html.indexOf('type="search"'))
    .matchAll(/<option\b[^>]*>.*? \((\d+)\)<\/option>/gsu)].map(([, count]) => count);
  const reason = 'เชื่อมต่อระบบไม่ได้ ลองอีกครั้งอีกครั้ง';
  // A shop with 230 claims waiting for payment: the first answer carries 100 rows and the counts of all 230.
  const many = Array.from({ length: 100 }, (_, index) => ({ ...draft, id: `${ids.request}${index}`, requestNo: 'RB-202609-00007', status: 'READY_FOR_PAYMENT',
    amount: '100.0000', currentDesk: { kind: 'PAYMENT' } }));
  const of230 = { total: 230, nextPage: 2, summary: { counts: { all: 230, draft: 0, correction: 0, review: 0, payment: 230, duplicate_blocked: 0, paid: 0, closed: 0 }, totalAmount: '23000.0000', blockedDraftCount: 0 } };

  it('shows the filter counts of the whole scope from the first page, with only that page of rows held', () => {
    // Before: the hub walked every page before it showed anything, and counted the rows it had loaded.
    const html = hubTab('mine', many, undefined, of230);
    const texts = visible(html);
    assert.deepEqual(chipNumbers(html), ['230', '230']);
    // Ten rows a table page, out of the server's 230: the pager counts the whole list, not the rows held.
    assert.equal(rowsShown(html), 10);
    assert.ok(texts.includes('หน้า 1 จาก 23'), texts.filter((text) => text.includes('แสดง')).join(' | '));
    // Under the รอจ่าย filter the list is the server's 230, the number on its chip.
    const filtered = hubTab('mine', many, 'payment', of230);
    assert.deepEqual(chipNumbers(filtered), ['230', '230']);
    assert.ok(visible(filtered).includes('หน้า 1 จาก 23'));
    // A list of one page has no pager: its rows are all there to see.
    assert.equal(visible(hubTab('mine', hubClaims)).some((text) => text.startsWith('แสดง ')), false);
  });

  it('keeps the counts on the filter while another filter\'s rows are on their way, and shows none of the rows held before', () => {
    // First load: nothing to count yet.
    const first = visible(hubTab('mine', [], undefined, { summary: null, nextPage: 1 }));
    assert.ok(first.includes('กำลังโหลด...'));
    assert.equal(first.includes('ร่าง'), false);
    // A filter was tapped and its first page has not arrived: the counts stay, the old rows do not.
    const switching = hubTab('mine', hubClaims, undefined, { key: 'the list held before the tap' });
    assert.equal(rowsShown(switching), 0);
    assert.deepEqual(chipNumbers(switching), ['7', '1', '1', '1', '2', '1', '1']);
    const texts = visible(switching);
    assert.ok(texts.includes('กำลังโหลด...') && texts.includes('กำลังโหลดรายการ...'));
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีใบเบิก|ไม่พบใบเบิก/u);
  });

  it('shows the failure with a retry instead of "ยังไม่มีใบเบิก" when the first page fails', () => {
    // Before: the error banner sat above an empty state that told the person they had no claims.
    const texts = visible(hubTab('mine', [], undefined, { summary: null, nextPage: 1, failed: reason }));
    assert.ok(texts.includes(`⚠ โหลดรายการไม่สำเร็จ · ${reason}`), texts.join(' | '));
    assert.ok(texts.includes('ลองอีกครั้ง'));
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีใบเบิก|กำลังโหลด/u);
    // A scope that really is empty still says so, with no failure in sight, and with the way to make the first claim.
    const empty = visible(hubTab('mine', []));
    assert.ok(empty.includes('ยังไม่มีใบเบิก'));
    assert.deepEqual(chipNumbers(hubTab('mine', [])), ['0']);
    assert.ok(empty.includes('จ่ายเงินแทนร้านไปก่อน? สร้างใบเบิกพร้อมใบเสร็จเพื่อขอเงินคืน') && empty.includes('สร้างใบเบิก'));
    assert.equal(empty.includes('ลองอีกครั้ง'), false);
    // A filter with no claim in it is not an empty scope.
    const none = visible(hubTab('mine', hubClaims.filter((claim) => claim.status !== 'PAID'), 'paid'));
    assert.ok(none.includes('ไม่พบใบเบิกที่ตรงกับตัวกรอง'));
    assert.doesNotMatch(hubTab('mine', hubClaims.filter((claim) => claim.status !== 'PAID'), 'paid'), /<option value="paid"/);
    assert.equal(none.includes('ยังไม่มีใบเบิก'), false);
  });

  it('keeps the rows already loaded when a later page fails, and the filter still counts the whole scope', () => {
    // Before: one failed page threw the whole load away.
    const html = hubTab('mine', many, undefined, { ...of230, failed: reason });
    const texts = visible(html);
    assert.ok(texts.includes(`⚠ โหลดรายการได้ไม่ครบ รายการด้านล่างยังไม่ใช่ทั้งหมด · ${reason}`), texts.join(' | '));
    assert.ok(texts.includes('ลองอีกครั้ง'));
    assert.equal(rowsShown(html), 10);
    assert.deepEqual(chipNumbers(html), ['230', '230']);
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีใบเบิก/u);
    // The retry is the shared notice's one action: a secondary button beside the sentence, below it on a phone.
    assert.match(html, /data-testid="reimbursements-mine-load-failed"><div [^>]*role="alert"[^>]*>.*?<div class="shrink-0"><button type="button" class="[^"]*">ลองอีกครั้ง<\/button><\/div>/su);
  });
});

// Review 2026-10-01: the hub searched in the browser and counted the whole scope beside what the search showed. The
// search now goes to the API, whose counts are of what it found, so a filter still shows the rows its number says.
describe('the hub search is asked of the API, and the filter counts what it found (spec §25.1 I1 with a search)', () => {
  const rowsShown = (html: string) => html.match(/data-testid="reimbursements-mine-card"/gu)?.length ?? 0;
  const chipNumbers = (html: string) => [...html.slice(html.indexOf('data-testid="reimbursements-mine-filters"'), html.indexOf('type="search"'))
    .matchAll(/<option\b[^>]*>.*? \((\d+)\)<\/option>/gsu)].map(([, count]) => count);
  // What the API answers for the search "แท็กซี่" in the shop of seven claims: three of them, one waiting for payment.
  const found = [hubClaims[0]!, hubClaims[2]!, hubClaims[4]!];
  const hint = 'ตัวเลขบนตัวกรองนับเฉพาะรายการที่ตรงกับคำค้น';

  it('shows the found claims with the filter and the line counting them, and each filter shows the rows its number says', () => {
    const html = hubTab('mine', found, undefined, {}, 'แท็กซี่');
    // Before: the chip ทั้งหมด said 7 beside three rows.
    assert.deepEqual(chipNumbers(html), ['3', '1', '1', '1']);
    assert.equal(rowsShown(html), 3);
    const texts = visible(html);
    assert.ok(texts.includes(`พบ 3 รายการที่ตรงกับคำค้น · ${hint}`), texts.filter((text) => text.includes('พบ')).join(' | '));
    assert.match(html, /<input [^>]*type="search"[^>]*value="แท็กซี่"/u);
    // A filter chosen while searching: its number is its rows.
    for (const [filter, rows] of [['payment', 1], ['draft', 1], ['review', 0]] as const) {
      const filtered = hubTab('mine', found, filter, {}, 'แท็กซี่');
      assert.equal(rowsShown(filtered), rows, filter);
      assert.ok(visible(filtered).includes(`พบ ${rows} จาก 3 รายการที่ตรงกับคำค้น · ${hint}`), filter);
    }
    // With no search the line is not there at all: the filter already says the count.
    assert.equal(visible(hubTab('mine', hubClaims)).some((text) => text.startsWith('ทั้งหมด 7') || text.startsWith('พบ ')), false);
  });

  it('says a search found nothing, never that the shop has no claims', () => {
    // Before (with the counts of the search): "ยังไม่มีใบเบิก" and a prompt to create the first claim.
    const texts = visible(hubTab('mine', [], undefined, {}, 'ไม่มีใบไหนตรง'));
    assert.ok(texts.includes('ไม่พบใบเบิกที่ตรงกับตัวกรอง') && texts.includes('ลองล้างคำค้นหรือเลือกสถานะอื่น'), texts.join(' | '));
    assert.ok(texts.includes(`พบ 0 รายการที่ตรงกับคำค้น · ${hint}`));
    for (const text of texts) assert.doesNotMatch(text, /ยังไม่มีใบเบิก|สร้างใบเบิกพร้อมใบเสร็จ/u);
    // A shop that really has none still says so when nothing is searched.
    assert.ok(visible(hubTab('mine', [])).includes('ยังไม่มีใบเบิก'));
  });

  it('names what the search box finds, in plain Thai', () => {
    const html = hubTab('mine', hubClaims);
    // The three things a person looks a claim up by, and short enough to read whole in the field of a 390 px phone.
    // Before: "ค้นหาเลขที่ ผู้เบิก เหตุผล หมวด ยอดเงิน" was cut at "ยอดเ…" there. The API still searches every column it did.
    assert.match(html, /placeholder="ค้นหาเลขที่ เหตุผล ยอดเงิน"/u);
    // Before that: "ค้นหาทุกข้อมูลในตาราง เช่น … สถานะ". The status is what the filter is for, and the API does not search it.
    assert.doesNotMatch(html, /ค้นหาทุกข้อมูลในตาราง/u);
  });
});

// The three lists were tables forced to 980 px from 768 px up. A 1280 px screen leaves their card 901 px (the side menu takes
// the rest), so the table scrolled sideways inside its card and hid its action column; at 1024 and 768 px by more. Then
// (2026-10-02) each became a table only from 80, 70 and 58rem, so a 1280 px laptop showed the phone's cards with three
// full-width buttons each. Since 2026-10-13 the three are built to read as a table at 52rem, which that 901 px card passes.
describe('a hub list is a table where its card is wide enough for it, and stacked rows below (owner 2026-10-02)', () => {
  const lists = ['mine', 'approvals', 'finance'] as const;
  const html = (tab: string) => hubTab(tab, [{ ...queueRow, status: 'PENDING_APPROVAL', reason: 'ค่าเดินทางไปพบลูกค้า', approvalActions: { canApprove: true, canReject: true } }]);

  it('switches by the width of the card that holds it, never by the screen, and forces no width on the table', () => {
    for (const tab of lists) {
      const page = html(tab);
      assert.match(page, /hidden w-full table-fixed border-collapse sm:table/);
      assert.match(page, /divide-y divide-gray-50 sm:hidden/);
      assert.doesNotMatch(page, /overflow-x-auto|whitespace-nowrap.*data-testid="reimbursements/);
      const table = page.slice(page.indexOf(`data-testid="reimbursements-${tab}-table"`), page.indexOf('</table>'));
      assert.equal(table.match(/<th\b/g)?.length, 5);
      assert.deepEqual([...table.matchAll(/width:(\d+)%/g)].map(match => Number(match[1])), [32, 17, 14, 15, 22]);
      assert.match(table, /role="link" tabindex="0"/);
    }
  });

  // Seen on a 390 px screen (2026-10-02): the requester's list held a claim with a long reason. Its card kept the
  // reason on one line, and the list's one column was unnamed, so the column took the width of that line: every card
  // of the list was 483 px wide on a 390 px screen, with the date, the amount and the end of its button past the edge.
  it('stacks the rows of a narrow list one under another, each as wide as the list and its free text wrapping', () => {
    for (const tab of lists) {
      const page = html(tab);
      // Rows with a line between them: no grid whose column a long line could widen, and no card inside the card.
      const list = page.match(new RegExp(`<ul class="([^"]*)" data-testid="reimbursements-${tab}-card-list">`, 'u'))?.[1].split(' ') ?? [];
      assert.ok(list.includes('divide-y') && !list.includes('grid'), `${tab}: ${list.join(' ')}`);
      const rows = page.slice(page.indexOf(`data-testid="reimbursements-${tab}-card-list"`), page.indexOf('</ul>', page.indexOf(`data-testid="reimbursements-${tab}-card-list"`)));
      assert.match(rows, /class="[^"]*\bbreak-words\b[^"]*"/u, tab);
      assert.doesNotMatch(rows, /\btruncate\b|line-clamp|mangmee-card/u, tab);
      // The whole row is one link to the claim, named by its number.
      assert.equal(rows.match(new RegExp(`data-testid="reimbursements-${tab}-card"`, 'gu'))?.length, 1, tab);
      assert.match(rows, /aria-label="เปิดใบเบิก ค่าเดินทางไปพบลูกค้า RB-202609-00007"/, tab);
    }
  });

  it('says on a stacked row what its table row says of the claim: the reason to an approver, the review to a finance desk', () => {
    const cards = (page: string, tab: string) => visible(page.slice(page.indexOf(`data-testid="reimbursements-${tab}-card-list"`)));
    assert.ok(cards(html('approvals'), 'approvals').includes('ค่าเดินทางไปพบลูกค้า'), 'the reason, which the approval card left out');
    const review = { ...queueRow, hasDuplicateBlocker: false, financeReviewStatus: 'BLOCKED' };
    assert.ok(cards(hubTab('finance', [review], undefined, {}, '', true), 'finance').some((text) => text.includes('ระงับ')), 'the review state');
  });

  it('names what each queue\'s search box finds, short enough for a 390 px phone and true of both layouts', () => {
    assert.match(html('approvals'), /placeholder="ค้นหาเลขที่ ผู้เบิก เหตุผล ยอดเงิน"/u);
    assert.match(html('finance'), /placeholder="ค้นหาเลขที่ ผู้เบิก ยอดเงิน"/u);
    for (const tab of lists) assert.doesNotMatch(html(tab), /ในตาราง/u, tab);
  });
});

// Audit B20: a viewer who may only reject was offered อนุมัติ on every queue row, and the API answered 403.
// 2026-10-13: a row carries one button at most. "ปฏิเสธ" and "ดูรายละเอียด" left the row: refusing is done on the claim
// page, beside the receipts, and the row itself is the way there.
describe('the approval queue offers only what the server says this viewer can do', () => {
  const row = (approvalActions?: { canApprove: boolean; canReject: boolean }) => ({ ...queueRow, status: 'PENDING_APPROVAL', approvalActions });
  /** What the list itself says, in its table and its stacked rows: the tab above it is named รออนุมัติ. */
  const listOf = (html: string) => visible(html.slice(html.indexOf('>', html.indexOf('data-testid="reimbursements-approvals-table"')) + 1));
  /** The decision buttons of one queue row: once in the table, once in the stacked row. */
  const decisions = (html: string) => listOf(html).filter((text) => text === 'อนุมัติ' || text === 'ส่งกลับให้แก้');

  it('shows อนุมัติ from the row\'s own approvalActions, never from the viewer\'s role or permissions, and no ปฏิเสธ on a row', () => {
    assert.deepEqual(decisions(hubTab('approvals', [row({ canApprove: true, canReject: true })])), ['อนุมัติ', 'อนุมัติ']);
    assert.deepEqual(decisions(hubTab('approvals', [row({ canApprove: false, canReject: true })])), []);
    assert.deepEqual(decisions(hubTab('approvals', [row({ canApprove: true, canReject: false })])), ['อนุมัติ', 'อนุมัติ']);
    // The viewer here is an OWNER holding reimbursement.approve: a row that says nothing still offers nothing.
    assert.ok(hubPermissions.includes('reimbursement.approve'));
    assert.deepEqual(decisions(hubTab('approvals', [row()])), []);
    // The row stays the way to the claim either way: its number in the table, the whole row when stacked.
    const readable = hubTab('approvals', [row({ canApprove: false, canReject: true })]);
    assert.ok(readable.includes('aria-label="เปิดใบเบิก ไปพบลูกค้า RB-202609-00007"'));
    assert.equal(readable.match(/href="\/companies\/company-1\/reimbursements\/cm[^"]+"/gu)?.length, 2, 'the number in the table and the stacked row');
    assert.equal(visible(readable).includes('ดูรายละเอียด'), false);
    // The row's button is never the page's green one.
    const source = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
    const queues = source.slice(source.indexOf('function ApprovalQueue('), source.indexOf('export function PaymentModal('));
    assert.doesNotMatch(queues, /className=\{(?:btnClass|successBtn|dangerClass)\}/);
  });

  // Before: the mark was on finance-queue rows alone, so an approver first met it on the claim page.
  it('marks a claim that may repeat another one อาจซ้ำ on its row, in the table and in the stacked row', () => {
    const marks = (duplicateStatus: string) => visible(hubTab('approvals', [{ ...row({ canApprove: true, canReject: true }), duplicateStatus }])).filter((text) => text === 'อาจซ้ำ').length;
    assert.deepEqual([marks('POSSIBLE_DUPLICATE'), marks('CONFIRMED_DUPLICATE')], [2, 2]);
    assert.deepEqual([marks('NO_MATCH'), marks('NOT_CHECKED'), marks('OVERRIDDEN')], [0, 0, 0]);
  });

  // Payout Phase 1 on the same rows: a claim paid by transfer is approved on its own page, where the account is
  // shown and attested, and its button says so. It is still offered only where the row allows approving.
  it('names the approve button of a transfer claim for what it does, and offers it under the same rule', () => {
    const transfer = (approvalActions?: { canApprove: boolean; canReject: boolean }) => ({ ...row(approvalActions), payoutMethod: 'BANK_TRANSFER' });
    const offered = (html: string) => listOf(html).filter((text) => ['อนุมัติ', 'ตรวจบัญชีและอนุมัติ', 'ส่งกลับให้แก้'].includes(text));
    assert.deepEqual(offered(hubTab('approvals', [transfer({ canApprove: true, canReject: true })])), ['ตรวจบัญชีและอนุมัติ', 'ตรวจบัญชีและอนุมัติ']);
    assert.deepEqual(offered(hubTab('approvals', [transfer({ canApprove: false, canReject: true })])), []);
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
    const all = ['อนุมัติ', 'ตรวจบัญชีและอนุมัติ', 'ส่งกลับให้แก้', 'ตรวจวิธีรับเงินคืน', ...Object.values(BUTTONS).map(([, button]) => button)] as string[];
    const offered = (html: string) => listOf(html).filter((text) => all.includes(text));
    const inRound = (approvalActions: { canApprove: boolean; canReject: boolean } | undefined, payoutCorrectionAnswer?: keyof typeof BUTTONS) =>
      ({ ...correctionRows[1]!, ageHours: 3, slaRisk: false, approvalActions, payoutMethod: payoutCorrectionAnswer ? BUTTONS[payoutCorrectionAnswer][0] : 'BANK_TRANSFER', payoutCorrectionAnswer, approvalSnapshotHash: 'hash' });
    for (const [answer, [, button, badge]] of Object.entries(BUTTONS) as Array<[keyof typeof BUTTONS, typeof BUTTONS[keyof typeof BUTTONS]]>) {
      // In the table and in the stacked row.
      assert.deepEqual(offered(hubTab('approvals', [inRound({ canApprove: true, canReject: true }, answer)])), [button, button], answer);
      // Whoever may only send the answer back gets the same way in.
      assert.deepEqual(offered(hubTab('approvals', [inRound({ canApprove: false, canReject: true }, answer)])), [button, button], answer);
      assert.deepEqual(offered(hubTab('approvals', [inRound(undefined, answer)])), [], answer);
      // The row says what it waits for, in both layouts. The button names the same thing.
      const texts = listOf(hubTab('approvals', [inRound({ canApprove: true, canReject: true }, answer)]));
      assert.equal(texts.filter((text) => text === badge).length, 2, answer);
      assert.equal(texts.includes('รออนุมัติ'), false, answer);
      assert.equal(badge, `รออนุมัติ${button.slice('ตรวจ'.length)}`);
    }
    // A row with no answer on it (a page fed by an older server): the method, which is true of every answer.
    assert.deepEqual(offered(hubTab('approvals', [inRound({ canApprove: true, canReject: true })])), ['ตรวจวิธีรับเงินคืน', 'ตรวจวิธีรับเงินคืน']);
    // A row of no round carries no status badge: every row of this list waits for approval, which its tab says.
    assert.equal(listOf(hubTab('approvals', [row({ canApprove: true, canReject: true })])).includes('รออนุมัติ'), true);
  });
});

// Payout Phase 1 on the paged list: a row shows no account, so nothing is sent from a row. Until 2026-10-13 a draft that
// chose cash was sent from its row, and every other draft's row carried a button that opened its page under one of two
// longer names, beside a bare "ยกเลิก" that opened it too. A row now says where the draft stands and is the way to its page.
describe('a draft row of the hub list sends nothing: it says where the draft stands and opens its page', () => {
  const sending = (html: string) => visible(html).filter((text) => text === 'ส่งอนุมัติ' || text === 'ตรวจบัญชีและส่งอนุมัติ' || text === 'เลือกวิธีรับเงินคืนและส่งอนุมัติ');
  const ready = { ...draft, receiptRequirementStatus: 'ATTACHED' };
  /** How often a line is said: once in the table and once in the stacked row. */
  const said = (html: string, line: string) => visible(html).filter((text) => text === line).length;

  it('offers no send button on a draft row whatever it is paid by, and says in both layouts that it was not sent', () => {
    for (const payoutMethod of ['CASH', undefined, null, 'BANK_TRANSFER'] as const) {
      const html = hubTab('mine', [{ ...ready, payoutMethod }]);
      assert.deepEqual(sending(html), [], String(payoutMethod));
      assert.equal(said(html, 'ร่าง'), 2, String(payoutMethod));
      for (const gone of ['ยกเลิก', 'แก้ไข', 'ดูรายละเอียด']) assert.equal(said(html.slice(html.indexOf('data-testid="reimbursements-mine-table"')), gone), 0, gone);
    }
    // A claim already sent has no send button either.
    assert.deepEqual(sending(hubTab('mine', [{ ...ready, status: 'PENDING_APPROVAL', payoutMethod: 'CASH', currentDesk: { kind: 'APPROVER' } }])), []);
  });

  // Before: a red banner above the list told everyone who could see a draft (its approver, the finance desk, the owner)
  // to fix "a draft" that was not theirs, and did not say which.
  it('says what a draft still lacks on its own row and to its requester only, never in a banner above the list', () => {
    const html = hubTab('mine', [{ ...ready, receiptRequirementStatus: 'REQUIRED' }]);
    assert.equal(said(html, 'ยังไม่มีใบเสร็จ'), 2);
    assert.doesNotMatch(html, /ยังส่งอนุมัติไม่ได้|reimbursement-current-desk/);
    assert.deepEqual(sending(html), []);
  });

  // Before: the one claim that needed its requester sat among the closed ones with a red badge and nothing else.
  it('tells the requester of a refused claim what the approver said and what to do, on the row', () => {
    const html = hubTab('mine', [{ ...ready, status: 'REJECTED', rejectionReason: 'ต้องแนบใบเสร็จ' }]);
    assert.equal(said(html, 'ส่งกลับให้แก้'), 2);
    assert.doesNotMatch(html, /ส่งกลับให้แก้:|reimbursement-current-desk/);
    assert.match(html, /role="link" tabindex="0"/);
  });
});

// 2026-10-13 (L6-15): the claim form asked for things nobody needed (a currency list of one, a greyed-out requester, a
// reason for a missing receipt before any line was typed) and chose a category and a receiving method for the person.
describe('the claim form asks only for what this claim needs, and chooses nothing for the person', () => {
  const fresh = (props: object = {}) => renderToStaticMarkup(createPage(props));
  const withLine = (line: object) => filledCreatePage({ ...filledForm, lines: [{ ...filledForm.lines[1]!, attachmentId: null, attachmentFileName: undefined, ...line }] });

  it('shows the requester list only to someone who may prepare a claim for another person, and no currency list', () => {
    assert.ok(visible(fresh()).includes('ผู้เบิก'));
    assert.doesNotMatch(fresh({ canPrepareForOthers: false }), /aria-label="ผู้เบิก"/);
    assert.match(fresh({ canPrepareForOthers: false }), /ผู้เบิก[\s\S]*ฉัน/);
    for (const html of [fresh(), filledCreatePage()]) assert.equal(visible(html).includes('สกุลเงิน'), false);
    // Nothing under the title, and nothing under the button, tells the person what the button already says.
    for (const text of visible(fresh())) assert.doesNotMatch(text, /ระบบจะบันทึกเป็นฉบับร่าง/u);
  });

  it('starts a line on today with no category chosen, and puts the receipt first', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-13T05:00:00.000Z') });
    const html = fresh();
    const texts = visible(html);
    assert.ok(texts.includes('13 ต.ค. 2569'), 'today, in Bangkok');
    assert.ok(texts.includes('เลือกหมวด'));
    assert.equal(texts.includes('เดินทาง'), false, 'no category is picked for the person');
    const order = ['aria-label="ใบเสร็จ"', 'aria-label="รายการ"', 'aria-label="จำนวนเงิน"', 'aria-label="วันที่"', 'aria-label="หมวด"', 'aria-label="วัตถุประสงค์"'].map((field) => html.indexOf(field));
    assert.ok(order.every((at) => at > 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'the receipt, then what it was, how much, when, which category');
    // One name for the category on this form (before: "หมวดใบเบิก" on the label, "หมวด" for a screen reader).
    assert.equal(texts.includes('หมวดใบเบิก *'), false);
    assert.ok(texts.includes('หมวด *'));
  });

  it('asks why a receipt is missing only when a line in use has none', () => {
    const asked = (html: string) => html.includes('aria-label="เหตุผลที่ไม่มีใบเสร็จ"');
    assert.equal(asked(fresh()), false, 'a form nobody has typed in');
    assert.equal(asked(filledCreatePage()), false, 'every line has its receipt or its saved expense');
    assert.equal(asked(withLine({})), true, 'a typed line with no receipt');
    // A reason is only asked while a typed line still lacks a receipt.
    assert.equal(asked(filledCreatePage({ ...filledForm, missingReceiptReason: 'ร้านไม่ออกใบเสร็จ' })), false);
    assert.ok(visible(withLine({})).includes('กรอกเมื่อมีรายการที่ไม่มีใบเสร็จ ใช้ได้เมื่อร้านรับเหตุผลแทนใบเสร็จ'));
  });

  it('reads the strict receipt rule before save and hides the reason that the shop does not accept', () => {
    const form = { ...filledForm, lines: [{ ...filledForm.lines[1]!, attachmentId: null, attachmentFileName: undefined }] };
    const strict = filledCreatePage(form, { requireReceipt: true, allowMissingReceiptWithReason: false });
    assert.ok(visible(strict).includes('ร้านนี้ต้องแนบใบเสร็จทุกรายการก่อนส่งอนุมัติ'));
    assert.equal(strict.includes('aria-label="เหตุผลที่ไม่มีใบเสร็จ"'), false);
    const waived = filledCreatePage(form, { requireReceipt: false, allowMissingReceiptWithReason: false });
    assert.equal(waived.includes('aria-label="เหตุผลที่ไม่มีใบเสร็จ"'), false);
  });

  it('offers only saved expenses that can be claimed, with the rest behind one line that says how many', () => {
    // Line 1 is taken from the one expense that can be claimed; two more of the list cannot.
    const texts = visible(filledCreatePage());
    assert.ok(texts.includes('ดูรายการที่เบิกไม่ได้ 2 รายการ'), texts.filter((text) => text.includes('เบิกไม่ได้')).join(' | '));
    // A line bound to one that can no longer be claimed still shows it, with the reason.
    assert.ok(visible(filledCreatePage(refusedForm)).includes('ร้านกาแฟ · ฿95.50 — ค่าใช้จ่ายนี้ถูกใช้เบิกในใบเบิกอื่นอยู่แล้ว'));
    // A line typed by hand offers the list as a link, never as a field above every line.
    assert.ok(visible(fresh()).includes('เลือกจากค่าใช้จ่ายที่บันทึกไว้'));
    assert.equal(fresh().includes('aria-label="ค้นหาค่าใช้จ่ายที่บันทึกไว้"'), false);
  });

  it('marks every field that is wrong after the save button was pressed, and says each under its own field', () => {
    // The page's states in the order it declares them: on a new claim `loading` is its fifth `false` and `showProblems` its sixth.
    let falses = 0;
    const html = renderWithState(createPage(), (initial) => {
      if (initial === false) { falses += 1; return falses === 6 ? true : undefined; }
      return undefined;
    });
    const texts = visible(html);
    for (const problem of ['กรอกเหตุผล', 'กรอกรายการ', 'ยอดเงินต้องมากกว่า 0', 'เลือกหมวด']) assert.ok(texts.includes(problem), `${problem}: ${texts.filter((text) => text.includes('กรอก')).join(' | ')}`);
    assert.ok(texts.some((text) => /^⚠ ยังกรอกไม่ครบ \d+ ช่อง$/u.test(text)), 'how many, at the button');
    assert.ok((html.match(/aria-invalid="true"/gu)?.length ?? 0) >= 4);
    const source = readFileSync(join(__dirname, 'ReimbursementCreatePage.tsx'), 'utf8');
    assert.match(source, /if \(requestFormProblems\(\{ \.\.\.checked, intent: send \? 'send' : 'draft' \}\)\.count > 0 \|\| \(!editing && !branchId\)\) \{\s+setShowProblems\(true\); setCollapsedLines\(\{\}\);\s+[^\n]*\n\s+if \(!payout\.mode\) \{ setError\('เลือกวิธีรับเงินคืน'\); setPayoutInvalidField\('mode'\); \}\s+toFirstProblem\(\); return;\s+\}/);
    // What is checked and sent is the amount without the separators a person types.
    assert.match(source, /amount: typedAmount\(l\.amount\),\s+linkedExpenseId: l\.linkedExpenseId \?\? null,/);
  });

  it('offers save draft and send for both new and returned drafts', () => {
    const source = readFileSync(join(__dirname, 'ReimbursementCreatePage.tsx'), 'utf8');
    assert.match(source, /toast.success\(send \? 'ส่งอนุมัติแล้ว' : 'บันทึกร่างแล้ว'\)/);
    assert.match(source, /value="draft"[\s\S]*>บันทึกร่าง<\/button>/);
    assert.match(source, /value="send"[\s\S]*>ส่งอนุมัติ<\/button>/);
    // A person known to have no default account is not left on "follow my default"; a default that could not be read keeps the choice.
    assert.match(source, /const noDefaultAccount = requesterUserId === userId && myPayoutAccount === null && !defaultUnreadRef\.current;/);
    assert.match(source, /setPayout\(current => \(current\.mode === 'DEFAULT' \? \{ \.\.\.current, mode: '' \} : current\)\);/);
    assert.match(source, /const payoutError = !payout\.mode \? 'เลือกวิธีรับเงินคืน' : claimPayoutFormError\(payout\);/);
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
    assert.ok(texts.includes(warning), texts.filter((text) => text.includes('จ่ายเงิน')).join(' | '));
    assert.ok(texts.includes('บันทึกการตั้งค่า'));
    for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(warning, pattern, name);
    // Nothing to say once finance review pays, once the role is unticked, or when every chosen role can pay.
    for (const quiet of [settings({ ...policy, financeReviewRequired: true }, options), settings({ ...policy, defaultApproverRoles: ['MANAGER'] }, options),
      settings(policy, [option('MANAGER', 'Manager', true), option('CHECKER', 'ผู้ตรวจ', true)])]) {
      assert.equal(quiet.some((text) => text.includes('บันทึกจ่ายไม่ได้')), false);
      assert.ok(quiet.includes('ส่งใบเบิกให้ใครอนุมัติ'), 'the form rendered');
    }
  });

  // Before: the warning named every ticked role, so a role that could no longer approve was said to "อนุมัติได้".
  it('leaves a ticked role that can no longer approve out of the warning; the form already says it is not ready', () => {
    const texts = settings(policy, [option('MANAGER', 'Manager', true), option('CHECKER', 'ผู้ตรวจ', false, false)]);
    assert.equal(texts.some((text) => text.includes('อนุมัติได้ แต่บันทึกจ่ายไม่ได้')), false);
    assert.ok(texts.includes('บางบทบาทที่เลือกยังไม่มีคนพร้อมอนุมัติ เอาออกหรือเลือกบทบาทอื่น'));
    // Two ticked roles lack the pay right; only the one that can still approve is named.
    const both = settings({ ...policy, defaultApproverRoles: ['MANAGER', 'CHECKER', 'LEAD'] },
      [option('MANAGER', 'Manager', true), option('CHECKER', 'ผู้ตรวจ', false), option('LEAD', 'หัวหน้าสาขา', false, false)]);
    assert.ok(both.includes(warning), both.filter((text) => text.includes('จ่ายเงิน')).join(' | '));
  });
});

// Owner's model 2026-10-01: a claim has a requester and an approver, and a finance desk exists only where the company turned the
// finance-review step on. A shop without the step still had a tab "คิวการเงิน", empty with "ไม่มีรายการรอการเงิน".
// 2026-10-13: a tab is named for what waits in it, without "คิว": รอจ่าย, or รอการเงิน where the step is on.
describe('the hub\'s third tab is the pay list where the company has no finance-review step (owner 2026-10-02)', () => {
  const ready = { ...queueRow, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', hasDuplicateBlocker: false, currentDesk: { kind: 'PAYMENT' } };
  const underReview = { ...queueRow, id: `${ids.request}review`, financeReviewStatus: 'PENDING', hasDuplicateBlocker: false, currentDesk: { kind: 'FINANCE' } };
  /** The work tabs of the hub's own navigation: its pressed-or-not buttons, without the quiet links beside them. */
  const tabsOf = (html: string) => [...html.slice(html.indexOf('aria-label="งานเบิกจ่าย"'), html.indexOf('aria-label="งานเบิกจ่าย"') + 1600).matchAll(/<button type="button" aria-pressed="(?:true|false)" data-active="(?:true|false)"[^>]*>([^<]*)/gu)].map(([, label]) => label!);


  it('names it รอจ่าย and says nothing of finance: the tab, its count, its empty text and its rows', () => {
    const empty = hubTab('finance', [], undefined, {}, '', false);
    assert.deepEqual(tabsOf(empty), ['ใบเบิกทั้งหมด', 'รออนุมัติ', 'รอจ่าย']);
    for (const text of ['ไม่มีใบเบิกรอจ่าย', 'ใบเบิกที่อนุมัติแล้วและรอจ่ายเงินคืนจะอยู่ที่นี่']) assert.ok(visible(empty).includes(text), text);
    const filled = visible(hubTab('finance', [ready], undefined, {}, '', false));
    for (const text of ['รอจ่าย', 'จ่ายเงิน', 'ยอดรวม 1,614.50 บาท']) assert.ok(filled.includes(text), text);
    // Before: the tab and its empty text named a finance desk, and every row read "ไม่ต้องตรวจ" under "ตรวจการเงิน".
    for (const text of [...visible(empty), ...filled]) assert.doesNotMatch(text, /การเงิน|ไม่ต้องตรวจ|รอตรวจ|คิว/u);
  });

  it('keeps the finance wording where the step is on', () => {
    const empty = hubTab('finance', [], undefined, {}, '', true);
    assert.deepEqual(tabsOf(empty), ['ใบเบิกทั้งหมด', 'รออนุมัติ', 'รอการเงิน']);
    for (const text of ['ไม่มีใบเบิกรอการเงิน', 'ใบเบิกที่อนุมัติแล้วจะอยู่ที่นี่']) assert.ok(visible(empty).includes(text), text);
    const filled = visible(hubTab('finance', [ready, underReview], undefined, {}, '', true));
    for (const text of ['รอตรวจสอบการเงิน', 'อนุมัติจ่าย', 'ยอดรวม 3,229.00 บาท']) assert.ok(filled.includes(text), text);
  });

  // The policy is frozen on a claim when it is sent, so a claim sent while the step was on is still reviewed after it is turned off.
  it('keeps the review line and its count for a list that still holds such a claim, under the tab the company now has', () => {
    const html = hubTab('finance', [ready, underReview], undefined, {}, '', false);
    assert.deepEqual(tabsOf(html), ['ใบเบิกทั้งหมด', 'รออนุมัติ', 'รอจ่าย']);
    for (const text of ['รอตรวจสอบการเงิน', 'ยอดรวม 3,229.00 บาท']) assert.ok(visible(html).includes(text), text);
    // The claim beside it never had the step: it says nothing of a review (before: "ตรวจการเงิน: ไม่ต้องตรวจ").
    assert.equal(visible(html).some((text) => text.includes('ไม่ต้องตรวจ')), false);
  });

  // Upgrade test 2026-10-02, on the owner's own company: six claims wait for payment, and one of them passed a finance
  // review while the company still had that step. Every card of the queue then read "ตรวจการเงิน: ไม่ต้องตรวจ", also the
  // five that never had a review, and the count read "รอตรวจ/รอจ่าย" though nothing waited for one.
  it('says a claim\'s finance review only on the claim that had one, and counts "รอจ่าย" when nothing waits for a review', () => {
    const reviewed = { ...ready, financeReviewStatus: 'APPROVED_FOR_PAYMENT' };
    const html = hubTab('finance', [ready, reviewed], undefined, {}, '', false);
    assert.deepEqual(tabsOf(html), ['ใบเบิกทั้งหมด', 'รออนุมัติ', 'รอจ่าย']);
    assert.doesNotMatch(html, /ตรวจการเงิน:|ไม่ต้องตรวจ/);
    assert.match(html, /ยอดรวม 3,229.00 บาท/);
    assert.equal(html.match(/>จ่ายเงิน<\/button>/g)?.length, 4);
    const found = (query: string) => hubTab('finance', [ready, reviewed], undefined, {}, query, false).match(/data-testid="reimbursements-finance-card"/g)?.length ?? 0;
    assert.deepEqual([found('อนุมัติจ่าย'), found('ไม่ต้องตรวจ')], [1, 0]);
  });

  it('names no third tab before the page is told, with a policy right or without one', () => {
    for (const mayReadPolicy of [true, false]) {
      const unread = hubTab('finance', [ready], undefined, {}, '', 'unread', mayReadPolicy);
      assert.deepEqual(tabsOf(unread), ['ใบเบิกทั้งหมด', 'รออนุมัติ']);
      for (const text of visible(unread)) assert.doesNotMatch(text, /รอการเงิน|^รอจ่าย|ไม่มีใบเบิกรอ|รอตรวจหรือรอจ่าย/u);
      assert.ok(visible(unread).includes('กำลังโหลด...'));
    }
  });

  // The policy endpoint asks for a policy right, which an accountant does not hold: they review claims for finance and
  // record no policy. Before, such a viewer read "คิวการเงิน" and "ไม่มีรายการรอการเงิน" in a shop with no finance step.
  it('names the tab by the company for a finance reviewer who may not read the policy, as the hub bootstrap tells it', () => {
    const off = hubTab('finance', [], undefined, {}, '', false, false);
    assert.deepEqual(tabsOf(off), ['ใบเบิกทั้งหมด', 'รออนุมัติ', 'รอจ่าย']);
    assert.ok(visible(off).includes('ไม่มีใบเบิกรอจ่าย'));
    for (const text of visible(off)) assert.doesNotMatch(text, /การเงิน|รอตรวจ/u);
    const on = hubTab('finance', [], undefined, {}, '', true, false);
    assert.deepEqual(tabsOf(on), ['ใบเบิกทั้งหมด', 'รออนุมัติ', 'รอการเงิน']);
    assert.ok(visible(on).includes('ไม่มีใบเบิกรอการเงิน'));
    // The first hub read supplies policy facts and scoped work counts for every reader.
    const page = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
    assert.match(page, /void getReimbursementHub\(companyId\)/);
    assert.match(page, /const financeStep = !hasThirdTab \? true : policyRead\.companyId === companyId \? policyRead\.financeStep : undefined;/);
  });
});

// Phone first: whatever a person presses is 44 px high at 390 px. The real look measured 18 px (the back link of every
// claim page), 24 px (the header of a line on the claim form) and 38 px (an approver role on the policy tab).
describe('what a person presses on a claim screen is 44 px high on a phone (owner 2026-10-02)', () => {
  it('makes the back link the shared back button, on its own line above the title: 44 px on a phone, 40 px from 640 px', () => {
    const html = filledCreatePage();
    // It was a line of text inside the eyebrow pill: 44 px on a phone by a box of its own, and 18 px on a tablet.
    assert.match(html, /<div class="mangmee-page-back"><a class="mangmee-btn mangmee-btn-secondary w-fit" href="\/companies\/company-1\/reimbursements"><span aria-hidden="true">←<\/span>กลับไปการเบิกจ่าย<\/a><\/div><h1 class="mangmee-page-title">/);
    assert.doesNotMatch(html, /mangmee-eyebrow/);
    // One link for the claim form, the claim page and the payout-account page, each in the page frame's `back` slot.
    for (const file of ['ReimbursementCreatePage.tsx', 'ReimbursementJourneyPage.tsx', 'ReimbursementPayoutAccountPage.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      assert.match(source, file === 'ReimbursementPayoutAccountPage.tsx' ? /<BackToClaimsLink href=\{hubHref\} \/>/ : /<BackToClaimsLink href=\{`\$\{hubHref\}\$\{returnQuery\}`\} \/>/, file);
      assert.match(source, /\bback=\{/, file);
      assert.doesNotMatch(source, /\beyebrow=|<Link href=\{hubHref\}>←/, file);
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
  it('gives the short links of a claim page 44 px both ways: ดูสำเนา, ดูหลักฐานการจ่าย, and a note\'s แก้ไข and ลบ', () => {
    const html = detailSections({ ...paid, payments: [{ ...(paid.payments[1] as object), slipCount: 1, slips: [{ attachmentId: ids.attachment }], viewerCanOpenSlips: true }],
      signedCopies: [{ attachmentId: ids.attachment, fileName: 'ใบเบิกเซ็นแล้ว.pdf', uploadedAt: '2026-09-29T05:00:00.000Z', acknowledgedAt: '2026-09-29T05:00:00.000Z' }], signatures: [] },
      ids.requester, ['reimbursement.read_own']);
    for (const label of ['ดูสำเนา', 'ดูหลักฐานการจ่าย']) {
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
    // Each role is the shared choice row: a 20 px tick and its name in one label, 44 px high by the shared rule
    // (`.mangmee-choice` in globals.css), with no box drawn around it inside the card.
    const list = html.slice(html.indexOf('ส่งใบเบิกให้ใครอนุมัติ'), html.indexOf('</fieldset>'));
    const roles = [...list.matchAll(/<label class="([^"]*)"><input type="checkbox" class="mangmee-choice-input"[^>]*\/><span class="mangmee-choice-text"><span class="mangmee-choice-label">[^<]+<\/span><\/span><\/label>/gu)].map((match) => match[1]!);
    assert.equal(roles.length, 2, list.slice(0, 900));
    for (const cls of roles) assert.equal(cls, 'mangmee-choice');
    assert.match(readFileSync(join(__dirname, '../../../app/globals.css'), 'utf8'), /\.mangmee-choice \{\s+display: flex;\s+min-height: 2\.75rem;/);
  });

  // Owner 2026-10-13 (Thai UX standard §3.4, §3.5): the tab had an icon tile and a restating sentence over each section,
  // a box around every option, and a card "สรุปนโยบาย" that listed the six values just set.
  it('draws the settings as plain rows, with no summary that repeats the form and one save button named for what it saves', () => {
    const html = policySettingsHtml(policyForm, [roleOption('MANAGER', 'Manager', true)]);
    const texts = visible(html);
    for (const text of ['การอนุมัติใบเบิก', 'ใบเสร็จ', 'การเงินและกำหนดเวลา', 'ใบเบิกจะเดินตามนี้', 'ถ้าใบเสร็จอาจซ้ำกับใบอื่น', 'เตือนอย่างเดียว', 'บันทึกการตั้งค่า']) assert.ok(texts.includes(text), text);
    for (const text of texts) assert.doesNotMatch(text, /นโยบาย|บริษัท/u, text);
    assert.equal(texts.filter((text) => text === 'บันทึกการตั้งค่า').length, 1);
    assert.equal((html.match(/mangmee-btn-primary/g) ?? []).length, 1, 'one main button');
    // Every on/off setting is the shared tick row; nothing is a bordered box inside the card.
    assert.equal((html.match(/<label class="mangmee-choice">/g) ?? []).length, 6, 'five settings and the one role');
    assert.doesNotMatch(html, /rounded-xl border border-gray-200 px-3/);
    const source = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
    assert.doesNotMatch(source, /สรุปนโยบาย|บันทึกนโยบาย|KPI\./);
    // The save button says why it cannot be pressed, beside itself.
    assert.match(source, /\{notReadyReason && <p[^>]*>\{notReadyReason\}<\/p>\}/);
  });
});

// Upgrade test 2026-10-02: a claim that needed no approval read as finished ("เซ็นในระบบครบแล้ว") beside a signature block
// "ผู้อนุมัติ · ยังไม่เซ็น" that nobody could ever sign.
describe('the signature card has an approver block only where the claim has an approver (owner 2026-10-02)', () => {
  /** The blocks of the card "ลายเซ็นในใบเบิก": each role with what it says. */
  const blocks = (detail: object) => {
    const html = detailSections(detail, ids.requester, ['reimbursement.read_own']);
    const card = html.slice(html.indexOf('id="reimbursement-signatures"'), html.indexOf('id="reimbursement-signed-copies"'));
    return {
      // A block is a cell of the card's grid (the role, then what it says): never a bordered box inside the card.
      roles: [...card.matchAll(/<div class="min-w-0 text-sm"><div class="text-gray-500">([^<]*)<\/div><div class="mt-1">(?:<span[^>]*>)?([^<]*)/gu)].map((match) => `${match[1]}: ${match[2]}`),
      texts: visible(card), html: card,
    };
  };
  const noApproval = { ...paid, documentSignedVia: null, financeReviewStatus: 'NOT_REQUIRED', financeReviewedByName: undefined, approvalSteps: [] };

  it('shows the requester\'s block alone on a claim that needed no approval, and says why', () => {
    const card = blocks(noApproval);
    assert.deepEqual(card.roles, ['ผู้เบิก: เซ็นแล้ว']);
    assert.ok(card.texts.includes('ใบนี้ไม่ต้องอนุมัติตามนโยบาย จึงมีเฉพาะลายเซ็นของผู้เบิก'));
    assert.equal(card.texts.includes('ผู้อนุมัติ') || card.texts.includes('ยังไม่เซ็น'), false);
    // One block is as wide as the card, not half of it beside nothing.
    assert.doesNotMatch(card.html, /class="grid [^"]*grid-cols-2/u);
    assert.doesNotMatch(card.html, /rounded-xl border border-gray-200 p-3/u);
    // A declared paper copy changes nothing: there is still no approver to have signed it.
    assert.deepEqual(blocks({ ...noApproval, documentSignedVia: 'PAPER', signatures: [] }).roles, ['ผู้เบิก: เซ็นบนกระดาษ']);
    assert.equal(model.claimHasNoApprover(noApproval), true);
  });

  it('keeps both blocks where someone approved the claim, where it still waits for its approval, and while its account is corrected', () => {
    assert.deepEqual(blocks({ ...paid, documentSignedVia: null }).roles, ['ผู้เบิก: เซ็นแล้ว', 'ผู้อนุมัติ: รอเซ็น']);
    const waiting = { ...paid, documentSignedVia: null, status: 'PENDING_APPROVAL', paymentStatus: 'NOT_PAYABLE', approvedAt: undefined, payments: [], signatures: [],
      approvalSteps: [{ id: ids.step, sequenceNo: 1, approverUserId: ids.approver, approverName: 'สมชาย', status: 'PENDING', assignedAt: '2026-09-27T03:00:00.000Z' }] };
    assert.deepEqual(blocks(waiting).roles, ['ผู้เบิก: รอเซ็น', 'ผู้อนุมัติ: รอเซ็น'], 'old copies keep the record visible');
    assert.deepEqual(blocks({ ...waiting, signedCopies: [] }).roles, [], 'without earlier copies there is no signature card');
    // A correction round sets the approval aside: the new account still has to be approved, by an approver.
    const inRound = { ...paid, documentSignedVia: null, status: 'PENDING_APPROVAL', payoutCorrectionPhase: 'AWAITING_REQUESTER', signatures: [], payments: [],
      approvalSteps: [{ ...(paid.approvalSteps[0] as object), invalidatedAt: '2026-09-28T01:00:00.000Z', invalidatedReason: 'payout_account_correction' }] };
    assert.deepEqual(blocks(inRound).roles, ['ผู้เบิก: รอเซ็น', 'ผู้อนุมัติ: รอเซ็น'], 'old copies stay readable during correction');
    assert.deepEqual(blocks({ ...inRound, signedCopies: [] }).roles, []);
    for (const detail of [paid, waiting, inRound, draft]) assert.equal(model.claimHasNoApprover(detail), false);
  });
});

// Upgrade test 2026-10-02: the edit page of a draft made before the release said "แก้ไขข้อมูลตามเหตุผลที่ส่งกลับ แล้วบันทึกร่าง
// ก่อนส่งอนุมัติใหม่", although nobody had sent that draft back.
describe('the edit page speaks of a reason for sending back only for a draft someone sent back (owner 2026-10-02)', () => {
  /**
   * The edit page with its draft loaded. Its states in the order it declares them: `loading` is its one `true`,
   * `editLoaded` its fifth `false`, and the note of a draft that was sent back its seventh `null`.
   */
  const editPage = (note: string | null) => {
    let falses = 0;
    let nulls = 0;
    return visible(renderWithState(createPage({ requestId: ids.request, canUpdate: true }), (initial) => {
      if (Array.isArray(initial?.lines)) return filledForm;
      if (initial === true) return false;
      if (initial === false) { falses += 1; return falses === 5 ? true : undefined; }
      if (initial === null) { nulls += 1; return nulls === 7 && note ? note : undefined; }
      return undefined;
    }));
  };
  // 2026-10-13: the page says nothing under its title any more. The two sentences that stood there told the person to
  // edit and save, which the title and the button already say; what a sent-back draft needs is the reason, and it is there.
  const TOLD_TWICE = /แก้ไขข้อมูล|แล้วบันทึกร่างก่อนส่งอนุมัติ/u;

  it('says nothing of sending back on a plain draft, and shows the reason once on one that was sent back', () => {
    const plain = editPage(null);
    assert.ok(plain.includes('แก้ไขใบเบิก'), JSON.stringify(plain.slice(0, 12)));
    assert.equal(plain.some((text) => text.includes('ส่งกลับ')), false, 'nobody sent it back');
    const returned = editPage('ส่งกลับให้แก้ไขที่ขั้นตรวจการเงิน: แนบใบเสร็จตัวจริง');
    assert.equal(returned.filter((text) => text.includes('ส่งกลับ')).length, 1);
    assert.ok(returned.includes('⚠ ส่งกลับให้แก้ไขที่ขั้นตรวจการเงิน: แนบใบเสร็จตัวจริง'), 'the reason is on the page, as advice and not as an error');
    for (const text of [...plain, ...returned]) assert.doesNotMatch(text, TOLD_TWICE);
    // Leaving the edit goes back to the draft, and the draft keeps its button names.
    assert.ok(plain.includes('ยกเลิก') && plain.includes('บันทึกร่าง') && plain.includes('ส่งอนุมัติ'));
    const source = readFileSync(join(__dirname, 'ReimbursementCreatePage.tsx'), 'utf8');
    assert.match(source, /<Link href=\{editing \? `\$\{hubHref\}\/\$\{requestId\}\$\{returnQuery\}` : `\$\{hubHref\}\$\{returnQuery\}`\} className=\{ghostClass\}>ยกเลิก<\/Link>/);
    assert.match(source, /\{correctionNote && <Notice tone="warning">\{correctionNote\}<\/Notice>\}/);
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
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [rejected] }), 'ผู้อนุมัติ ส่งกลับให้แก้: ยอดไม่ตรงกับใบเสร็จ');
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [step('REJECTED', '2026-09-28T02:00:00.000Z')] }), 'ผู้อนุมัติ ส่งกลับให้แก้แล้ว');
    // Taken back by the requester themselves, also after an earlier rejection: nobody sent it back this time.
    const withdrawn = step('CANCELLED', '2026-09-29T02:00:00.000Z', { invalidatedReason: 'withdrawn_by_requester' });
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [withdrawn] }), null);
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [withdrawn, rejected] }), null, 'by when each was assigned, not by the order of the list');
    assert.equal(draftSentBackNote({ ...draft, approvalSteps: [step('CANCELLED', '2026-09-27T02:00:00.000Z'), rejected] }), 'ผู้อนุมัติ ส่งกลับให้แก้: ยอดไม่ตรงกับใบเสร็จ');
  });
});

// The three totals read "฿7,219.5": a currency sign, and a satang digit dropped. Every other amount of a claim reads "฿7,219.50".
describe('the totals on the hub read as money in baht, like every other amount of a claim (owner 2026-09-27/29)', () => {
  const ready = { ...queueRow, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', hasDuplicateBlocker: false, currentDesk: { kind: 'PAYMENT' } };
  const MONEY = /^฿\d{1,3}(,\d{3})*\.\d{2}$/u;

  it('shows the total of each tab as "฿1,234.50", with the shared currency sign and both satang digits', () => {
    for (const [tab, rows] of [['mine', hubClaims], ['approvals', [queueRow]], ['finance', [ready]]] as const) {
      const html = hubTab(tab, [...rows], undefined, {}, '', false);
      assert.match(html, /ยอดรวม [\d,]+\.\d{2} บาท/);
      assert.doesNotMatch(html, /฿|THB/);
    }
    assert.match(hubTab('mine', hubClaims), /ยอดรวม 700.00 บาท/);
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
    for (const text of ['ยังไม่มีลายเซ็นของคุณ', 'ไปบันทึกลายเซ็น', 'ปิด']) assert.ok(texts.includes(text), text);
    // One sentence: save one, come back, and it works at once. The button that backs out is "ปิด", not "ไว้ภายหลัง".
    assert.ok(texts.includes('บันทึกลายเซ็นก่อน แล้วกลับมาเซ็นใบนี้ ลายเซ็นที่บันทึกแล้วใช้ได้ทันที'), texts.join(' | '));
    assert.equal(texts.includes('ไว้ภายหลัง'), false);
    const refusal = errorMessage('claim_saved_signature_required');
    assert.match(refusal, /ใช้เซ็นได้ทันที$/u);
    for (const text of [...texts, refusal]) assert.doesNotMatch(text, /รอให้|รออนุมัติ|พร้อมใช้งาน/u);
    // What the dialog promises is what the signature page itself says after a save.
    const signaturePage = readFileSync(join(__dirname, '../expenses/ExpensesWorkspacePanels.tsx'), 'utf8');
    for (const text of ['ยังไม่มีลายเซ็นของคุณ', 'บันทึกลายเซ็นแล้ว ใช้เซ็นได้ทันที']) assert.ok(signaturePage.includes(text), text);
  });

  // Upgrade test 2026-10-02: after the signature was saved, nothing on the signature page led back to the claim.
  it('carries the claim to the signature page, which offers the way back to it before and after a signature is saved', () => {
    Object.assign(globalThis, { document: { body: {} } });
    let html: string;
    try { html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(sections.MissingSavedSignatureModal, { companyId: 'company-1', requestId: ids.request, onClose: noop }))); }
    finally { Reflect.deleteProperty(globalThis, 'document'); }
    assert.match(html, new RegExp(`<a[^>]*href="/companies/company-1/expenses/signatures\\?fromClaim=${ids.request}"[^>]*>ไปบันทึกลายเซ็น</a>`, 'u'));
    const panel = require('../expenses/ExpensesWorkspacePanels') as typeof import('../expenses/ExpensesWorkspacePanels');
    assert.equal(panel.signatureReturnText(false), 'เมื่อบันทึกลายเซ็นแล้ว กลับไปกดเซ็นในใบเบิกได้ทันที');
    assert.equal(panel.signatureReturnText(true), 'ลายเซ็นของคุณพร้อมใช้แล้ว กลับไปกดเซ็นในใบเบิกได้เลย');
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
  it('answers approval refusals on their screen and carries acceptance refusals to the claim page', () => {
    const api = readFileSync(join(__dirname, 'reimbursements.api.ts'), 'utf8');
    assert.match(api, /\/approve`, \{\s+method: 'POST', body: JSON\.stringify\(\{ comment, approvalSnapshotHash, payoutVerifiedVersion, \.\.\.\(payoutThirdPartyAccepted === true && \{ payoutThirdPartyAccepted: true \}\) \}\), suppressErrorToast: true,\s+\}\)/);
    // The queue: the dialog of a claim edited after it was sent, or its own banner. Both of its approvals.
    const hub = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
    assert.match(hub, /if \(isStaleApprovalError\(e\)\) \{\s+try \{\s+setStaleReview\(\{ row: r, detail: await getReimbursement\(companyId, r\.id\) \}\);\s+\} catch \(e2\) \{ setError\(err\(e2\)\); \}\s+\} else \{/);
    // A refusal of any other kind: the claim moved on while the queue was open. The queue is read again, and the banner
    // says what was refused above the claims as they are now (seen in the real look: the cancelled claim's card stayed, with its buttons).
    assert.match(hub, /\} else \{\s+const failure = err\(e\);\s+await load\(\);\s+setError\(failure\);\s+if \(isThirdPartyAcceptanceRefusal\(e\)\) \{ toast\.error\(failure\); onOpenDetail\(r\.id\); \}\s+\}/);
    assert.equal((hub.match(/try \{ await fn\(\); \} catch \(e\) \{ failure = err\(e\); \}\s+await load\(\);\s+if \(failure\) setError\(failure\);/g) ?? []).length, 1, 'the pay queue; the approval queue has one press of its own, handled above');
    assert.match(hub, /toast\.success\('อนุมัติใบเบิกแล้ว'\);\s+\} catch \(e\) \{ setError\(err\(e\)\); if \(isThirdPartyAcceptanceRefusal\(e\)\)/);
    // Its banner is brought into view (the row pressed may be far below it on a phone), except under that dialog, which shows it.
    assert.match(hub, /\{error && <ErrorBanner message=\{error\} focus=\{!staleReview\} \/>\}/);
    assert.match(hub, /<StaleApprovalDialog[\s\S]{0,1000}?error=\{error\}/);
    // The words of that dialog, and of the claim screens' own sentence for the refusal: the claim was edited, look again.
    assert.match(readFileSync(join(__dirname, 'ReimbursementDetailSections.tsx'), 'utf8'), /<Notice tone="warning">ใบนี้ถูกแก้หลังส่งอนุมัติ ดูสิ่งที่เปลี่ยนก่อนอนุมัติ<\/Notice>/);
    assert.match(errorMessage('stale_approval_snapshot'), /^ใบเบิกถูกแก้ไขหลังส่งอนุมัติ/u);
  });
});

// Owner 2026-10-02: "SLA" is no word a shop owner reads. A claim that waited past the company's deadline reads "เกินกำหนด",
// the words of the notice the server sends for it, and the policy page names the deadline for what it is.
describe('the deadline of a claim is said in plain Thai (owner 2026-10-02)', () => {
  it('marks a claim past it เกินกำหนด in the approval queue: the line above the list, the table row and the stacked row', () => {
    const html = hubTab('approvals', [{ ...queueRow, slaRisk: true }]);
    assert.doesNotMatch(html, /เกินกำหนด 1 ใบ|reimbursement-current-desk/);
    assert.equal(html.match(/>อาจซ้ำ<\/span>/g)?.length, 2, 'one blocking badge replaces secondary marks');
  });

  it('names the deadline on the settings tab: its section and its field, once (the summary that said it again is gone)', () => {
    const html = policySettingsHtml({ ...policyForm, slaHours: 24 }, [roleOption('MANAGER', 'Manager', true)]);
    const texts = visible(html);
    for (const text of ['การเงินและกำหนดเวลา', 'กำหนดเวลาอนุมัติและจ่าย (ชั่วโมง)']) assert.ok(texts.includes(text), text);
    assert.match(html, /<input id="reimbursement-deadline-hours"[^>]*value="24"/);
    assert.equal(texts.filter((text) => text.includes('กำหนดเวลาอนุมัติและจ่าย')).length, 1);
    for (const text of texts) assert.doesNotMatch(text, /SLA/u);
    // A shop that set no deadline: the field is empty, and the line under it says that empty means none.
    const none = policySettingsHtml(policyForm, [roleOption('MANAGER', 'Manager', true)]);
    assert.match(none, /<input id="reimbursement-deadline-hours"[^>]*value=""/);
    assert.ok(visible(none).includes('เว้นว่างไว้ถ้าไม่กำหนด'));
    // No screen says it anywhere else either: the tab's description, a tooltip, a message.
    assert.equal(claimScreenSources().includes('SLA'), false);
  });
});

// The summary beside the policy form read "≥ ฿1.00": a sign where the field and the preview say "ตั้งแต่" in words.
describe('the policy summary says the approval threshold in the words of its field (owner 2026-10-02)', () => {
  it('reads "ยอดตั้งแต่ 1.00 บาท" where the tab says what the settings add up to, with no comparison sign anywhere on the tab', () => {
    const texts = policySettings(policyForm, [roleOption('MANAGER', 'Manager', true)]);
    assert.ok(texts.includes('ยอดตั้งแต่ 1.00 บาท'), JSON.stringify(texts.filter((text) => text.includes('บาท'))));
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
  it('shows duplicate comparison facts and only offers an open link when the server grants it', () => {
    for (const canOpen of [false, true]) {
      const html = claimPage({ ...waiting, duplicateCandidates: [{ id: 'comparison', status: 'OPEN', documentNumber: 'RB-OTHER',
        requesterOrPayee: 'สมชาย', amount: '500', currency: 'THB', date: '2026-01-01', canOpen, candidateRequestId: 'other-claim' }] });
      assert.ok(visible(html).includes('เอกสารที่อาจซ้ำ'));
      assert.ok(visible(html).includes('RB-OTHER'));
      assert.ok(html.includes('สมชาย') && html.includes('500'));
      assert.equal(html.includes('href="/companies/company-1/reimbursements/other-claim"'), canOpen);
    }
  });

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
    for (const retired of ['ผู้ขอ', 'ผู้ยื่น', 'ผู้รับเงินคืน', 'ผู้สำรองจ่ายและรับเงินคืน', 'แอดมิน', 'ตั้งค่าเบิกจ่าย', 'อนุญาตให้อนุมัติใบเบิกตนเอง']) {
      assert.equal(screens.includes(retired), false, retired);
    }
    // The sentences the API's refusals are said in, for the codes of a claim that name one of them.
    for (const code of ['reimbursement_source_payer_unlinked', 'reimbursement_source_wrong_payer', 'reimbursement_requester_unavailable', 'invalid_primary_attachment',
      'invalid_linked_expense', 'payout_account_edit_denied', 'reimbursement_policy_inactive', 'self_approval_denied']) {
      assert.doesNotMatch(errorMessage(code), /ผู้ขอ|ผู้ยื่น|ผู้รับเงินคืน|แอดมิน|ตั้งค่าเบิกจ่าย|ใบเบิกตนเอง"/u, code);
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
  it('says whom the switch helps and the one case that needs no switch; the frozen route is said when the settings are saved', () => {
    const texts = policySettings(policyForm, [roleOption('MANAGER', 'ผู้จัดการ', true)]);
    // Before 2026-10-13: four sentences, none saying that the switch only helps people in the approver roles chosen
    // (an owner outside them turned it on, re-sent the claim and still could not approve).
    assert.ok(texts.includes('เมื่อเปิด คนในบทบาทผู้อนุมัติที่เลือกไว้อนุมัติใบเบิกของตัวเองได้'));
    assert.match(readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8'), /toast\.success\('บันทึกการตั้งค่าแล้ว ใช้กับใบเบิกที่ส่งหลังจากนี้'\)/);
  });
});


it('a pay-list row says a duplicate hold once, by its status, and leaves what to do about it to the claim page', () => {
  const source = readFileSync(join(__dirname, 'ReimbursementsPages.tsx'), 'utf8');
  // Before: both layouts printed the claim page's whole notice, which told the payer to press a button the row did not have,
  // under two badges for the one fact ("ติดรายการซ้ำ" and "อาจซ้ำ").
  assert.doesNotMatch(source, /duplicateNoticeForViewer/);
  const held = { ...queueRow, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', currentDesk: { kind: 'PAYMENT' } };
  const html = hubTab('finance', [held], undefined, {}, '', false);
  const list = visible(html.slice(html.indexOf('data-testid="reimbursements-finance-table"')));
  assert.equal(list.filter((text) => text === 'ติดรายการซ้ำ').length, 2, 'once in the table, once in the stacked row');
  assert.equal(list.includes('อาจซ้ำ'), false, 'no second mark for the same fact');
  for (const text of list) assert.doesNotMatch(text, /กดปลดรายการซ้ำ|ตรวจแล้วถ้าไม่ซ้ำ/u);
  // Nobody is offered a payment for it. Whoever may clear the hold gets one button to the claim, where the receipts are
  // compared; this viewer holds no such right and gets none.
  assert.equal(list.includes('จ่ายเงิน'), false);
  assert.equal(list.includes('ตรวจรายการซ้ำ'), false);
  const { queueRowAwaitsDuplicateCheck } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
  assert.equal(queueRowAwaitsDuplicateCheck(held), true);
  const notHeld: Array<[string, Parameters<typeof queueRowAwaitsDuplicateCheck>[0]]> = [['no hold', { ...held, hasDuplicateBlocker: false }], ['being cancelled', { ...held, cancellationPending: true }],
    ['under finance review', { ...held, status: 'FINANCE_REVIEW' }], ['confirmed', { ...held, duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] }], ['no row', null]];
  for (const [why, other] of notHeld) assert.equal(queueRowAwaitsDuplicateCheck(other), false, why);
  assert.match(source, /if \(queueRowAwaitsDuplicateCheck\(r\)\) \{\s+return !blockedByDuplicate && \(\s+<button type="button" className=\{ghostClass\} onClick=\{e => \{ e\.stopPropagation\(\); onOpenDetail\(r\.id\); \}\}>\{CHECK_DUPLICATE_LABEL\}<\/button>/);
  // A claim under finance review that may be a duplicate keeps its own status, with the one mark beside it.
  const review = visible(hubTab('finance', [queueRow]));
  assert.equal(review.filter((text) => text === 'อาจซ้ำ').length, 2);
  assert.equal(review.includes('ติดรายการซ้ำ'), false);
});

it('duplicate-clear success says the review was recorded without promising every blocker is gone', () => {
  const source = readFileSync(join(__dirname, 'ReimbursementJourneyPage.tsx'), 'utf8');
  assert.match(source, /success: REIMBURSEMENT_DUPLICATE_RESOLUTION_SAVED/);
});

it('both pay-list layouts mark a confirmed duplicate as one, never as a possible one to clear', () => {
  for (const status of ['READY_FOR_PAYMENT', 'FINANCE_REVIEW', 'PARTIALLY_PAID']) {
    const html = hubTab('finance', [{ ...queueRow, status, duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] }]);
    const list = visible(html.slice(html.indexOf('data-testid="reimbursements-finance-table"')));
    assert.equal(list.filter((text) => text === 'ยืนยันว่าใบเสร็จซ้ำ').length, status === 'READY_FOR_PAYMENT' ? 0 : 2, status);
    for (const text of list) assert.doesNotMatch(text, /กดปลดรายการซ้ำ|ตรวจว่าไม่ซ้ำแล้ว|^อาจซ้ำ$|^ตรวจรายการซ้ำ$|^บันทึกจ่าย$/u, status);
    // A claim that waits to be cancelled for it says so in its status; who cancels it and how is said on its page.
    assert.equal(list.filter((text) => text === 'รอยกเลิก').length, status === 'READY_FOR_PAYMENT' ? 2 : 0, status);
  }
  // The claim page keeps the guidance the rows used to print: who cancels, or who takes the payment back first.
  const { duplicateNoticeForViewer } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
  const confirmed = (status: string) => duplicateNoticeForViewer({ ...queueRow, status, duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] }, hubPermissions, ids.requester);
  assert.match(confirmed('READY_FOR_PAYMENT'), /ใบเสร็จของใบเบิกนี้ได้รับการยืนยันว่าซ้ำ[\s\S]*กดยกเลิกคำขอในหน้าใบเบิก/u);
  assert.match(confirmed('PARTIALLY_PAID'), /ผู้มีสิทธิ์ยกเลิกการจ่ายของสาขานี้/u);
});

it('the pay-list table lets free text wrap and keeps the number, the amount and the one button whole', () => {
  for (const withReview of [false, true]) {
    const rows = [{ ...queueRow, status: 'READY_FOR_PAYMENT', duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] },
      { ...queueRow, id: 'payable', status: 'READY_FOR_PAYMENT', hasDuplicateBlocker: false, duplicateReasons: [] }];
    const html = hubTab('finance', rows, undefined, {}, '', withReview);
    const table = html.slice(html.indexOf('data-testid="reimbursements-finance-table"'), html.indexOf('</table>', html.indexOf('data-testid="reimbursements-finance-table"')));
    // Before: fixed column widths broke "RB-202610-" / "00002" and "1,420.50 / ฿1,420.50" over two lines, while the
    // status column took half the table. Now only the cells of free text wrap.
    assert.equal([...table.matchAll(/width:(\d+)%/g)].reduce((sum, match) => sum + Number(match[1]), 0), 100);
    assert.match(table, /break-words px-2 py-3/);
    assert.equal(table.match(/<td class="break-words[^"]*"/g)?.length, 4, 'reason and requester wrap on both rows');
    assert.match(table, /รอยกเลิก/);
    assert.match(table, /จ่ายเงิน<\/button>/, 'other rows retain their payment action');
    assert.equal(table.match(/>จ่ายเงิน<\/button>/g)?.length, 1, 'only the payable row offers payment');
  }
});

it('the line above the pay list counts possible and confirmed holds under one honest word', () => {
  const ready = { ...queueRow, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', currentDesk: { kind: 'PAYMENT' } };
  const text = visible(hubTab('finance', [ready, { ...ready, id: 'confirmed', duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] }]));
  // "ติดรายการซ้ำ" is true of both; "อาจซ้ำ" would be untrue of the confirmed one.
  assert.ok(text.includes('ยอดรวม 3,229.00 บาท'));
  assert.equal(text.filter(line => line === 'ติดรายการซ้ำ').length, 2);
  assert.equal(text.filter(line => line === 'รอยกเลิก').length, 2);
  assert.ok(!text.includes('ติดรายการซ้ำ 2 ใบ'), 'no extra summary sentence');
  assert.ok(!text.includes('พบรายการที่อาจซ้ำ') && !text.some((line) => /^อาจซ้ำ \d+ ใบ$/u.test(line)));
});

it('deletes a never-sent draft with facts and one question, while sent claims keep reasoned cancellation', () => {
  const source = readFileSync(join(__dirname, 'ReimbursementJourneyPage.tsx'), 'utf8');
  assert.match(source, /!neverSentDraft.*setReasonAction\('cancel'\)/);
  assert.match(source, /title: 'ลบร่างใบเบิก', message:.*detail.reason.*formatMoney\(detail.amount, detail.currency\)/);
  assert.match(source, /confirmLabel: 'ลบร่าง', cancelLabel: 'ไม่ลบ'/);
  assert.match(source, /await deleteReimbursementDraft\(companyId, requestId\)/);
  assert.match(source, /neverSentDraft \? 'ลบร่าง' : ACTION_LABELS.cancel/);
});


it('R5 table and phone claim links carry the selected group, and the back and edit links retain it', () => {
  const html = hubTab('mine', hubClaims, 'correction');
  const href = `/companies/company-1/reimbursements/${ids.request}5?tab=mine&amp;filter=correction`;
  assert.equal(html.split(`href="${href}"`).length - 1, 2, 'table and phone card');
  let nulls = 0;
  const claim = renderWithState(h(AppRouterContext.Provider, { value: router },
    h(SearchParamsContext.Provider, { value: new URLSearchParams('tab=mine&filter=correction') },
      h(ToastContext.Provider, { value: toast }, h(ReimbursementJourneyPage, {
        companyId: 'company-1', requestId: ids.request, userId: ids.requester,
        permissions: ['reimbursement.read_own', 'reimbursement.update_own_draft', 'reimbursement.cancel_own'],
      })))), initial => initial === null && ++nulls === 2 ? draft : undefined);
  assert.ok(claim.includes('href="/companies/company-1/reimbursements?tab=mine&amp;filter=correction"'));
  assert.ok(claim.includes(`href="/companies/company-1/reimbursements/${ids.request}/edit?tab=mine&amp;filter=correction"`));
  const step = claim.slice(claim.indexOf('aria-labelledby="journey-step-title"'), claim.indexOf('</section>', claim.indexOf('aria-labelledby="journey-step-title"')));
  assert.match(step, /<button[^>]*data-variant="danger"[^>]*>ลบร่าง<\/button>/);
  assert.equal(visible(claim).filter(text => text === 'ลบร่าง').length, 1);
});

describe('paid claim rows show a quiet completion fact in phone cards and wide tables', () => {
  for (const [name, documentSignedVia, roles] of [
    ['digital', 'DIGITAL', ['REQUESTER', 'APPROVER']], ['paper', 'PAPER', []],
    ['neither', null, []], ['half signed', null, ['REQUESTER']],
  ] as const) {
    it(name, () => {
      const html = hubTab('mine', [{ ...paid, documentSignedVia, signatures: roles.map(role => ({ role })) }]);
      const words = visible(html);
      assert.equal(words.filter(word => word === 'ยังไม่ได้เซ็นใบเบิก').length, 0, 'no second status line');
      assert.equal([...html.matchAll(/mangmee-badge-brand">จ่ายแล้ว</gu)].length, documentSignedVia ? 2 : 0);
      assert.equal(words.filter(word => word === 'รอเซ็นใบเบิก').length, documentSignedVia ? 0 : 2, 'unsigned paid claims carry one actionable badge');
      assert.doesNotMatch(html, /reimbursement-current-desk|ยังไม่ได้เซ็นใบเบิก/);
    });
  }
});
