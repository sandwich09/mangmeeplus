import { ATTACHMENT_SOURCE_TYPES_LABEL } from '@watchdog-bms/contracts';
import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const logic = require('./reimbursements.logic') as typeof import('./reimbursements.logic');
it('a confirmed duplicate refusal never asks the payer to retry payment, even after a slip upload', () => {
  for (const slipKept of [true, false]) {
    const text = logic.paymentSaveErrorMessage('record', { code: 'duplicate_confirmed', status: 422, details: { claimStatus: 'READY_FOR_PAYMENT', canCancel: true } }, slipKept);
    assert.match(text, /กดยกเลิกคำขอในหน้าใบเบิก/);
    assert.match(text, /ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ/);
    assert.doesNotMatch(text, /กดบันทึกจ่ายอีกครั้ง|ปลดรายการซ้ำ/);
  }
});
const reactRuntime = require('react') as typeof React;

const h = React.createElement;
const noop = () => undefined;
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
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
 * order (fields, the payer's statement, slip, error, busy), so the first two `null` initial values are the
 * slip and the error. A method not given is the one the form itself starts from.
 */
function paymentForm(request: object, state: { method?: string; slip?: object; error?: string; reference?: string } = {}, onOpenFile: (choice: unknown) => void = noop): string {
  const realUseState = reactRuntime.useState;
  let nulls = 0;
  Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
    const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
    const start = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    if (start && typeof start === 'object' && 'paymentMethod' in start) return [{ ...start, ...(state.method !== undefined && { paymentMethod: state.method }), ...(state.reference !== undefined && { paymentReference: state.reference }) }, set];
    if (start === null) {
      nulls += 1;
      if (nulls === 1 && state.slip) return [state.slip, set];
      if (nulls === 2 && state.error) return [state.error, set];
    }
    return [value, set];
  });
  try {
    return renderToStaticMarkup(h(ToastContext.Provider, { value: toast },
      h(sections.PaymentForm, { companyId: 'company-1', request, onCancel: noop, onDone: noop, onOpenFile })));
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
  for (const method of ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER']) {
    it(`names the reference and explains its evidence rule for ${method}`, () => {
      for (const hasSlip of [false, true]) {
        const html = paymentForm(base, { method, ...(hasSlip && { slip: { attachmentId: ids.slip, name: 'หลักฐาน.jpg' } }) });
        const required = method === 'CHEQUE' && !hasSlip;
        const label = method === 'BANK_TRANSFER' ? 'เลขที่อ้างอิงการโอน (ไม่บังคับเมื่อแนบสลิป)'
          : method === 'CHEQUE' ? `เลขที่เช็ค${required ? ' *' : ' (ไม่บังคับเมื่อแนบหลักฐาน)'}` : 'เลขที่เอกสารการจ่าย (ไม่บังคับ)';
        assert.ok(visible(html).includes(label), label);
        assert.equal(/<input[^>]*aria-label="เลขที่เช็ค"[^>]*aria-required="true"/.test(html), required);
        // Like a missing slip, the refusal is said on บันทึกจ่าย: the form neither locks the button nor warns while it is being filled.
        const submit = /<button\b([^>]*\btype="submit"[^>]*)>/.exec(html)?.[1] ?? '';
        assert.ok(!submit.includes('disabled=""'));
        assert.ok(!html.includes('กรอกเลขที่เช็คหรือแนบหลักฐานการจ่าย'));
        assert.ok(visible(html).some(text => method === 'BANK_TRANSFER' ? text.includes('บนสลิปหรือในแอปธนาคาร') && text.includes('กระทบยอด')
          : method === 'CHEQUE' ? text.includes('บนเช็ค') && text.includes('แนบหลักฐานการจ่าย') : text.includes('ใบสำคัญจ่ายหรือใบเสร็จรับเงิน')));
      }
      if (method === 'CHEQUE') {
        const numbered = paymentForm(base, { method, reference: 'CHQ-1' });
        assert.doesNotMatch(numbered, /type="submit"[^>]*disabled=""/);
        assert.ok(!numbered.includes('กรอกเลขที่เช็คหรือแนบหลักฐานการจ่าย'));
      }
    });
  }

  it('a refusal goes as soon as the payer changes the form, and the hint never ends on a lone syllable (screen check 2026-10-05)', () => {
    const source = read('./ReimbursementDetailSections.tsx');
    const form = source.slice(source.indexOf('export function PaymentForm('), source.indexOf('const attachmentPreviewMimeType'));
    // Every change the payer makes goes through a setter that first takes the refusal away: the method, the reference, evidence attached,
    // removed or chosen from the claim's own files, and the other fields alike. So the red box never contradicts the form in front of them.
    assert.match(form, /const edited = <T,>\(set: React\.Dispatch<React\.SetStateAction<T>>\): React\.Dispatch<React\.SetStateAction<T>> => \(next\) => \{ setError\(null\); set\(next\); \};/);
    assert.match(form, /const editForm = edited\(setForm\), editPayer = edited\(setPayer\), editSlip = edited\(setSlip\);/);
    assert.equal((form.match(/=> edit(?:Form|Payer|Slip)\(/g) ?? []).length, 8);
    assert.doesNotMatch(form, /onChange=\{[^}]*=> set(?:Form|Payer|Slip)\(/);
    // The slip the form swaps in after its own upload is not the payer's change: a refusal said after that upload stays on screen.
    assert.match(form, /onSlipUploaded: setSlip,/);
    assert.match(form, /\{validationError && <ErrorBanner message=\{validationError\} \/>\}/);
    // Seen at 390 px: the cash hint ended with "หลัง" alone on its last line.
    for (const method of ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER']) assert.match(paymentForm(base, { method }), /<p id="[^"]*-hint" class="mt-1 text-pretty text-xs leading-5 text-gray-500">/);
  });

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

  it('shows the chosen method, requires a transfer slip and explains its optional reference', () => {
    const transferForm = visible(paymentForm(base, { method: 'BANK_TRANSFER' }));
    for (const text of ['โอนเงิน', 'เลขที่อ้างอิงการโอน (ไม่บังคับเมื่อแนบสลิป)', 'สลิปหรือหลักฐานการจ่าย *']) assert.ok(transferForm.includes(text), text);
    assert.ok(transferForm.some((text) => text.startsWith('จ่ายด้วยการโอนต้องแนบสลิป')));

    const cashForm = visible(paymentForm(base, { method: 'CASH' }));
    for (const text of ['เงินสด', 'เลขที่เอกสารการจ่าย (ไม่บังคับ)', 'สลิปหรือหลักฐานการจ่าย']) assert.ok(cashForm.includes(text), text);
    assert.ok(cashForm.some((text) => text.startsWith('แนบได้ถ้ามี ไม่บังคับสำหรับวิธีจ่ายนี้')));
    assert.equal(cashForm.includes('สลิปหรือหลักฐานการจ่าย *'), false);
  });

  // Spec §12.2: the method starts from what the requester asked for. A claim sent before claims carried a
  // receiving method asked for nothing, so nothing is chosen for its payer, and เงินสด is never a fallback.
  // What the form then asks about the account is ReimbursementPayStep.qa.spec.ts.
  it('starts from the method the claim asks for, and from none for a claim that asked for nothing', () => {
    const chosen = (request: object) => /<summary[^>]*role="combobox"[^>]*aria-label="วิธีจ่าย"[^>]*>(.*?)<\/summary>/su.exec(paymentForm(request))![1]!;
    const account = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'พิม ใจดี', accountLast4: '6789',
      version: 1, source: 'DEFAULT_ACCOUNT', canRevealAccountNumber: true };
    assert.match(chosen({ ...base, payoutMethod: 'BANK_TRANSFER', payout: account }), /โอนเงิน/);
    assert.match(chosen({ ...base, payoutMethod: 'CASH', payout: { payoutMethod: 'CASH' } }), /เงินสด/);
    for (const legacy of [base, { ...base, payout: undefined }, { ...base, payout: null },
      { ...base, legacyPayoutDefault: { payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'พิม ใจดี', accountLast4: '6789', confirmToken: '0'.repeat(32) } }]) {
      assert.match(chosen(legacy), /เลือกวิธีจ่าย/);
      assert.doesNotMatch(chosen(legacy), /เงินสด|โอนเงิน|เช็ค|อื่น ๆ/);
    }
    // It is a starting value in the form's own state, which the payer changes like any other field.
    assert.match(read('./ReimbursementDetailSections.tsx'), /paymentMethod: requestedPayout\(request\)\?\.payoutMethod \?\? ''/);
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
    // The shared sentence, read whole; on screen every file-type name and the size are unbreakable, so a phone never cuts "ฮีอิก" in two.
    const whole = (markup: string) => markup.replace(/<span class="whitespace-nowrap">([^<]*)<\/span>/gu, '$1');
    assert.ok(visible(whole(html)).some((text) => text.includes(`${ATTACHMENT_SOURCE_TYPES_LABEL} ขนาดไม่เกิน 10 เมกะไบต์`)));
    for (const name of [...ATTACHMENT_SOURCE_TYPES_LABEL.split(' '), '10 เมกะไบต์']) assert.ok(html.includes(`<span class="whitespace-nowrap">${name}</span>`), name);
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
    // Choosing the misfiled signed copy says what will happen to it, and names the file.
    const chosenHtml = paymentForm(withFiles, { method: 'BANK_TRANSFER', slip: { attachmentId: ids.copy, name: 'สลิปโอนเงิน.jpg' } });
    const note = /data-testid="reimbursement-payment-slip-move-note">([\s\S]*?)<\/p>/u.exec(chosenHtml)?.[1]?.replace(/<[^>]+>/gu, '') ?? '';
    assert.equal(note, 'เมื่อบันทึกจ่าย ไฟล์ สลิปโอนเงิน.jpg จะย้ายออกจากรายการใบเบิกที่เซ็นแล้วมาเป็นสลิปของการจ่ายนี้ และย้ายกลับไม่ได้ ถ้าเคยยืนยันว่าไฟล์นี้คือใบเบิกที่ลงนามครบ ระบบจะถอนการยืนยันนั้น');
    const earlierSlip = paymentForm(withFiles, { method: 'BANK_TRANSFER', slip: { attachmentId: ids.oldSlip, name: 'สลิปของการจ่ายที่ยกเลิกแล้ว RBPAY-202609-00001' } });
    assert.doesNotMatch(earlierSlip, /reimbursement-payment-slip-move-note/);
  });

  // Upgrade test 2026-10-02: a drop-down of names. The signed PDF came first and was picked as the slip, and nothing on
  // the page said what either file was or let the payer look before choosing.
  it('lists those files as choices of 44 px that say what each is, pictures first, each opened before it is chosen', () => {
    const signedForm = { attachmentId: 'att-form', fileName: 'signed-form-2.pdf', uploadedAt: '2026-09-30T05:00:00.000Z', acknowledgedAt: '2026-09-30T05:00:00.000Z', acknowledgedByName: 'สมชาย' };
    const withBoth = { ...base, signedCopies: [signedForm, misfiled] };
    const opened: unknown[] = [];
    const html = paymentForm(withBoth, { method: 'BANK_TRANSFER' }, (choice) => opened.push(choice));
    const list = html.slice(html.indexOf('data-testid="reimbursement-payment-slip-choices"'));
    const picker = list.slice(0, list.indexOf('</div></div></div>'));
    assert.doesNotMatch(html, /<select[^>]*aria-label="เลือกจากไฟล์ที่แนบไว้ในใบนี้"/u, 'no drop-down');
    assert.match(picker, /role="radiogroup" aria-label="เลือกจากไฟล์ที่แนบไว้ในใบนี้"/u);
    const rows = [...picker.matchAll(/<label class="([^"]*)"><input type="radio"[^>]*\/?>(?:<\/input>)?<span class="min-w-0"><span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span>/gu)]
      .map((match) => ({ cls: match[1]!, name: match[2]!, what: match[3]! }));
    assert.deepEqual(rows.map((row) => [row.name, row.what]), [
      ['สลิปโอนเงิน.jpg', 'ไฟล์รูปภาพ · แนบไว้ที่ใบเบิกที่เซ็นแล้ว โดยยืนยันว่าเป็นใบเบิกที่ลงนามครบ'],
      ['signed-form-2.pdf', 'ไฟล์ PDF · แนบไว้ที่ใบเบิกที่เซ็นแล้ว โดยยืนยันว่าเป็นใบเบิกที่ลงนามครบ'],
    ], picker.slice(0, 900));
    for (const row of rows) assert.match(row.cls, /\bmin-h-11\b/u);
    assert.doesNotMatch(picker, /<input type="radio"[^>]*checked=""/u, 'nothing is chosen for the payer');
    // One way to look at each before choosing, 44 px high, wherever the form is shown: the handler is not optional.
    assert.equal((picker.match(/<button type="button" class="[^"]*\bmin-h-11\b[^"]*" aria-busy="false">เปิดดูไฟล์นี้<\/button>/gu) ?? []).length, 2);
    assert.ok(visible(picker).includes('ใช้แทนการแนบไฟล์ใหม่ได้ เลือกเฉพาะไฟล์ที่เป็นสลิปหรือหลักฐานการโอน เปิดดูก่อนเลือกได้'));
    // The file that is chosen is marked, and it is the one the sentence names.
    const chosen = paymentForm(withBoth, { method: 'BANK_TRANSFER', slip: { attachmentId: 'att-form', name: 'signed-form-2.pdf' } });
    assert.match(chosen, /data-testid="reimbursement-payment-slip-move-note">เมื่อบันทึกจ่าย ไฟล์ <span class="font-semibold">signed-form-2\.pdf<\/span> จะย้ายออกจากรายการใบเบิกที่เซ็นแล้ว/u);
    assert.equal((chosen.match(/<input type="radio"[^>]*checked=""/gu) ?? []).length, 1);
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

  // Upgrade test 2026-10-02: after a payment with a newly uploaded slip, the e-slip attached here by mistake stayed listed
  // as a paper-signed copy, with nothing on its row to say what it is or what to do about it.
  it('says on each file what it is, and tells whoever pays what to do about a slip attached here by mistake', () => {
    const PAYER_RIGHTS = ['reimbursement.read', 'reimbursement.payment.record'];
    const signedForm = { attachmentId: 'att-form', fileName: 'signed-form-2.pdf', uploadedAt: '2026-09-30T05:00:00.000Z', acknowledgedAt: '2026-09-30T05:00:00.000Z', acknowledgedByName: 'สมชาย' };
    const plain = { attachmentId: 'att-plain', fileName: 'หลักฐาน.png', uploadedAt: '2026-09-28T05:00:00.000Z' };
    const copies = { signedCopies: [signedForm, misfiled, plain], documentSignedVia: 'PAPER' };
    // Second run of the upgrade test: the sentence said nothing was needed, also when the payer had picked the signed PDF
    // as the slip and the real e-slip was the file left on this row. The page cannot know which file is which, so the
    // sentence is true either way, and names the control that puts the other case right.
    const SETTLED = 'ถ้าไฟล์นี้คือสลิปโอนเงินที่แนบผิดช่อง และสลิปที่แนบกับการจ่ายถูกต้องแล้ว ไม่ต้องทำอะไรเพิ่ม';
    const AFTER = `${SETTLED} ถ้าสลิปที่แนบกับการจ่ายไม่ใช่สลิปจริง ให้กดแนบสลิปเพิ่มที่แถวการจ่าย แล้วแนบสลิปจริง`;
    const BEFORE = 'ถ้าไฟล์นี้คือสลิปโอนเงินที่แนบผิดช่อง ไม่ต้องแนบใหม่ ตอนบันทึกจ่ายเลือกไฟล์นี้เป็นสลิปได้';
    const hints = (texts: string[]) => texts.filter((text) => text.startsWith('ถ้าไฟล์นี้คือสลิปโอนเงินที่แนบผิดช่อง'));

    // Paid, and the payment carries a slip: every reader sees what each file is; whoever pays is told what holds in both cases.
    const paidWithSlip = { ...paid, ...copies };
    const payer = visible(detailSections(paidWithSlip, ids.payer, PAYER_RIGHTS));
    for (const text of ['ไฟล์ PDF · ลงนามบนกระดาษ · แนบเมื่อ 30 ก.ย. 2569 โดย สมชาย', 'ไฟล์รูปภาพ · ลงนามบนกระดาษ · แนบเมื่อ 29 ก.ย. 2569 โดย สมชาย', 'ไฟล์รูปภาพ · ไฟล์แนบทั่วไป · แนบเมื่อ 28 ก.ย. 2569']) {
      assert.ok(payer.includes(text), `${text}: ${JSON.stringify(payer.filter((shown) => shown.includes('แนบเมื่อ')))}`);
    }
    assert.deepEqual(hints(payer), [AFTER, AFTER, AFTER]);
    // The control the sentence names is on the page, by that name, and the move button is not: no file moves once a payment has a slip.
    assert.deepEqual([payer.includes('แนบสลิปเพิ่ม'), payer.includes('ใช้ไฟล์นี้เป็นสลิปการจ่าย')], [true, false]);
    // A payment that takes no more slips has no such control, and the sentence names none.
    const full = { ...paidWithSlip, payments: [voidedTransfer, { ...transfer, slipCount: 5, slips: [1, 2, 3, 4, 5].map((n) => slip(`${ids.slip}${n}`)) }] };
    const atLimit = visible(detailSections(full, ids.payer, PAYER_RIGHTS));
    assert.deepEqual([hints(atLimit), atLimit.includes('แนบสลิปเพิ่ม')], [[SETTLED, SETTLED, SETTLED], false]);
    const requester = visible(detailSections(paidWithSlip, ids.requester, ['reimbursement.read_own']));
    assert.ok(requester.includes('ไฟล์รูปภาพ · ลงนามบนกระดาษ · แนบเมื่อ 29 ก.ย. 2569 โดย สมชาย'));
    assert.deepEqual(hints(requester), [], 'someone who records no payment has nothing to do about it');

    // Waiting for its payment: the file is chosen as the slip in the payment form, not uploaded again.
    const waiting = { ...base, ...copies, status: 'READY_FOR_PAYMENT', paymentStatus: 'UNPAID', payments: [] };
    assert.deepEqual(hints(visible(detailSections(waiting, ids.payer, PAYER_RIGHTS))), [BEFORE, BEFORE, BEFORE]);
    // Paid with no slip: the row has its own button, and that button is the answer.
    const paidNoSlip = { ...paid, ...copies, payments: [{ ...transfer, slipCount: 0, slips: [] }] };
    const withButton = visible(detailSections(paidNoSlip, ids.payer, PAYER_RIGHTS));
    assert.deepEqual(hints(withButton), []);
    assert.equal(withButton.filter((text) => text === 'ใช้ไฟล์นี้เป็นสลิปการจ่าย').length, 3);
    // Not at a point where a payment is recorded: nothing to say.
    assert.deepEqual(hints(visible(detailSections({ ...base, ...copies, status: 'PENDING_APPROVAL', payments: [] }, ids.payer, PAYER_RIGHTS))), []);
    assert.equal(logic.signedCopyMisfiledHint(paidWithSlip, PAYER_RIGHTS), AFTER);
    assert.equal(logic.signedCopyMisfiledHint(waiting, PAYER_RIGHTS), BEFORE);
    assert.equal(logic.signedCopyMisfiledHint(waiting, ['reimbursement.read']), null);
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

// Upgrade test 2026-10-02, second run: the dialog the pay queue's table opens (the layout of 1536 px and wider) listed the
// claim's files and the note about the move, and had no way to look at a file before choosing it. A signed PDF and an
// e-slip were chosen between blind. The dialog now has the claim page's own handler, and the form no longer takes none.
describe('the pay queue\'s dialog: every listed file is opened before it is chosen, as on the claim page', () => {
  const pages = require('./ReimbursementsPages') as typeof import('./ReimbursementsPages');
  const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime') as typeof import('next/dist/shared/lib/app-router-context.shared-runtime');
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' };
  const signedForm = { attachmentId: 'cmg7x2k9p0013copyf1g3h5j7k9', fileName: 'signed-form-2.pdf', uploadedAt: '2026-09-30T05:00:00.000Z', acknowledgedAt: '2026-09-30T05:00:00.000Z', acknowledgedByName: 'สมชาย' };
  const waiting = { ...base, branchId: 'branch-1', currentDesk: { kind: 'PAYMENT' }, payments: [voidedTransfer], signedCopies: [signedForm, misfiled] };
  const payerRights = ['reimbursement.read', 'reimbursement.payment.record'];

  /**
   * The dialog with its claim already read (the claim is its first null state), and the handlers of its
   * "เปิดดูไฟล์นี้" links in the order of the list: the page's own, taken from the buttons it renders.
   */
  function payDialog(claim: object) {
    const realUseState = reactRuntime.useState;
    const realCreateElement = reactRuntime.createElement;
    let nulls = 0;
    const openers: Array<() => void> = [];
    Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
      const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
      if (initial === null) { nulls += 1; if (nulls === 1) return [claim, set]; }
      return [value, set];
    });
    Reflect.set(reactRuntime, 'createElement', (type: unknown, props: { onClick?: () => void } | null, ...children: unknown[]) => {
      if (type === 'button' && children[0] === 'เปิดดูไฟล์นี้' && typeof props?.onClick === 'function') openers.push(props.onClick);
      return (realCreateElement as (...args: unknown[]) => unknown)(type, props, ...children);
    });
    Object.assign(globalThis, { document: { body: {} } }); // the dialog's portal target; never touched by a server render
    try {
      const html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: router as never }, h(ToastContext.Provider, { value: toast },
        h(pages.PaymentModal, { companyId: 'company-1', userId: ids.payer, permissions: payerRights, request: { id: ids.request, requestNo: 'RB-202609-00007' }, onClose: noop, onDone: noop }))));
      return { html, openers };
    } finally {
      Reflect.set(reactRuntime, 'useState', realUseState);
      Reflect.set(reactRuntime, 'createElement', realCreateElement);
      Reflect.deleteProperty(globalThis, 'document');
    }
  }

  /** Presses one link and returns the first thing the page then asks of the API. */
  async function firstRequest(open: () => void): Promise<string> {
    const asked: string[] = [];
    const realFetch = globalThis.fetch;
    const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.assign(globalThis, { window: {} });
    globalThis.fetch = (async (input: string | URL | Request) => { asked.push(String(input)); return Response.json({}); }) as typeof fetch;
    try {
      open();
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    } finally {
      globalThis.fetch = realFetch;
      if (realWindow) Object.defineProperty(globalThis, 'window', realWindow); else Reflect.deleteProperty(globalThis, 'window');
    }
    return asked[0] ?? '';
  }

  it('lists the same files as the claim page, each with a link of 44 px, and opens each through the endpoint that serves that kind of file', async () => {
    const { html, openers } = payDialog(waiting);
    const list = html.slice(html.indexOf('data-testid="reimbursement-payment-slip-choices"'));
    const picker = list.slice(0, list.indexOf('</div></div></div>'));
    const names = [...picker.matchAll(/<span class="min-w-0"><span[^>]*>([^<]*)<\/span>/gu)].map((match) => match[1]!);
    assert.deepEqual(names, ['สลิปของการจ่ายที่ยกเลิกแล้ว RBPAY-202609-00001', 'สลิปโอนเงิน.jpg', 'signed-form-2.pdf']);
    assert.equal((picker.match(/<button type="button" class="[^"]*\bmin-h-11\b[^"]*" aria-busy="false">เปิดดูไฟล์นี้<\/button>/gu) ?? []).length, 3);
    assert.ok(visible(picker).includes('ใช้แทนการแนบไฟล์ใหม่ได้ เลือกเฉพาะไฟล์ที่เป็นสลิปหรือหลักฐานการโอน เปิดดูก่อนเลือกได้'));
    assert.equal(openers.length, 3);
    // A slip of an earlier payment through the slip's own endpoint; a file of ใบเบิกที่เซ็นแล้ว as an attachment of the claim.
    const api = '/api/v1/companies/company-1';
    assert.equal(await firstRequest(openers[0]!), `${api}/reimbursements/${ids.request}/payments/${ids.voided}/slips/${ids.oldSlip}/download-url?disposition=inline`);
    assert.match(await firstRequest(openers[1]!), new RegExp(`^${api}/attachments/${ids.copy}/download-url`));
    assert.match(await firstRequest(openers[2]!), new RegExp(`^${api}/attachments/${signedForm.attachmentId}/download-url`));
    // Nothing of a file id is shown for it: the links are words.
    for (const id of [ids.oldSlip, ids.copy, signedForm.attachmentId]) assert.equal(visible(picker).some((text) => text.includes(id)), false);
  });

  // One handler for both hosts, and the viewer beside the dialog: closing a file leaves the form as it was.
  it('opens files by the handler the claim page uses, in a viewer that is not inside the dialog', () => {
    const hub = read('./ReimbursementsPages.tsx');
    const page = read('./ReimbursementJourneyPage.tsx');
    assert.match(hub, /const \{ openSlipChoice, previewModals \} = useClaimDocumentPreview\(companyId, setOpenFileError\);/);
    assert.match(hub, /<PaymentForm companyId=\{companyId\} request=\{claim\} onCancel=\{onClose\} onDone=\{onDone\} onClaimChanged=\{\(\) => onDone\(\)\}\s+onOpenFile=\{\(choice\) => void openSlipChoice\(claim\.id, choice\)\} \/>/);
    assert.match(page, /onOpenFile=\{\(choice\) => void openSlipChoice\(detail\.id, choice\)\} \/>/);
    assert.match(hub, /<\/Modal>\s+\{previewModals\}\s+<\/>/);
    // A file that cannot be opened says so inside the dialog, where the person is looking.
    assert.match(hub, /\{openFileError && <ErrorBanner message=\{`เปิดไฟล์ไม่สำเร็จ · \$\{openFileError\}`\} \/>\}/);
    // The form takes no host without the handler.
    assert.match(read('./ReimbursementDetailSections.tsx'), /\n  onOpenFile: \(choice: PaymentSlipChoice\) => void;\n\}\) \{/);
  });
});

it('a confirmed duplicate refusal rereads the claim and hands its current state to the host without reporting payment success', async () => {
  const realCreate = reactRuntime.createElement, realState = reactRuntime.useState, realFetch = globalThis.fetch;
  const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let submit: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  let shown: any, closed = false, successes = 0;
  const calls: string[] = [];
  const current = { ...base, duplicateBlocksPayment: true, duplicateReasons: ['EXPENSE_CONFIRMED_DUPLICATE'] };
  Reflect.set(reactRuntime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'form') submit = props.onSubmit;
    return (realCreate as any)(type, props, ...children);
  });
  Reflect.set(reactRuntime, 'useState', (initial: any) => {
    const [value, set] = realState(initial);
    return initial?.paymentMethod !== undefined ? [{ ...initial, paymentMethod: 'CASH' }, set] : [value, set];
  });
  Object.assign(globalThis, { window: {} });
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET');
    return init?.method === 'POST' ? Response.json({ code: 'duplicate_confirmed', claimStatus: 'READY_FOR_PAYMENT' }, { status: 422 }) : Response.json(current);
  }) as typeof fetch;
  try {
    renderToStaticMarkup(h(ToastContext.Provider, { value: { ...toast, success: () => { successes++; } } },
      h(sections.PaymentForm, { companyId: 'company-1', request: base, onCancel: () => { closed = true; }, onDone: () => { successes++; }, onOpenFile: noop,
        onClaimChanged: (latest: any) => { shown = latest; closed = true; } } as any)));
    assert.ok(submit);
    await submit({ preventDefault: noop });
    assert.deepEqual(calls, ['POST', 'GET']);
    assert.deepEqual(shown, current);
    assert.equal(closed, true);
    assert.equal(successes, 0);
  } finally {
    Reflect.set(reactRuntime, 'createElement', realCreate); Reflect.set(reactRuntime, 'useState', realState); globalThis.fetch = realFetch;
    if (realWindow) Object.defineProperty(globalThis, 'window', realWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
