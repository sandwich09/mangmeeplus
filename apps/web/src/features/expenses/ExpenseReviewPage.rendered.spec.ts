import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { expenseEvidenceFingerprint } from '@watchdog-bms/contracts';

(globalThis as any).React = React;
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (m) => { m.exports = () => null; };
const runtime = require('react');
function mutable(path: string) {
  const exports = { ...require(path) };
  require.cache[require.resolve(path)]!.exports = exports;
  return exports;
}
const api = mutable('./expenses.api');
const policy = mutable('./expense-capture-policy');
const modals = mutable('@/common/components/modal/Modal');
const confirmation = mutable('@/common/components/modal/use-confirm');
const { ExpenseReviewPage } = require('./ExpenseReviewPage');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const h = React.createElement;
const noop = () => {};
const stub = mock.method.bind(mock);
const OWNER = ['expense.read', 'expense.review', 'expense.confirm', 'expense.payment.record', 'expense.void'];
const allowed = { canReopen: true, reopenBlockers: [], canReject: true, rejectBlocker: null, canRecordPayment: true, recordPaymentBlocker: null, payments: [{ id: 'p1', canCancel: true, cancelBlocker: null }] };
const payment = { id: 'p1', amount: '700', paidAt: '2026-10-03', paymentMethod: 'CASH', status: 'RECORDED', postingStatus: 'pending' };
function expense(over: any = {}) {
  const d: any = { id: 'e1', companyId: 'co', branchId: 'b1', createdByUserId: 'owner', expenseNumber: 'EX-01', status: 'CONFIRMED',
    expenseDate: '2026-10-03', vendorNameSnapshot: 'ร้านทดสอบ', vendorTaxIdSnapshot: null, description: 'สินค้า', currency: 'THB',
    subtotalAmount: '500', grandTotalAmount: '500', netPayableAmount: '500', vatAmount: '0', whtAmount: '0', discountAmount: '0',
    paidAmount: '0', outstandingAmount: '500', paymentStatus: 'UNPAID', postingStatus: 'not_required',
    vatMode: 'NO_VAT', sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'NON_TAX_INVOICE', captureSource: 'MANUAL',
    duplicateStatus: 'NO_MATCH', duplicateCandidates: [], aiVerificationSummaryJson: null, aiVerifiedFieldsJson: null,
    attachments: [{ id: 'att', purpose: 'expense.receipt.primary', originalFileName: 'ใบเสร็จ.pdf', mimeType: 'application/pdf' }],
    lines: [], payments: [], correctionCapabilities: allowed, updatedAt: '2026-10-04T01:00:00Z', ...over };
  const assessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: ['att'], reason: '' };
  d.attachments[0].status = 'ACTIVE';
  d.aiVerificationSummaryJson ??= { documentReview: { version: 2, assessment, reviewedAt: d.updatedAt, reviewedByUserId: 'owner', fingerprint: expenseEvidenceFingerprint(d, assessment as any) } };
  return d;
}

