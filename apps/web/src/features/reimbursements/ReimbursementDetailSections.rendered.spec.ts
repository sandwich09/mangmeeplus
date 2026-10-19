import * as React from 'react';
import { it, mock } from 'node:test';
import { certificateHarness, mutable } from '../expenses/expense-certificate-test-harness';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = module => { module.exports = () => null; };
require.extensions['.css'] = module => { module.exports = { menu: 'menu', panel: 'panel' }; };
const modal = mutable('@/common/components/modal/Modal');
const logic = mutable('../reimbursements/reimbursements.logic');
const ui = require('./ReimbursementDetailSections');
const payout = require('./ReimbursementPayout');
const h = React.createElement;
const noop = () => undefined;
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const render = (element: React.ReactElement) => renderToStaticMarkup(h(AppRouterContext.Provider,
  { value: { push: noop, prefetch: noop } as never }, h(ToastContext.Provider,
    { value: { success: noop, error: noop } as never }, element)));
const detail = { id: 'claim', requestNo: 'RB-1', status: 'DRAFT', requesterUserId: 'me', createdByUserId: 'me',
  requesterDisplayNameSnapshot: 'สมใจ', reason: 'เดินทาง', amount: '650', currency: 'THB', outstandingAmount: '650',
  lines: [{ lineNo: 1, description: 'ค่าเดินทาง', amount: '650', incurredDate: '2026-10-10' }], payments: [], signatures: [], signedCopies: [] };
const props = { detail, userId: 'me', permissions: ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.payment.void'], busy: false,
  onLineReceipt: noop, onOpenAttachment: noop, onSign: noop, onUploadSignedCopy: noop, onUseSignedCopyAsSlip: noop,
  onOpenPaymentSlip: noop, onAttachPaymentSlip: noop, onRequestVoidPayment: noop };

it('FIX-R1 signed-copy certification names only the signature boxes on this claim', () => {
  const transport = mock.method(modal, 'Modal', ({ children, footer }: any) => h('section', null, children, footer));
  try {
    for (const [claim, expected] of [
      [{ ...detail, approvedAt: '2026-10-10', approvalSteps: [] }, 'ผู้เบิก'],
      [detail, 'ผู้เบิกและผู้อนุมัติ'],
      [{ ...detail, claimFormLayout: 'LEGACY_FOUR_SIGNERS' }, 'ผู้เบิก ผู้อนุมัติ ฝ่ายบัญชี และฝ่ายการเงิน'],
    ] as const) {
      const html = render(h(ui.SignedCopyDialog, { requestNo: 'RB-1', fileName: 'ใบเบิก.pdf', detail: claim, onClose: noop, onSend: noop }));
      assert.ok(html.replace(/<!--.*?-->/g, '').includes(`สำเนานี้มีลายเซ็น${expected}ครบ`), expected);
    }
  } finally { transport.mock.restore(); }
});

it('FIX-R1 pay form holds cancel while recording the payment', () => {
  const source = read('./ReimbursementDetailSections.tsx');
  assert.match(source, /disabled=\{busy\} aria-busy=\{busy\} onClick=\{\(\) => \{ if \(!session.current.saving\) onCancel\(\); \}\}/);
  assert.match(read('./ReimbursementsPages.tsx'), /onClose=\{\(\) => \{ if \(!paymentSaving.current\) onClose\(\); \}\}/);
  assert.match(read('./ReimbursementsPages.tsx'), /onBusyChange=\{saving => \{ paymentSaving.current = saving; \}\}/);
});

it('FIX-R1 an in-flight payment ignores cancel and shows its busy state', async () => {
  let finish: () => void = noop, cancelled = 0;
  const save = mock.method(logic, 'savePaymentForm', async ({ session }: any, deps: any) => {
    session.saving = true; deps.onBusy(true);
    await new Promise<void>(resolve => { finish = resolve; });
    session.saving = false; deps.onBusy(false);
    return { status: 'refused', text: 'ลองอีกครั้ง' };
  });
  const view = certificateHarness(() => h(ToastContext.Provider, { value: { success: noop, error: noop } as never },
    h(ui.PaymentForm, { companyId: 'co', request: { ...detail, payout: { payoutMethod: 'CASH' } },
      onCancel: () => { cancelled++; }, onDone: noop, onOpenFile: noop })));
  try {
    view.render();
    const cancel = view.find('button', p => p.children.includes('ยกเลิก'));
    const pending = view.find('form').onSubmit({ preventDefault: noop });
    cancel.onClick();
    assert.equal(cancelled, 0);
    view.render();
    const busyCancel = view.find('button', p => p.children.includes('ยกเลิก'));
    assert.equal(busyCancel.disabled, true);
    assert.equal(busyCancel['aria-busy'], true);
    finish(); await pending;
    view.render();
    view.find('button', p => p.children.includes('ยกเลิก')).onClick();
    assert.equal(cancelled, 1);
  } finally { view.cleanup(); save.mock.restore(); }
});

