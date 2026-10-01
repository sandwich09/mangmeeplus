import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastContext } from '@/common/components/toast/use-toast';

/*
 * The payment step as a payer and a reader see it (owner decisions 2026-10-01): no method is chosen for
 * the payer, a transfer needs its slip, the slip field takes a phone's camera or photo library, ดูสลิป is
 * offered only to the people the slip endpoint serves, and every word on screen is plain Thai.
 */
(globalThis as typeof globalThis & { React: typeof React }).React = React;
// The pages reach the icon set through ExpensesUi; this runner has no SVG loader (as ReimbursementPages.plain-thai.qa.spec.ts).
require.extensions['.svg'] = (module) => { module.exports = () => null; };
// Modal portals into document.body, which a server render has none of: render the dialog in place.
Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
const sections = require('./ReimbursementDetailSections') as typeof import('./ReimbursementDetailSections');
const reactRuntime = require('react') as typeof React;

const h = React.createElement;
const noop = () => undefined;
const toast = { success: noop, warning: noop, error: noop };

/** What the customer reads: text nodes plus aria labels, placeholders and tooltips; never other attributes such as links. */
const visible = (html: string) => [...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/gu)].map(match => match[1]!),
  ...html.replace(/<[^>]*>/gu, '\n').split('\n')]
  .map(text => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

// Ids shaped like the real ones (cuid), so a leak into visible text cannot hide.
const ids = {
  request: 'cmg7x2k9p0001requestq8w3e5', requester: 'cmg7x2k9p0002userr4t6y8a1', approver: 'cmg7x2k9p0003useru1i3o5p7',
  payer: 'cmg7x2k9p0004userp5a7s9d1', auditor: 'cmg7x2k9p0005userd9f1g3h5', payment: 'cmg7x2k9p0007paymentk9l1z3',
  voided: 'cmg7x2k9p0008paymentb2n4m6', slip: 'cmg7x2k9p0010slipn1m3q5w7e9', oldSlip: 'cmg7x2k9p0011slipr8t0y2u4i6',
  copy: 'cmg7x2k9p0012copye9r1t3y5u7', step: 'cmg7x2k9p0009stepx3c5v7b9',
};
const DOCUMENT_NUMBERS = ['RB-202609-00007', 'RBPAY-202609-00001', 'RBPAY-202609-00002'];

const base = {
  id: ids.request, requestNo: 'RB-202609-00007', status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', financeReviewStatus: 'NOT_REQUIRED',
  receiptRequirementStatus: 'ATTACHED', duplicateStatus: 'NO_MATCH', requesterUserId: ids.requester, requesterDisplayNameSnapshot: 'พิม ใจดี',
  reason: 'ไปพบลูกค้า', amount: '1614.5000', outstandingAmount: '1614.5000', currency: 'THB', categoryLabelSnapshot: 'เดินทาง',
  submittedAt: '2026-09-27T03:00:00.000Z', approvedAt: '2026-09-27T05:00:00.000Z', claimFormLayout: 'TWO_SIGNERS', documentSignedVia: null as string | null,
  lines: [] as unknown[], signatures: [] as unknown[], signedCopies: [] as any[], duplicateCandidates: [] as unknown[],
  approvalSteps: [{ id: ids.step, sequenceNo: 1, status: 'APPROVED', decisionByUserId: ids.approver, decidedByName: 'สมชาย', approverName: 'สมชาย',
    assignedAt: '2026-09-27T03:00:00.000Z', decidedAt: '2026-09-27T05:00:00.000Z' }],
  payments: [] as any[],
};
const slip = (attachmentId: string) => ({ attachmentId, attachedAt: '2026-09-29T03:00:00.000Z' });
// `viewerCanOpenSlips` is the API's verdict for whoever asked for the claim; here, a viewer it serves.
const voidedTransfer = { id: ids.voided, paymentNo: 'RBPAY-202609-00001', paidAmount: '1614.5000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
  paidAt: '2026-09-28T03:00:00.000Z', paymentReference: 'TXN-1001', status: 'VOIDED', voidReason: 'บันทึกเลขอ้างอิงผิด', paidByUserId: ids.payer, paidByName: 'สมศรี',
  slipCount: 1, slips: [slip(ids.oldSlip)], viewerCanOpenSlips: true };
const transfer = { id: ids.payment, paymentNo: 'RBPAY-202609-00002', paidAmount: '1614.5000', currency: 'THB', paymentMethod: 'BANK_TRANSFER',
  paidAt: '2026-09-29T03:00:00.000Z', paymentReference: 'TXN-1002', status: 'RECORDED', paidByUserId: ids.payer, paidByName: 'สมศรี',
  slipCount: 1 as number | undefined, slips: [slip(ids.slip)] as ReturnType<typeof slip>[] | undefined, viewerCanOpenSlips: true as boolean | undefined };
/** The same claim as the API returns it to a reader it does not serve slips to: how many slips, and none of the files. */
const refusedSlips = (detail: typeof paid) => ({ ...detail, payments: detail.payments.map((payment) => ({ ...payment, slips: [], viewerCanOpenSlips: false })) });
const misfiled = { attachmentId: ids.copy, fileName: 'สลิปโอนเงิน.jpg', uploadedAt: '2026-09-29T05:00:00.000Z', acknowledgedAt: '2026-09-29T05:00:00.000Z', acknowledgedByName: 'สมชาย' };
const paid = { ...base, status: 'PAID', paymentStatus: 'PAID', outstandingAmount: '0.0000', payments: [voidedTransfer, transfer] };

/**
 * The payment form with some of its state swapped in. Its own useState calls come first and in a fixed
 * order (fields, slip, error, busy), so the first two `null` initial values are the slip and the error.
 */
function paymentForm(request: object, state: { method?: string; slip?: object; error?: string } = {}): string {
  const realUseState = reactRuntime.useState;
  let nulls = 0;
  Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
    const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
    const start = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    if (start && typeof start === 'object' && 'paymentMethod' in start) return [{ ...start, paymentMethod: state.method ?? '' }, set];
    if (start === null) {
      nulls += 1;
      if (nulls === 1 && state.slip) return [state.slip, set];
      if (nulls === 2 && state.error) return [state.error, set];
    }
    return [value, set];
  });
  try {
    return renderToStaticMarkup(h(ToastContext.Provider, { value: toast },
      h(sections.PaymentForm, { companyId: 'company-1', request, onCancel: noop, onDone: noop })));
  } finally { Reflect.set(reactRuntime, 'useState', realUseState); }
}