// Repo's loaded-page SSR idiom. Only portal transport is replaced; actual page/dialog contents
// and handlers render. Page hook names locate state slots, so adding a state does not shift fixtures.
function harness(initial: Record<string, any> = {}) {
  const state: Record<string, any> = { detail: expense(), loading: false, step: 'review', paidAmount: '500', paidAt: '2026-10-04', ...initial };
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(m => m[1]!);
  const nodes: Array<{ tag: string; props: any }> = [];
  let html = ''; const successes: string[] = [];
  function render() {
    let index = 0; nodes.length = 0;
    const realState = runtime.useState, realCreate = runtime.createElement;
    runtime.useState = (init: any) => {
      const pair = realState(init), name = names[index++];
      if (!name) return pair;
      if (!(name in state)) state[name] = pair[0];
      return [state[name], (next: any) => { state[name] = typeof next === 'function' ? next(state[name]) : next; }];
    };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => {
      if (typeof tag === 'string' || typeof tag === 'function') nodes.push({ tag: typeof tag === 'string' ? tag : tag.name, props: { ...props, children } });
      return realCreate(tag, props, ...children);
    };
    const modal = stub(modals, 'Modal', ({ open, title, children, footer }: any) => open ? h('section', { 'data-dialog': true }, h('h2', null, title), children, footer) : null);
    const confirm = stub(confirmation, 'useConfirm', () => ({ confirm: async () => true, confirmDialog: null }));
    const capture = stub(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE', vatStatus: 'NOT_REGISTERED' }));
    try { html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push: noop, replace: noop, back: noop, prefetch: noop } as any },
      h(ToastContext.Provider, { value: { success: (message: string) => successes.push(message), error: () => { throw Error('refusal must stay by its action'); }, warning: noop } },
        h(ExpenseReviewPage, { companyId: 'co', expenseId: 'e1', userId: 'owner', permissions: OWNER, canSelfApprove: true })))); }
    finally { runtime.useState = realState; runtime.createElement = realCreate; modal.mock.restore(); capture.mock.restore(); confirm.mock.restore(); }
    return html;
  }
  async function act(tag: string, label: string, event = 'onClick') {
    const node = nodes.find(n => n.tag === tag && (text(n.props.children).includes(label) || n.props.id === label));
    assert.ok(node, `missing ${tag}: ${label}`);
    node.props[event]({ preventDefault: noop, target: { value: 'เหตุผลทดสอบ' } });
    await new Promise(resolve => setImmediate(resolve));
    return render();
  }
  return { state, render, act, successes, nodes };
}
function text(value: any): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (React.isValidElement(value)) return text((value.props as any).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function visible(html: string) { return html.replace(/<[^>]+>/g, ' '); }
function dialog(html: string) { return html.slice(html.indexOf('<section data-dialog')); }

test('A1 owner without ledger sees confirmed lock, reopen, actual certificate blockers and missing capability', () => {
  const html = harness().render();
  assert.match(html, /เอกสารยืนยันแล้ว จึงล็อกข้อมูลไว้/);
  assert.match(html, />แก้ไขเอกสาร<\/button>/);
  assert.doesNotMatch(html, /รายการจ่ายเดิมยังอยู่/);
  const blocked = harness({ detail: expense({ correctionCapabilities: { ...allowed, canReopen: false, reopenBlockers: ['certificate_issued'] } }) }).render();
  assert.match(blocked, /<li[^>]*>ออกเอกสาร 50 ทวิแล้ว/);
  assert.doesNotMatch(blocked, />แก้ไขเอกสาร<\/button>/);
  assert.match(harness({ detail: expense({ correctionCapabilities: undefined }) }).render(), /ยังตรวจสิทธิ์แก้ไขไม่ได้ กรุณาโหลดหน้าใหม่/);
});
test('A2 recorded payments remain visible at totals in every correction review step with server cancel capability', () => {
  for (const step of ['data', 'evidence', 'review']) {
    const html = harness({ step, detail: expense({ status: 'NEEDS_REVIEW', payments: [payment], paidAmount: '700', correctionOpenedAt: '2026-10-04T02:00:00Z' }) }).render();
    assert.match(html, /ประวัติการจ่าย/); assert.match(html, /ยกเลิกรายการจ่ายนี้/);
    assert.match(html, /กำลังแก้ไขเอกสารที่ยืนยันแล้ว/);
    assert.match(html, /top:calc\(var\(--app-header-h\) \+ 6\.125rem\);height:calc\(100dvh - var\(--app-header-h\) - 12\.125rem\)/);
    assert.match(html, /style="top:var\(--app-header-h\)"/);
    assert.doesNotMatch(html, /รอลงบัญชี/);
  }
});
test('A3 overpayment is immediate, names excess/remedy and blocks confirmation; legacy has its own next step', () => {
  const d = expense({ status: 'READY_FOR_CONFIRMATION', paidAmount: '700', outstandingAmount: '0', payments: [payment] });
  const html = harness({ detail: d }).render();
  assert.match(visible(html), /จ่ายเกินยอดสุทธิ ฿200.00/);
  assert.match(html, /ยกเลิกรายการจ่ายด้านล่างก่อนยืนยัน/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>ยืนยันเอกสาร<\/button>/);
  assert.doesNotMatch(html, /ต้องตรวจ 0 รายการ|>ชำระแล้ว<|>ชำระบางส่วน</);
  const legacy = harness({ detail: { ...d, payments: [] } }).render();
  assert.match(legacy, /ไม่พบรายการจ่ายให้ยกเลิก ติดต่อผู้มีสิทธิ์ยกเลิกเอกสาร/);
  assert.doesNotMatch(legacy, /ยกเลิกรายการจ่ายด้านล่าง/);
});
test('A4 stale payment refusals refresh balances/status and appear once beside the action', async () => {
  for (const code of ['expense_payment_exceeds_outstanding', 'expense_payment_changed', 'expense_payment_not_confirmed']) {
    const page = harness(); let reads = 0;
    const fresh = expense(code === 'expense_payment_not_confirmed' ? { status: 'NEEDS_REVIEW', correctionOpenedAt: '2026-10-04T02:00:00Z', correctionCapabilities: { ...allowed, canReopen: false, canRecordPayment: false } } : { paidAmount: '400', outstandingAmount: '100' });
    const record = stub(api, 'recordExpensePayment', async () => { throw { code }; });
    const get = stub(api, 'getExpense', async () => { reads++; return fresh; });
    try {
      page.render(); const html = await page.act('form', 'วิธีจ่ายเงิน', 'onSubmit');
      assert.equal(reads, 1); assert.equal(page.state.detail, fresh);
      const message = code === 'expense_payment_not_confirmed' ? 'เอกสารถูกเปิดแก้ไขแล้ว จึงบันทึกจ่ายไม่ได้ ให้ผู้มีสิทธิ์ตรวจและยืนยันเอกสารก่อน' : 'โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจยอดและประวัติการจ่ายก่อนทำรายการอีกครั้ง';
      assert.equal(html.split(message).length - 1, 1); assert.doesNotMatch(html, /•/);
      if (code !== 'expense_payment_not_confirmed') assert.match(html, /บันทึกจ่ายส่วนที่เหลือ ฿100.00/);
    } finally { record.mock.restore(); get.mock.restore(); }
  }
});
test('A5 leading zeros are accepted and the form names the normalized amount', () => {
  const html = harness({ paidAmount: '0500' }).render();
  assert.match(html, /<button[^>]*type="submit"(?![^>]*disabled="")[^>]*>บันทึกจ่ายส่วนที่เหลือ ฿500.00<\/button>/);
  assert.doesNotMatch(html, /กรุณากรอกยอดจ่ายมากกว่า 0/);
});
test('A6 form allows yesterday/today, refuses tomorrow and uses Bangkok day boundary and maximum', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T16:30:00Z').getTime() });
  for (const paidAt of ['2026-10-03', '2026-10-04']) {
    const page = harness({ paidAt }); const html = page.render();
    assert.equal(page.nodes.find(n => n.tag === 'ThemedDate' && n.props.id === 'expense-payment-paid-at')?.props.max, '2026-10-04'); assert.doesNotMatch(html, /วันที่จ่ายเงินจริงต้องไม่เกินวันนี้/);
  }
  const tomorrow = harness({ paidAt: '2026-10-05' }).render();
  assert.match(tomorrow, /วันที่จ่ายเงินจริงต้องไม่เกินวันนี้/);
  assert.match(tomorrow, /type="submit"[^>]*disabled=""/);
  t.mock.timers.setTime(new Date('2026-10-04T17:30:00Z').getTime());
  assert.doesNotMatch(harness({ paidAt: '2026-10-05' }).render(), /วันที่จ่ายเงินจริงต้องไม่เกินวันนี้/);
  assert.match(harness({ paidAt: '2026-10-06' }).render(), /วันที่จ่ายเงินจริงต้องไม่เกินวันนี้/);
});
test('B correction dialogs identify payment and transition, use specific reason/actions and full-width footers', () => {
  const cancel = dialog(harness({ detail: expense({ payments: [payment] }), correctionAction: { paymentId: 'p1' }, correctionReason: 'ยอดไม่ถูกต้อง' }).render());
  assert.match(cancel, /฿700.00/); assert.match(cancel, /เงินสด/); assert.match(cancel, /3 ต.ค. 2569/);
  assert.match(cancel, /เหตุผลที่ยกเลิก/); assert.match(cancel, /autoFocus|autofocus/);
  assert.match(cancel, /w-full sm:w-auto/); assert.match(cancel, />ยกเลิกรายการจ่ายนี้<\/button>/);
  for (const payments of [[], [payment]]) {
    const reopen = dialog(harness({ detail: expense({ payments }), correctionAction: {}, correctionReason: 'แก้ไขยอด' }).render());
    assert.match(reopen, /กลับไปตรวจสอบ.*เลขเอกสารเดิม/);
    assert.equal(reopen.includes('รายการจ่ายเดิมยังอยู่'), payments.length > 0);
    assert.match(reopen, />เปิดเอกสารกลับไปตรวจสอบ<\/button>/);
  }
});
test('B blocked cancellation names the page action and only the applicable next step, without a reason form', () => {
  for (const canCancel of [true, false]) {
    const cap = { ...allowed, canReject: false, rejectBlocker: 'recorded_payments', payments: [{ id: 'p1', canCancel, cancelBlocker: null }] };
    const html = dialog(harness({ showReject: true, detail: expense({ status: 'NEEDS_REVIEW', payments: [payment], correctionCapabilities: cap }) }).render());
    assert.match(html, /<h2>ยกเลิกรายการ<\/h2>/);
    assert.match(html, /ยังมีรายการจ่ายอยู่ จึงยกเลิกรายการไม่ได้/);
    assert.match(html, canCancel ? /ยกเลิกรายการจ่ายด้านล่างก่อน/ : /ให้ผู้มีสิทธิ์ยกเลิกรายการจ่ายก่อน/);
    assert.doesNotMatch(html, /<textarea|กรุณาระบุเหตุผล|>ยืนยัน<|ปฏิเสธ/);
  }
});
test('B reopen success says payments are retained only when recorded payments exist', async () => {
  for (const payments of [[], [payment]]) {
    const page = harness({ detail: expense({ payments }), correctionAction: {}, correctionReason: 'แก้ยอด', reason: 'แก้ยอด' });
    const reopen = stub(api, 'reopenExpense', async () => expense({ status: 'NEEDS_REVIEW' }));
    const get = stub(api, 'getExpense', async () => expense({ status: 'NEEDS_REVIEW' }));
    try { page.render(); await page.act('form', 'เหตุผลที่แก้ไข', 'onSubmit'); assert.equal(page.state.step, 'data');
      assert.equal(page.successes[0]?.includes('รายการจ่ายเดิมยังอยู่'), payments.length > 0); }
    finally { reopen.mock.restore(); get.mock.restore(); }
  }
});
test('C cancelling inside the cancellation dialog keeps it open and preserves the typed reason', async () => {
  const page = harness({ detail: expense({ status: 'NEEDS_REVIEW', payments: [payment], correctionCapabilities: { ...allowed, canReject: false, rejectBlocker: 'recorded_payments' } }), showReject: true, reason: 'เหตุผลเดิม' });
  const get = stub(api, 'getExpense', async () => expense({ status: 'NEEDS_REVIEW', payments: [{ ...payment, status: 'VOIDED', cancellationReason: 'ยอดผิด' }] }));
  const cancel = stub(api, 'cancelExpensePayment', async () => ({}));
  try {
    page.render(); await page.act('button', 'ยกเลิกรายการจ่ายนี้');
    assert.equal(page.state.showReject, true); assert.equal(page.state.reason, 'เหตุผลเดิม');
    page.state.correctionReason = 'ยอดผิด'; page.render();
    const html = await page.act('form', 'เหตุผลที่ยกเลิก', 'onSubmit');
    assert.equal(page.state.showReject, true); assert.equal(page.state.reason, 'เหตุผลเดิม');
    assert.match(dialog(html), /เหตุผลเดิม/); assert.match(dialog(html), /ยกเลิกแล้ว/);
  } finally { get.mock.restore(); cancel.mock.restore(); }
});
test('C cancelled history is grey/struck with reason and aligned amount; row owns its cancel action', () => {
  const html = harness({ detail: expense({ payments: [payment, { ...payment, id: 'p2', status: 'VOIDED', cancellationReason: 'ยอดผิด' }] }) }).render();
  assert.match(html, /line-through/); assert.match(html, /ยกเลิกแล้ว/); assert.match(html, /ยอดผิด/);
  assert.match(html, /grid-cols-\[minmax\(0,1fr\)_auto\]/); assert.match(html, /text-right/);
});
test('C review footer exposes at most two actions and uses no-wrap labels; certificate download is compact', () => {
  const html = harness({ detail: expense({ status: 'NEEDS_REVIEW' }) }).render();
  const bar = html.slice(html.indexOf('mangmee-safe-bottom'));
  assert.match(bar, /เพิ่มเติม/); assert.match(bar, /whitespace-nowrap/);
  const exposed = bar.replace(/<details[\s\S]*?<\/details>/g, '');
  assert.equal((exposed.match(/<button/g) ?? []).length, 1, 'one primary action, plus the secondary menu');
  const issued = harness({ detail: expense({ whtAmount: '15' }), whtHandoff: { id: 'h1', status: 'SYSTEM_ISSUED' } }).render();
  assert.match(issued, /ดาวน์โหลดเอกสารอีกครั้ง/);
  assert.doesNotMatch(issued.slice(issued.indexOf('mangmee-safe-bottom')), /bg-green-50 p-3/);
});