it('CLAIM-DETAIL puts the badge with the state under the title on the flat page', () => {
  const page = read('./ReimbursementJourneyPage.tsx');
  assert.match(page, /className="mangmee-flat \[overflow-wrap:anywhere\]"/);
  assert.match(page, /description=\{<span[^>]*><StatusBadge claim=\{detail\} \/><span>\{readerTurn \?\? claimWaitingText\(detail\)\}<\/span><\/span>\}/);
  assert.doesNotMatch(page, /meta=\{<StatusBadge/);
});
it('CLAIM-DETAIL send stays pressable and focuses receipt first, then payout, without sending an incomplete claim', () => {
  const page = read('./ReimbursementJourneyPage.tsx');
  assert.match(page, /action !== 'submit' && Boolean\(blockedReason\)/);
  const guard = page.match(/submit: \(\) => \{([\s\S]*?)setApproverHelp\(null\)/)![1]!;
  for (const [receipt, dateInvalid, blocked] of [[true, false, true], [false, false, true], [true, true, true], [false, false, false]]) {
    const targets: unknown[] = [];
    const receiptField = { getClientRects: () => [1] };
    const payoutField = {}, stepCard = {};
    let marked = false;
    const result = new Function('receiptDateInvalid', 'readiness', 'receiptReadiness', 'setSubmitAttempted', 'linesBoxRef', 'payoutBoxRef', 'cardRef', 'focusExpenseField', 'requestAnimationFrame', guard.replace('<HTMLElement>', '') + '; return "sent";')(
      dateInvalid, { blocked }, { blocked: receipt }, () => { marked = true; },
      { current: { querySelectorAll: () => [{ getClientRects: () => [] }, receiptField] } },
      { current: payoutField }, { current: stepCard }, (target: unknown) => targets.push(target), (fn: () => void) => fn());
    assert.equal(result, blocked ? undefined : 'sent');
    assert.equal(marked, blocked);
    assert.deepEqual(targets, blocked ? [dateInvalid ? stepCard : receipt ? receiptField : payoutField] : []);
  }
});
it('CLAIM-DETAIL summary and line amounts use baht units, with the receipt error at its picker', () => {
  const summary = render(h(ui.ClaimSummaryCard, { detail }));
  assert.match(summary, /ยอดรวม/); assert.match(summary, /650\.00/); assert.match(summary, /บาท/);
  assert.match(summary, /<dt[^>]*>ผู้เบิก<\/dt>/); assert.match(summary, /<dt[^>]*>เหตุผล<\/dt>/);
  const lines = render(h(ui.ClaimLines, props));
  const pickers = render(h(ui.ClaimLines, { ...props, missingReceiptsOnly: true, receiptError: 'รายการที่ 1 ยังไม่มีใบเสร็จ' }));
  assert.match(lines, /ยอดเงิน \(บาท\)/);
  assert.doesNotMatch(lines, /type="file"/);
  assert.match(pickers, /data-claim-missing-receipt="true"/);
  assert.match(pickers, /role="alert"[^>]*>รายการที่ 1 ยังไม่มีใบเสร็จ/);
  assert.doesNotMatch(summary + lines, /฿|—/);
});
it('CLAIM-DETAIL signatures and copies share one card, retaining their anchors and upload', () => {
  // Nothing signed or attached yet: the step card says it all, so the record card is not drawn.
  assert.equal(render(h(ui.ClaimDocuments, { ...props, detail: { ...detail, status: 'PAID', claimFormLayout: 'TWO_SIGNERS', approvalSteps: [] } })), '');
  const html = render(h(ui.ClaimDocuments, { ...props, detail: { ...detail, status: 'PAID', claimFormLayout: 'TWO_SIGNERS', approvalSteps: [],
    signatures: [{ role: 'REQUESTER', signedByName: 'สมชาย', signedAt: '2026-10-10' }] } }));
  assert.match(html, /ลายเซ็นและใบเบิกที่เซ็นแล้ว/);
  assert.doesNotMatch(html, /<h2[^>]*>ลายเซ็นในใบเบิก|<h2[^>]*>ใบเบิกที่เซ็นแล้ว/);
  assert.equal((html.match(/class="mangmee-card /g) ?? []).length, 1);
  assert.match(html, /id="reimbursement-signatures"/); assert.match(html, /id="reimbursement-signed-copies"/);
  assert.match(html, /รอเซ็น/); assert.doesNotMatch(html, /type="file"/);
  const step = render(h(ui.ClaimDocuments, { ...props, mode: 'step', detail: { ...detail, status: 'PAID' } }));
  assert.match(step, /แนบใบที่เซ็นแล้ว/);
});
it('CLAIM-DETAIL payment facts retain evidence and put cancellation only inside MoreActions', () => {
  const payment = { id: 'pay', paymentNo: 'RBPAY-1', status: 'RECORDED', paidAmount: '95', currency: 'THB',
    paymentMethod: 'CASH', paidAt: '2026-10-10', paidByName: 'สมศรี', viewerCanOpenSlips: true, slips: [{ attachmentId: 'slip' }] };
  const html = render(h(ui.ClaimPayments, { ...props, detail: { ...detail, payments: [payment] } }));
  for (const label of ['วิธีจ่าย', 'วันที่จ่าย', 'จ่ายโดย', 'หลักฐาน']) assert.match(html, new RegExp(`<dt[^>]*>${label}</dt>`));
  assert.match(html, /95\.00 บาท/); assert.match(html, /ดูหลักฐานการจ่าย/);
  assert.match(html, /<details[^>]*>[\s\S]*เพิ่มเติม[\s\S]*mangmee-btn-danger[\s\S]*ยกเลิกรายการจ่ายนี้[\s\S]*<\/details>/);
  assert.doesNotMatch(html.replace(/<details[\s\S]*?<\/details>/g, ''), /ยกเลิกรายการจ่ายนี้/);
  assert.doesNotMatch(html, /฿|—/);
});
it('CLAIM-DETAIL receiving account is label/value facts and keeps reveal', () => {
  const html = render(h(payout.ClaimPayoutCard, { companyId: 'shop', detail: { ...detail, payout: {
    payoutMethod: 'BANK_TRANSFER', bankName: 'กสิกรไทย', accountName: 'สมใจ', accountLast4: '1234', canRevealAccountNumber: true } },
    userId: 'me', payoutAccountHref: '/accounts' }));
  assert.match(html, /<dt[^>]*>บัญชีรับเงินคืน<\/dt>/); assert.match(html, /แสดงเลขบัญชี/);
  assert.doesNotMatch(html, /฿|—/);
});
it('CLAIM-DETAIL money formatter keeps other currencies and the hub formatter also reads บาท', () => {
  assert.equal(ui.formatClaimDetailMoney('650'), '650.00 บาท');
  assert.equal(ui.formatClaimDetailMoney('12,500.00'), '12,500.00 บาท');
  assert.equal(ui.formatClaimDetailMoney('99999999999999.99'), '99,999,999,999,999.99 บาท');
  assert.equal(ui.formatClaimDetailMoney('650', ''), '650.00 บาท');
  assert.equal(ui.formatClaimDetailMoney('650', 'USD'), ui.formatClaimMoney('650', 'USD'));
  assert.equal(ui.formatClaimMoney('650'), '650.00 บาท');
  assert.equal(ui.formatClaimMoney('9007199254740993.01'), '9,007,199,254,740,993.01 บาท');
  assert.doesNotMatch(read('./ReimbursementJourneyPage.tsx'), /formatClaimMoney as formatMoney/);
});

it('CLAIM-DETAIL void action stays absent without permission or after a payment is voided', () => {
  for (const [status, permissions] of [['VOIDED', props.permissions], ['RECORDED', []]] as const) {
    const html = render(h(ui.ClaimPayments, { ...props, permissions, detail: { ...detail, payments: [{ id: 'pay', status,
      paidAmount: '95', currency: 'THB', paymentMethod: 'CASH', paidAt: '2026-10-10' }] } }));
    assert.doesNotMatch(html, /เพิ่มเติม|ยกเลิกรายการจ่ายนี้/);
  }
});
it('CLAIM-DETAIL void, stale approval, payment summary and source facts never use a currency symbol', () => {
  const originalPortal = require('react-dom').createPortal;
  Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
  Object.assign(globalThis, { document: { body: {} } });
  try {
    const voidDialog = render(h(ui.VoidPaymentDialog, { payment: { paidAmount: '95', currency: 'THB' }, onClose: noop, onConfirm: noop }));
    const staleDialog = render(h(ui.StaleApprovalDialog, { diff: [{ key: 'amount', label: 'จำนวนเงิน', before: '650.00 บาท', after: '700.00 บาท', changed: true }],
      lines: detail.lines, currency: 'THB', onClose: noop, onConfirm: noop }));
    const payment = render(h(ui.PaymentForm, { companyId: 'shop', request: detail, onDone: noop, onCancel: noop }));
    const source = { expenseDate: '2026-10-10', currency: 'THB', seller: {}, attachments: [], totals: { netPayableAmount: '650', vatAmount: '0', whtAmount: '0' } };
    const lines = render(h(ui.ClaimLines, { ...props, detail: { ...detail, lines: [{ ...detail.lines[0], sourceExpenseSnapshot: source }] } }));
    for (const html of [voidDialog, staleDialog, payment, lines]) { assert.match(html, /บาท/); assert.doesNotMatch(html, /฿|—/); }
    assert.match(staleDialog, /650\.00 บาท/); assert.match(staleDialog, /700\.00 บาท/);
  } finally { Reflect.set(require('react-dom'), 'createPortal', originalPortal); Reflect.deleteProperty(globalThis, 'document'); }
});

it('CLAIM-STEPS payment menu holds upload and void, with no picker until upload is opened', () => {
  const payment = { id: 'pay', paymentNo: 'RBPAY-1', status: 'RECORDED', paidAmount: '95', paymentMethod: 'CASH', paidAt: '2026-10-10', slips: [] };
  const html = render(h(ui.ClaimPayments, { ...props, permissions: ['reimbursement.payment.record', 'reimbursement.payment.void'], detail: { ...detail, payments: [payment] } }));
  assert.match(html, /<details[\s\S]*แนบหลักฐานการจ่ายเพิ่ม[\s\S]*ยกเลิกรายการจ่ายนี้[\s\S]*<\/details>/);
  assert.doesNotMatch(html, /type="file"/);
  const react = require('react');
  const state = react.useState;
  const portal = require('react-dom').createPortal;
  Reflect.set(react, 'useState', (initial: unknown) => { const [value, set] = state(initial); return [initial === null ? payment : value, set]; });
  Reflect.set(require('react-dom'), 'createPortal', (node: React.ReactNode) => node);
  Object.assign(globalThis, { document: { body: {} } });
  try {
    const open = render(h(ui.ClaimPayments, { ...props, detail: { ...detail, payments: [payment] } }));
    assert.match(open, /role="dialog"[\s\S]*แนบหลักฐานการจ่ายเพิ่ม RBPAY-1[\s\S]*type="file"/);
    assert.equal((open.match(/type="file"/g) ?? []).length, 1);
  } finally { Reflect.set(react, 'useState', state); Reflect.set(require('react-dom'), 'createPortal', portal); Reflect.deleteProperty(globalThis, 'document'); }
});

it('CLAIM-STEPS document actions never appear before payment, even if a caller asks for the step view', () => {
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'READY_FOR_PAYMENT', 'CANCELLED']) {
    const html = render(h(ui.ClaimDocuments, { ...props, mode: 'step', detail: { ...detail, status } }));
    assert.equal(html, '');
  }
});


it('UAT-R1 a digitally completed document keeps signed facts and print without paper signing or upload', () => {
  for (const documentSignedVia of ['DIGITAL', 'BOTH']) {
    const html = render(h(ui.ClaimDocuments, { ...props, mode: 'step', print: { onPress: noop, working: false },
      detail: { ...detail, status: 'PAID', documentSignedVia, signatures: [
        { role: 'REQUESTER', signedByName: 'สมใจ', signedAt: '2026-10-10' },
        { role: 'APPROVER', signedByName: 'สมชาย', signedAt: '2026-10-10' },
      ] } }));
    assert.match(html, /เซ็นในระบบครบแล้ว/);
    assert.match(html, /สมใจ/); assert.match(html, /สมชาย/);
    assert.match(html, /พิมพ์ใบเบิก/);
    assert.doesNotMatch(html, /เลือกวิธีใดวิธีหนึ่ง|เซ็นบนกระดาษ|แนบใบที่เซ็นแล้ว|type="file"/);
  }
  const partial = render(h(ui.ClaimDocuments, { ...props, mode: 'step', detail: { ...detail, status: 'PAID',
    signatures: [{ role: 'REQUESTER', signedByName: 'สมใจ' }] } }));
  assert.match(partial, /เลือกวิธีใดวิธีหนึ่ง/); assert.match(partial, /แนบใบที่เซ็นแล้ว/);
});