const detailSections = (detail: object, userId: string, permissions: string[]) => renderToStaticMarkup(
  h(sections.ClaimDetailSections, { detail, userId, permissions, busy: false, onOpenAttachment: noop, onLineReceipt: noop, onSign: noop,
    onUploadSignedCopy: noop, onRequestVoidPayment: noop, onOpenPaymentSlip: noop, onAttachPaymentSlip: noop, onUseSignedCopyAsSlip: noop }));

/** The markup of one payment row, by its payment number. */
function paymentRow(html: string, paymentNo: string): string {
  const rows = html.split('data-testid="reimbursement-payment-row"').slice(1);
  const row = rows.find((part) => part.includes(paymentNo));
  assert.ok(row, `no payment row for ${paymentNo}`);
  return row.split('</li>')[0]!;
}

describe('payment form: the payer chooses the method', () => {
  it('opens with no method selected, never เงินสด', () => {
    const html = paymentForm(base);
    const method = /<summary[^>]*role="combobox"[^>]*aria-label="วิธีจ่าย"[^>]*>(.*?)<\/summary>/su.exec(html);
    assert.ok(method, 'the method control is on the form');
    assert.match(method[1]!, /เลือกวิธีจ่าย/);
    assert.doesNotMatch(method[1]!, /เงินสด|โอนเงิน|เช็ค|อื่น ๆ/);
    assert.match(method[0], /aria-required="true"/);
    assert.ok(visible(html).includes('วิธีจ่าย *'));
    // Nothing about the slip is forced before a method is chosen.
    assert.ok(visible(html).includes('สลิปหรือหลักฐานการจ่าย'));
  });

  it('shows the chosen method, and marks the reference and the slip as required for a transfer only', () => {
    const transferForm = visible(paymentForm(base, { method: 'BANK_TRANSFER' }));
    for (const text of ['โอนเงิน', 'เลขอ้างอิง *', 'สลิปหรือหลักฐานการจ่าย *']) assert.ok(transferForm.includes(text), text);
    assert.ok(transferForm.some((text) => text.startsWith('จ่ายด้วยการโอนต้องแนบสลิป')));

    const cashForm = visible(paymentForm(base, { method: 'CASH' }));
    for (const text of ['เงินสด', 'เลขอ้างอิง', 'สลิปหรือหลักฐานการจ่าย']) assert.ok(cashForm.includes(text), text);
    assert.ok(cashForm.some((text) => text.startsWith('แนบได้ถ้ามี ไม่บังคับสำหรับวิธีจ่ายนี้')));
    assert.equal(cashForm.includes('สลิปหรือหลักฐานการจ่าย *'), false);
  });
});