test('B shops without accounting see no ledger wording on locked payment rows', () => {
  const html = harness({ detail: expense({ payments: [payment], correctionCapabilities: { ...allowed, payments: [{ id: 'p1', canCancel: false, cancelBlocker: 'ledger_posted' }] } }) }).render();
  assert.doesNotMatch(html, /ลงบัญชี|รอผ่านรายการ|สถานะบัญชี/);
  assert.match(html, /รายการนี้ถูกล็อกไว้/);
});

test('B guide renders the actual correction/payment buttons and their limits', () => {
  const { buildExpensesGuide } = require('../user-guide/expenses-guide.content');
  const { UserGuidePage } = require('../user-guide/UserGuidePage');
  const guide = buildExpensesGuide('co', OWNER);
  const real = runtime.useState;
  runtime.useState = (init: any) => { const pair = real(init); return [Array.isArray(init) ? guide.sections.map((s: any) => s.id) : pair[0], pair[1]]; };
  try {
    const html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push: noop, replace: noop, prefetch: noop } as any }, h(UserGuidePage, { guide })));
    assert.doesNotMatch(html, /ส่งกลับแก้ไข|ตรวจเงื่อนไขการยกเลิก/);
    for (const word of ['แก้ไขเอกสาร', 'ยกเลิกรายการจ่ายนี้', 'เลขเอกสารเดิม', 'เหตุผลที่ยกเลิก', 'วันที่จ่ายเงินจริงต้องไม่เกินวันนี้', 'เพิ่มเติม']) assert.ok(html.includes(word), word);
  } finally { runtime.useState = real; }
});

