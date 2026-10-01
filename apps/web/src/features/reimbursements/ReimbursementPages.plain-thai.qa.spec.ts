import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { ReimbursementSourceOption, ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
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
const { ReimbursementsHubPage } = require('./ReimbursementsPages') as typeof import('./ReimbursementsPages');
const { ReimbursementSourceFacts } = require('./ReimbursementSourceFacts') as typeof import('./ReimbursementSourceFacts');
const { approvalComparable, diffApprovalFields } = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
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
    onUploadSignedCopy: noop, onRequestVoidPayment: noop })));

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
/** One hub tab, its queue loaded with the row (each queue starts as an empty list, loading). */
const hubTab = (tab: string) => renderWithState(
  h(AppRouterContext.Provider, { value: router }, h(SearchParamsContext.Provider, { value: new URLSearchParams(`tab=${tab}`) },
    h(ToastContext.Provider, { value: toast },
      h(ReimbursementsHubPage, { companyId: 'company-1', userId: ids.requester, roles: ['OWNER'], permissions: hubPermissions })))),
  (initial) => (Array.isArray(initial) && initial.length === 0 ? [queueRow] : initial === true ? false : undefined),
);

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
      'PDF, JPG/JPEG, PNG, HEIC/HEIF หรือ GIF', 'นำไฟล์ออก']) assert.ok(cardTexts.includes(text), text);
    // The typed line takes a receipt upload; the line picked from a saved bill keeps that bill's files instead.
    assert.equal(cards.match(/type="file"/gu)?.length, 1);
    assert.equal(table.match(/type="file"/gu)?.length, 1);
    assert.ok(visible(table).includes('ใบเสร็จ'), 'the table keeps its receipt column');
    assert.ok(visible(detailSections(paid, ids.requester, [])).includes('27 ก.ย. 2569 · เดินทาง'), 'a card names the line category by its label');
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
      ['stale-approval dialog', staleDialog({ ...draft, status: 'PENDING_APPROVAL', amount: '1234.5000', lineCount: 1 }, { ...paid, status: 'PENDING_APPROVAL' })],
      ['stale-approval dialog: enums added later, LINE-made lines', staleDialog({ ...later, lineCount: 1 }, { ...later, lines: draft.lines })],
      ['create form: new claim', renderToStaticMarkup(createPage())],
      ['create form: source picked, rows folded', filledCreatePage()],
      ['create form: rows bound to bills that were refused', filledCreatePage(refusedForm)],
      ...['mine', 'approvals', 'finance'].map((tab): [string, string] => [`hub: ${tab}`, hubTab(tab)]),
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