describe('payment form: the slip', () => {
  it('takes a file from a phone camera or photo library, in the file types receipts accept', () => {
    const html = paymentForm(base, { method: 'BANK_TRANSFER' });
    const input = /<input[^>]*type="file"[^>]*>/u.exec(html);
    assert.ok(input, 'a file input is on the form');
    for (const type of ['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/heif', '.jpg', '.pdf']) assert.ok(input[0].includes(type), type);
    // `capture` would force the camera and hide the photo library, where a saved bank slip lives.
    assert.doesNotMatch(input[0], /capture/);
    assert.match(input[0], /aria-label="สลิปหรือหลักฐานการจ่าย"/);
    assert.match(input[0], /aria-required="true"/);
    assert.ok(visible(html).some((text) => text.includes('PDF, JPG/JPEG, PNG, HEIC/HEIF หรือ GIF ขนาดไม่เกิน 10 MB')));
  });

  it('shows the file the payer picked, and the one already uploaded when saving failed', () => {
    const picked = visible(paymentForm(base, { method: 'BANK_TRANSFER', slip: { file: { name: 'สลิป-กสิกร.jpg' } } }));
    assert.ok(picked.includes('สลิป-กสิกร.jpg'));
    const message = 'แนบสลิปแล้ว แต่ยังบันทึกจ่ายไม่สำเร็จ · คำขอถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง · ตรวจข้อมูลแล้วกดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่';
    const failed = visible(paymentForm(base, { method: 'BANK_TRANSFER', slip: { attachmentId: ids.slip, name: 'สลิป-กสิกร.jpg' }, error: message }));
    // Everything typed stays, the uploaded slip stays, and the banner says the payment is not recorded yet.
    for (const text of ['สลิป-กสิกร.jpg', 'โอนเงิน', `⚠ ${message}`, 'บันทึกจ่าย']) assert.ok(failed.includes(text), text);
  });

  it('says the slip is missing in the form\'s own banner', () => {
    const html = paymentForm(base, { method: 'BANK_TRANSFER', error: 'จ่ายด้วยการโอนต้องแนบสลิป' });
    assert.match(html, /<div[^>]*role="alert"[^>]*>⚠ จ่ายด้วยการโอนต้องแนบสลิป<\/div>/u);
    // Above the buttons, inside the form: a payer on a phone sees it without leaving the card.
    assert.ok(html.indexOf('role="alert"') < html.indexOf('type="submit"'));
  });

  it('offers the files already on the claim only when there are any', () => {
    assert.doesNotMatch(paymentForm(base, { method: 'BANK_TRANSFER' }), /เลือกจากไฟล์ที่แนบไว้ในใบนี้/);
    // The hub queue row has no attachments at all: the form still works, with the upload alone.
    assert.doesNotMatch(paymentForm({ id: ids.request, outstandingAmount: '1614.5000', currency: 'THB' }, { method: 'BANK_TRANSFER' }), /เลือกจากไฟล์ที่แนบไว้ในใบนี้/);

    const withFiles = { ...base, payments: [voidedTransfer], signedCopies: [misfiled] };
    assert.ok(visible(paymentForm(withFiles, { method: 'BANK_TRANSFER' })).includes('เลือกจากไฟล์ที่แนบไว้ในใบนี้'));
    // Choosing the misfiled signed copy says what will happen to it.
    const chosen = visible(paymentForm(withFiles, { method: 'BANK_TRANSFER', slip: { attachmentId: ids.copy, name: 'สลิปโอนเงิน.jpg · แนบไว้ที่ใบเบิกที่เซ็นแล้ว' } }));
    assert.ok(chosen.some((text) => text.startsWith('เมื่อบันทึกจ่าย ไฟล์นี้จะย้ายจากรายการใบเบิกที่เซ็นแล้วมาเป็นสลิปของการจ่ายนี้')));
    const earlierSlip = visible(paymentForm(withFiles, { method: 'BANK_TRANSFER', slip: { attachmentId: ids.oldSlip, name: 'สลิปของการจ่ายที่ยกเลิกแล้ว RBPAY-202609-00001' } }));
    assert.equal(earlierSlip.some((text) => text.startsWith('เมื่อบันทึกจ่าย ไฟล์นี้จะย้าย')), false);
  });
});