test('B real expense transport leaves a refused payment once beside the form, with no automatic toast', async () => {
  const { subscribeToastBus } = require('@/common/feedback/toast-bus');
  const events: unknown[] = []; const unsubscribe = subscribeToastBus((event: unknown) => events.push(event));
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  (globalThis as any).window = {};
  globalThis.fetch = (async (_url: unknown, init: any) => new Response(JSON.stringify(init?.method === 'POST' ? { code: 'expense_payment_exceeds_outstanding' } : expense({ outstandingAmount: '100', paidAmount: '400' })), { status: init?.method === 'POST' ? 400 : 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const page = harness(); page.render(); const html = await page.act('form', 'วิธีจ่ายเงิน', 'onSubmit');
    assert.equal(events.length, 0);
    assert.equal(html.split('โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจยอดและประวัติการจ่ายก่อนทำรายการอีกครั้ง').length - 1, 1);
  } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete (globalThis as any).window; else globalThis.window = originalWindow; unsubscribe(); }
});

test('A4 stale reopen and cancelled-payment writes refresh once and keep only their local refusal', async () => {
  for (const cancelling of [false, true]) {
    const page = harness({ detail: expense({ payments: [payment] }), correctionAction: cancelling ? { paymentId: 'p1' } : {}, correctionReason: 'แก้ไขยอด' });
    let reads = 0;
    const write = stub(api, cancelling ? 'cancelExpensePayment' : 'reopenExpense', async () => { throw cancelling ? { code: 'expense_payment_correction_blocked' } : new Error('expense_correction_source_changed'); });
    const get = stub(api, 'getExpense', async () => { reads++; return expense(cancelling ? { payments: [{ ...payment, status: 'VOIDED' }], correctionCapabilities: { ...allowed, payments: [{ id: 'p1', canCancel: false, cancelBlocker: 'payment_voided' }] } } : { status: 'NEEDS_REVIEW', correctionOpenedAt: '2026-10-04T02:00:00Z', correctionCapabilities: { ...allowed, canReopen: false } }); });
    try {
      page.render(); const html = await page.act('form', cancelling ? 'เหตุผลที่ยกเลิก' : 'เหตุผลที่แก้ไข', 'onSubmit');
      assert.equal(reads, 1);
      const message = cancelling ? 'รายการจ่ายนี้ถูกยกเลิกแล้ว โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจประวัติการจ่าย' : 'เอกสารเปิดแก้ไขอยู่แล้ว กรุณาตรวจข้อมูลล่าสุด';
      assert.equal(html.split(message).length - 1, 1); assert.doesNotMatch(html, /•/);
      assert.doesNotMatch(dialog(html), /<textarea|type="submit"/);
    } finally { write.mock.restore(); get.mock.restore(); }
  }
});

test('A3 overpayment in the expense list renders its fact instead of a paid badge', () => {
  const { ExpensesHubPage } = require('./ExpensesPages');
  const { SearchParamsContext } = require('next/dist/shared/lib/hooks-client-context.shared-runtime');
  const real = runtime.useState;
  runtime.useState = (init: any) => {
    const pair = real(init);
    return [Array.isArray(init) && !init.length ? [expense({ paymentStatus: 'PAID', paidAmount: '700', outstandingAmount: '0' })] : init === true ? false : pair[0], pair[1]];
  };
  try {
    const html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push: noop, replace: noop, prefetch: noop } as any }, h(SearchParamsContext.Provider, { value: new URLSearchParams() }, h(ToastContext.Provider, { value: { success: noop, error: noop, warning: noop } }, h(ExpensesHubPage, { companyId: 'co', userId: 'owner', permissions: OWNER, canSelfApprove: true })))));
    assert.match(html, /จ่ายเกินยอดสุทธิ/); assert.doesNotMatch(html, />ชำระแล้ว</);
  } finally { runtime.useState = real; }
});