describe('payment list: one record, the same facts, and ดูสลิป for its readers only', () => {
  it('shows method, date, reference, amount and the slip of each payment from that payment\'s own record', () => {
    const html = detailSections(paid, ids.payer, ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.payment.void']);
    const standing = visible(paymentRow(html, 'RBPAY-202609-00002'));
    for (const text of ['RBPAY-202609-00002', '1,614.50 บาท', 'โอนเงิน · บันทึกแล้ว', 'วันที่จ่าย 29 ก.ย. 2569 · เลขอ้างอิง TXN-1002', 'จ่ายโดย สมศรี', 'มีสลิปแนบ 1 ไฟล์', 'ดูสลิป']) {
      assert.ok(standing.includes(text), `${text} in ${JSON.stringify(standing)}`);
    }
    // The voided record keeps its own slip, method and reference, and takes no new slip.
    const history = visible(paymentRow(html, 'RBPAY-202609-00001'));
    for (const text of ['วันที่จ่าย 28 ก.ย. 2569 · เลขอ้างอิง TXN-1001', 'สลิปของการจ่ายที่ยกเลิกแล้ว 1 ไฟล์', 'ดูสลิป', 'เหตุผลที่ยกเลิก: บันทึกเลขอ้างอิงผิด']) {
      assert.ok(history.includes(text), `${text} in ${JSON.stringify(history)}`);
    }
    assert.equal(history.includes('แนบสลิปเพิ่ม'), false);
    assert.equal(history.includes('ยกเลิกการจ่าย'), false);
    assert.ok(standing.includes('แนบสลิปเพิ่ม'), 'a payer may add a slip to the standing payment');
  });

  // Who may open a slip is decided by the API, per claim, and reported on each payment of the detail
  // (the API spec "tells each viewer in the claim detail exactly what the slip endpoint will answer
  // them" pins the two together). The page follows that verdict and nothing else.
  it('offers ดูสลิป exactly when the API says this viewer may open the slip, whatever the session\'s permissions', () => {
    const everyRight = ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.finance_review', 'reimbursement.approve'];
    const cases: [string, object, string, string[], boolean][] = [
      ['a reader the API serves', paid, ids.requester, ['reimbursement.read_own'], true],
      ['a finance reviewer the API serves', paid, 'cmg7x2k9p0020useraccount', ['reimbursement.read', 'reimbursement.finance_review'], true],
      ['an ordinary reader', refusedSlips(paid), ids.auditor, ['reimbursement.read', 'reimbursement.export'], false],
      // A session whose permissions are out of date must not conjure the button, nor hide it.
      ['a stale session that still lists every right', refusedSlips(paid), ids.payer, everyRight, false],
      ['a stale session that lists none', paid, ids.auditor, [], true],
      // An answer that carries no verdict offers nothing.
      ['no verdict in the answer', { ...paid, payments: [{ ...transfer, viewerCanOpenSlips: undefined }] }, ids.payer, everyRight, false],
    ];
    for (const [label, detail, userId, permissions, offered] of cases) {
      const row = visible(paymentRow(detailSections(detail, userId, permissions), 'RBPAY-202609-00002'));
      assert.ok(row.includes('มีสลิปแนบ 1 ไฟล์'), `${label}: everyone who reads the claim sees that a slip exists`);
      assert.equal(row.includes('ดูสลิป'), offered, label);
    }
    // The count is the API's own, so it is right for a reader who is not given the files: two slips, none listed.
    const twoSlips = { ...paid, payments: [{ ...transfer, slipCount: 2, slips: [], viewerCanOpenSlips: false }] };
    const counted = visible(paymentRow(detailSections(twoSlips, ids.auditor, ['reimbursement.read']), 'RBPAY-202609-00002'));
    assert.ok(counted.includes('มีสลิปแนบ 2 ไฟล์'));
    assert.equal(counted.includes('ดูสลิป'), false);
    assert.equal(counted.includes('ไม่มีสลิปแนบ'), false);
  });

  it('says so when a payment has no slip, and lets only a payer attach one', () => {
    const legacy = { ...paid, payments: [{ ...transfer, slipCount: 0, slips: undefined }] };
    const payerRow = visible(paymentRow(detailSections(legacy, ids.payer, ['reimbursement.read', 'reimbursement.payment.record']), 'RBPAY-202609-00002'));
    assert.ok(payerRow.includes('ไม่มีสลิปแนบ'));
    assert.ok(payerRow.includes('แนบสลิป'));
    assert.equal(payerRow.includes('ดูสลิป'), false);
    const readerRow = visible(paymentRow(detailSections(legacy, ids.requester, ['reimbursement.read_own']), 'RBPAY-202609-00002'));
    assert.ok(readerRow.includes('ไม่มีสลิปแนบ'));
    assert.equal(readerRow.includes('แนบสลิป'), false);
  });
});

describe('ใบเบิกที่เซ็นแล้ว is not where a slip goes', () => {
  const withCopy = { ...paid, payments: [{ ...transfer, slipCount: 0, slips: [] }], signedCopies: [misfiled], documentSignedVia: 'PAPER' };
  const NOT_FOR_SLIPS = 'ช่องนี้สำหรับใบเบิกที่มีลายเซ็นเท่านั้น ไม่ใช่ที่แนบสลิปโอนเงิน สลิปโอนเงินแนบที่ขั้นจ่ายเงินคืน ตอนกดบันทึกจ่าย';

  it('says so under the uploader and in its dialog', () => {
    assert.ok(visible(detailSections(withCopy, ids.requester, ['reimbursement.read_own'])).includes(NOT_FOR_SLIPS));
    // The dialog opens once a file is picked: start it with one.
    const realUseState = reactRuntime.useState;
    Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
      const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
      return [initial === null ? { name: 'สแกนใบเบิก.pdf' } : value, set];
    });
    Object.assign(globalThis, { document: { body: {} } }); // Modal's portal target; never touched by a server render
    let dialog: string[];
    try { dialog = visible(detailSections(withCopy, ids.requester, ['reimbursement.read_own'])); } finally {
      Reflect.set(reactRuntime, 'useState', realUseState);
      Reflect.deleteProperty(globalThis, 'document');
    }
    assert.ok(dialog.includes(NOT_FOR_SLIPS), 'under the uploader');
    assert.ok(dialog.includes(`⚠ ${NOT_FOR_SLIPS}`), 'and as the warning inside the dialog');
    assert.ok(dialog.includes('สแกนใบเบิก.pdf'));
  });

  it('lets a payer move a file from there to the standing payment, and nobody else', () => {
    const payer = visible(detailSections(withCopy, ids.payer, ['reimbursement.read', 'reimbursement.payment.record']));
    assert.ok(payer.includes('ใช้ไฟล์นี้เป็นสลิปการจ่าย'));
    for (const [userId, permissions] of [
      [ids.requester, ['reimbursement.read_own']],
      [ids.approver, ['reimbursement.read_related', 'reimbursement.approve']],
      ['cmg7x2k9p0020useraccount', ['reimbursement.read', 'reimbursement.finance_review']],
    ] as const) {
      assert.equal(visible(detailSections(withCopy, userId, [...permissions])).includes('ใช้ไฟล์นี้เป็นสลิปการจ่าย'), false);
    }
    // No standing payment yet (voided, not paid again): there is nothing to move the file to from here;
    // the payment form offers it instead.
    const unpaid = { ...withCopy, status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', payments: [voidedTransfer] };
    assert.equal(visible(detailSections(unpaid, ids.payer, ['reimbursement.read', 'reimbursement.payment.record'])).includes('ใช้ไฟล์นี้เป็นสลิปการจ่าย'), false);
  });

  // The move withdraws a "signed on paper" declaration. It is the fix for a payment that has no slip,
  // not a way to add a second one: a payment that carries its slip takes more by upload, from its own row.
  it('does not offer the move once the standing payment has a slip', () => {
    const paidWithSlip = { ...paid, signedCopies: [misfiled], documentSignedVia: 'PAPER' };
    const payer = visible(detailSections(paidWithSlip, ids.payer, ['reimbursement.read', 'reimbursement.payment.record']));
    assert.equal(payer.includes('ใช้ไฟล์นี้เป็นสลิปการจ่าย'), false);
    assert.ok(payer.includes('แนบสลิปเพิ่ม'), 'the payment row still takes another slip');
    assert.ok(payer.some((text) => text.includes('สลิปโอนเงิน.jpg')), 'the copy stays listed where it is');
  });
});