test('C reopening scrolls the first-step anchor with the marker below the responsive app header', () => {
  const openedAt = '2026-10-04T02:00:00Z';
  const page = harness({ detail: expense({ status: 'NEEDS_REVIEW', correctionOpenedAt: openedAt }) });
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(m => m[1]);
  const realRef = runtime.useRef; let index = 0, scrolled = 0; const frames: Array<() => void> = [];
  const originalWindow = globalThis.window;
  (globalThis as any).window = { requestAnimationFrame: (fn: () => void) => { frames.push(fn); return 1; }, cancelAnimationFrame: noop };
  const ref = mock.method(runtime, 'useRef', (init: any) => { const value = realRef(init); return names[index++] === 'reviewStartRef' ? { current: { scrollIntoView: () => { scrolled++; } } } : value; });
  const effect = mock.method(runtime, 'useEffect', (fn: () => unknown, deps?: unknown[]) => { if (deps?.length === 1 && deps[0] === openedAt) fn(); });
  try { page.render(); frames.forEach(fn => fn()); assert.equal(page.state.step, 'data'); assert.equal(scrolled, 1); }
  finally { ref.mock.restore(); effect.mock.restore(); if (originalWindow === undefined) delete (globalThis as any).window; else globalThis.window = originalWindow; }
});

test('B legacy paid document cancellation names its unavailable payment history and does not invite a reason', () => {
  const html = dialog(harness({ showReject: true, detail: expense({ status: 'NEEDS_REVIEW', paidAmount: '100', outstandingAmount: '400', payments: [], correctionCapabilities: { ...allowed, canReject: false, rejectBlocker: 'legacy_paid_balance' } }) }).render());
  assert.match(html, /มียอดจ่ายเดิมที่ไม่มีรายการให้ยกเลิก จึงยกเลิกรายการไม่ได้ ติดต่อผู้มีสิทธิ์ยกเลิกเอกสาร/);
  assert.doesNotMatch(html, /<textarea|ยกเลิกรายการจ่ายด้านล่าง|>ยืนยัน<|ปฏิเสธ/);
});

test('A4 a failed stale read explains it once and prevents another write against old totals', async () => {
  const page = harness();
  const record = stub(api, 'recordExpensePayment', async () => { throw { code: 'expense_payment_changed' }; });
  const get = stub(api, 'getExpense', async () => { throw Error('read unavailable'); });
  try {
    page.render(); const html = await page.act('form', 'วิธีจ่ายเงิน', 'onSubmit');
    assert.equal(html.split('โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาโหลดหน้าใหม่ก่อนทำรายการอีกครั้ง').length - 1, 1);
    assert.match(html, /type="submit"[^>]*disabled=""/);
  } finally { record.mock.restore(); get.mock.restore(); }
});