const MACHINE_TOKENS: Array<[string, RegExp]> = [ // ReimbursementPages.plain-thai.qa.spec.ts's set
  ['cuid/uuid/hash-like id', /\b[a-z0-9]{20,}\b|[0-9a-f]{8}-[0-9a-f]{4}-/iu], ['enum or code', /[A-Z_]{4,}/u],
  ['field path', /\w+\.\d+\.\w+|\b[a-zA-Z]\w*\.(?:\d|[a-z]\w*\b)/u], ['camelCase key', /\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u],
  ['ISO date', /\d{4}-\d{2}-\d{2}/u], ['3+ decimal amount', /\d\.\d{3,}/u], ['category key or currency code', /\b(?:travel|meals|supplies|accommodation|other|THB)\b/u],
  ['raw JSON', /[{}[\]"]/u],
];

describe('no payment-step text carries a machine token (Owner rule 2026-09-27/29)', () => {
  it('holds for the form in every state and the payment list for every reader', () => {
    const withFiles = { ...base, payments: [voidedTransfer], signedCopies: [misfiled] };
    const pages: Array<[string, string]> = [
      ['form: just opened', paymentForm(base)],
      ['form: transfer', paymentForm(base, { method: 'BANK_TRANSFER' })],
      ['form: cash', paymentForm(base, { method: 'CASH' })],
      ['form: a method the API may grow', paymentForm(base, { method: 'A_METHOD_ADDED_LATER' })],
      ['form: slip picked, save failed', paymentForm(base, { method: 'BANK_TRANSFER', slip: { attachmentId: ids.slip, name: 'สลิป-กสิกร.jpg' },
        error: 'แนบสลิปแล้ว แต่ยังบันทึกจ่ายไม่สำเร็จ · คำขอถูกแก้ไขระหว่างทำรายการ · ตรวจข้อมูลแล้วกดบันทึกจ่ายอีกครั้ง ไม่ต้องแนบสลิปหรือโอนเงินใหม่' })],
      ['form: files on the claim', paymentForm(withFiles, { method: 'BANK_TRANSFER', slip: { attachmentId: ids.copy, name: 'สลิปโอนเงิน.jpg · แนบไว้ที่ใบเบิกที่เซ็นแล้ว' } })],
      ['list: payer', detailSections(paid, ids.payer, ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.payment.void'])],
      ['list: ordinary reader', detailSections(refusedSlips(paid), ids.auditor, ['reimbursement.read'])],
      ['list: misfiled copy, payer', detailSections({ ...paid, payments: [{ ...transfer, slipCount: 0, slips: [] }], signedCopies: [misfiled], documentSignedVia: 'PAPER' },
        ids.payer, ['reimbursement.read', 'reimbursement.payment.record'])],
    ];
    let checked = 0;
    for (const [page, html] of pages) {
      for (const raw of visible(html)) {
        // Payment references are the payer's own text; document numbers print on the documents themselves.
        const shown = [...DOCUMENT_NUMBERS, 'TXN-1001', 'TXN-1002'].reduce((text, number) => text.replaceAll(number, ''), raw).replace(/\b(?:JPEG|HEIC|HEIF)\b/gu, '');
        for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name} on ${page}: ${raw}`);
        checked += 1;
      }
    }
    assert.ok(checked > 150, `only ${checked} texts rendered`);
  });
});