function focusNotice(page: ReturnType<typeof harness>, refName: string, message: string) {
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(m => m[1]);
  const realRef = runtime.useRef, previousWindow = globalThis.window;
  let index = 0, focused = 0, scrolled = 0; const frames: Array<() => void> = [];
  (globalThis as any).window = { requestAnimationFrame: (fn: () => void) => { frames.push(fn); return 1; }, cancelAnimationFrame: noop };
  const ref = mock.method(runtime, 'useRef', (init: any) => {
    const value = realRef(init);
    return names[index++] === refName ? { current: { focus: () => { focused++; }, scrollIntoView: () => { scrolled++; } } } : value;
  });
  const effect = mock.method(runtime, 'useEffect', (fn: () => unknown, deps?: unknown[]) => { if (deps?.includes(message)) fn(); });
  try { page.render(); frames.forEach(fn => fn()); return { focused, scrolled }; }
  finally { ref.mock.restore(); effect.mock.restore(); if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow; }
}

test('recheck 1: a payment refusal after external reopen is scrolled into view and focused once', async () => {
  const page = harness();
  const record = stub(api, 'recordExpensePayment', async () => { throw { code: 'expense_payment_not_confirmed' }; });
  const get = stub(api, 'getExpense', async () => expense({ status: 'NEEDS_REVIEW', correctionOpenedAt: '2026-10-04T02:00:00Z' }));
  try {
    page.render(); const html = await page.act('form', 'วิธีจ่ายเงิน', 'onSubmit');
    const message = page.state.paymentNotice;
    assert.match(message, /เอกสารถูกเปิดแก้ไขแล้ว/);
    assert.equal(html.split(message).length - 1, 1);
    assert.deepEqual(focusNotice(page, 'paymentNoticeRef', message), { focused: 1, scrolled: 1 });
    assert.match(html, /tabindex="-1"[^>]*scroll-mt-\[calc\(var\(--app-header-h\)\+1rem\)\]/);
  } finally { record.mock.restore(); get.mock.restore(); }
});

test('recheck 3: editing prices shows an adjacent excess cue and sending for review warns without blocking', async () => {
  const detail = expense({ status: 'NEEDS_REVIEW', paidAmount: '700', payments: [payment], outstandingAmount: '0',
    lines: [{ id: 'l1', description: 'สินค้า', quantity: '1', unitPrice: '500', discountAmount: '0', vatRate: '0', whtRate: '0', lineSubtotalAmount: '500', lineTaxAmount: '0', lineTotalAmount: '500' }] });
  const edit = harness({ step: 'data', detail }).render();
  assert.match(edit, /value="500"[^>]*\/><p[^>]*data-testid="expense-overpayment-cue"[^>]*>จ่ายเกินยอดสุทธิ ฿200.00<\/p>/);
  const page = harness({ step: 'review', detail }); let sent = 0;
  const mark = stub(api, 'markExpenseReadyAsReviewer', async () => { sent++; return detail; });
  try {
    const html = page.render();
    assert.match(html, /id="expense-review-overpayment"[^>]*>จ่ายเกินยอดสุทธิ ฿200.00 ยกเลิกรายการจ่ายด้านล่างก่อนยืนยัน/);
    assert.equal(page.nodes.find(n => n.tag === 'button' && text(n.props.children) === 'ส่งตรวจสอบ')?.props.disabled, false);
    await page.act('button', 'ส่งตรวจสอบ'); assert.equal(sent, 1);
  } finally { mark.mock.restore(); }
});

test('recheck 4: stale reopen names the already open document and focuses a usable close control', async () => {
  const page = harness({ correctionAction: {}, correctionReason: 'แก้ยอด' });
  const reopen = stub(api, 'reopenExpense', async () => { throw { code: 'expense_correction_blocked' }; });
  const get = stub(api, 'getExpense', async () => expense({ status: 'NEEDS_REVIEW', correctionOpenedAt: '2026-10-04T02:00:00Z', correctionCapabilities: { ...allowed, canReopen: false } }));
  try {
    page.render(); const html = await page.act('form', 'expense-correction-form', 'onSubmit');
    const message = 'เอกสารเปิดแก้ไขอยู่แล้ว กรุณาตรวจข้อมูลล่าสุด';
    assert.equal(page.state.correctionError, message); assert.match(dialog(html), /เอกสารเปิดแก้ไขอยู่แล้ว/);
    assert.deepEqual(focusNotice(page, 'correctionCloseRef', message), { focused: 1, scrolled: 0 });
    const modal = page.nodes.find(n => n.props.open === true && n.props.title === 'แก้ไขเอกสาร');
    assert.ok(modal); modal.props.onClose(); assert.equal(page.state.correctionAction, null);
  } finally { reopen.mock.restore(); get.mock.restore(); }
});

test('recheck 5: an already cancelled payment refreshes and reports the fact without a success toast', async () => {
  const page = harness({ correctionAction: { paymentId: 'p1' }, correctionReason: 'เหตุผลคนที่สอง', detail: expense({ payments: [payment] }) });
  const cancel = stub(api, 'cancelExpensePayment', async () => { throw { code: 'expense_payment_already_cancelled' }; });
  let reads = 0;
  const get = stub(api, 'getExpense', async () => { reads++; return expense({ payments: [{ ...payment, status: 'VOIDED', cancellationReason: 'เหตุผลเดิม' }], correctionCapabilities: { ...allowed, payments: [{ id: 'p1', canCancel: false }] } }); });
  try {
    page.render(); const html = await page.act('form', 'expense-correction-form', 'onSubmit');
    assert.equal(reads, 1); assert.match(dialog(html), /รายการจ่ายนี้ถูกยกเลิกแล้ว/);
    assert.deepEqual(page.successes, []); assert.equal(page.state.correctionReason, 'เหตุผลคนที่สอง');
    assert.equal(page.state.detail.payments[0].cancellationReason, 'เหตุผลเดิม');
  } finally { cancel.mock.restore(); get.mock.restore(); }
});

test('recheck 7: blurring the amount normalizes its displayed leading zeros and remainder label', async () => {
  const page = harness({ paidAmount: '0500' });
  page.render(); const html = await page.act('input', 'expense-payment-amount', 'onBlur');
  assert.equal(page.state.paidAmount, '500');
  assert.match(html, /id="expense-payment-amount"[^>]*value="500"/);
  assert.match(html, /บันทึกจ่ายส่วนที่เหลือ ฿500.00/);
});
