import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { expenseEvidenceFingerprint, EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';

(globalThis as any).React = React;
const svg = require.extensions['.svg'];
const css = require.extensions['.css'];
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
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
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
const h = React.createElement;
const noop = () => {};

test('DELETE-HISTORY detail retains a voided payment and offers cancellation instead of deletion', () => {
  const page = harness({ detail: expense({ status: 'DRAFT', hasDeletionBlockingHistory: true,
    payments: [{ ...payment, status: 'VOIDED' }] }) }, [...OWNER, 'expense.delete', 'expense.reject']);
  const html = page.render();
  assert.doesNotMatch(html, />ลบรายจ่าย</);
  assert.match(html, />ยกเลิกรายการ</);
});

test('LINE-ACT offers cancellation instead of deletion for a draft retained by a superseded certificate', () => {
  const page = harness({ detail: expense({ status: 'DRAFT', hasRetainedSubstituteReceiptEvidence: true }) }, [...OWNER, 'expense.delete', 'expense.reject']);
  const html = page.render();
  assert.doesNotMatch(html, />ลบรายจ่าย</);
  assert.match(html, />ยกเลิกรายการ</);
});
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
function harness(initial: Record<string, any> = {}, permissions = OWNER, disbursementEntryOpen = false, back: string | null = null, section?: string) {
  const state: Record<string, any> = { detail: expense(), loading: false, step: 'review', paidAmount: '500', paidAt: '2026-10-04', ...initial };
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(m => m[1]!);
  const nodes: Array<{ tag: string; props: any }> = [];
  const landingEffects: Array<() => void> = [];
  const replacements: Array<{ route: string; options: unknown }> = [];
  let html = ''; const successes: string[] = []; const routes: string[] = [];
  function render() {
    let index = 0; nodes.length = 0; landingEffects.length = 0;
    const realState = runtime.useState, realCreate = runtime.createElement, realEffect = runtime.useEffect;
    const focusEffects: Array<() => void> = [];
    runtime.useEffect = (fn: () => void, deps: unknown[]) => {
      realEffect(fn, deps);
      if (String(fn).includes('reviewFocus')) focusEffects.push(fn);
      if (String(fn).includes('sectionLanding')) landingEffects.push(fn);
    };
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
    const confirm = stub(confirmation, 'useConfirm', () => ({ confirm: async () => initial.leaveAnswer !== false, confirmDialog: null }));
    const capture = stub(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE', vatStatus: 'NOT_REGISTERED' }));
    try { html = renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push: (route: string) => routes.push(route), replace: (route: string, options: unknown) => { routes.push(route); replacements.push({ route, options }); }, back: noop, prefetch: noop } as any },
      h(SearchParamsContext.Provider, { value: new URLSearchParams({ ...(back ? { back } : {}), ...(section ? { section } : {}) }) },
      h(ToastContext.Provider, { value: { success: (message: string) => successes.push(message), error: () => { throw Error('refusal must stay by its action'); }, warning: noop } },
        h(ExpenseReviewPage, { companyId: 'co', expenseId: 'e1', userId: 'owner', permissions, canSelfApprove: true, disbursementEntryOpen, freeExpenseDrafts: initial.freeExpenseDrafts === true }))))); }
    finally { runtime.useEffect = realEffect; runtime.useState = realState; runtime.createElement = realCreate; modal.mock.restore(); capture.mock.restore(); confirm.mock.restore(); }
    focusEffects.forEach(fn => fn());
    return html;
  }
  async function act(tag: string, label: string, event = 'onClick') {
    const node = nodes.find(n => n.tag === tag && (text(n.props.children).includes(label) || n.props.id === label));
    assert.ok(node, `missing ${tag}: ${label}`);
    node.props[event]({ preventDefault: noop, target: { value: 'เหตุผลทดสอบ' } });
    await new Promise(resolve => setImmediate(resolve));
    return render();
  }
  return { state, render, act, successes, nodes, routes, landingEffects, replacements };
}
function text(value: any): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (React.isValidElement(value)) return text((value.props as any).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function visible(html: string) { return html.replace(/<[^>]+>/g, ' '); }
function dialog(html: string) { return html.slice(html.indexOf('<section data-dialog')); }

test('confirming a claim receipt duplicate warns before confirmation about payment, cancellation and irreversibility only for claim sources', () => {
  for (const sourceReimbursementRequestId of ['claim-1', null]) {
    for (const action of ['confirm', 'dismiss']) {
      const page = harness({ detail: expense({ status: 'READY_FOR_CONFIRMATION', sourceReimbursementRequestId, duplicateStatus: 'POSSIBLE_DUPLICATE' }),
        duplicateResolution: { candidateId: 'd1', action }, reason: 'ตรวจแล้วซ้ำจริง' }, [...OWNER, 'expense.duplicate.resolve']);
      const text = visible(page.render());
      if (sourceReimbursementRequestId && action === 'confirm') {
        assert.match(text, /หากยืนยันว่าซ้ำ ใบเบิกนี้จะบันทึกจ่ายไม่ได้/);
        assert.match(text, /ต้องยกเลิกใบเบิกนี้/);
        assert.match(text, /ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ/);
        assert.match(text, /การยืนยันว่าซ้ำแล้วไม่สามารถย้อนกลับได้/);
      } else assert.doesNotMatch(text, /หากยืนยันว่าซ้ำ ใบเบิกนี้/);
    }
  }
});

test('A1 owner without ledger sees confirmed lock, reopen, actual certificate blockers and missing capability', () => {
  const html = harness().render();
  assert.match(html, /ค้างจ่าย[\s\S]*500.00 บาท/); assert.doesNotMatch(html, /ต้องจ่าย ฿/);
  assert.match(html, />แก้ไขเอกสาร<\/button>/);
  assert.doesNotMatch(html, /รายการจ่ายเดิมยังอยู่/);
  const blocked = harness({ detail: expense({ correctionCapabilities: { ...allowed, canReopen: false, reopenBlockers: ['certificate_issued'] } }) }).render();
  assert.match(blocked, /<li[^>]*>ออกเอกสาร 50 ทวิแล้ว/);
  assert.doesNotMatch(blocked, />แก้ไขเอกสาร<\/button>/);
  assert.match(harness({ detail: expense({ correctionCapabilities: undefined }) }).render(), /ยังตรวจสิทธิ์แก้ไขไม่ได้ เปิดหน้านี้ใหม่/);
});
test('R5 the expense check summary warns on a full tax number with a failed check digit', () => {
  const html = visible(harness({ detail: expense({ sourceDocumentType: 'TAX_INVOICE', vendorTaxIdSnapshot: '1234567890123' }) }).render());
  assert.match(html, /⚠\s+เลขผู้เสียภาษีผู้ขายครบ 13 หลัก แต่ดูไม่ถูกต้อง/);
  assert.match(html, /สรุปการตรวจ/);
  assert.doesNotMatch(html, /ผ่าน [0-9]+ รายการ|ต้องตรวจ [0-9]+ รายการ/);
  assert.doesNotMatch(html, /✓\s+เลขผู้เสียภาษีผู้ขายครบ 13 หลัก/);
});
test('A2 recorded payments remain visible at totals in every correction review step with server cancel capability', () => {
  for (const step of ['data', 'evidence', 'review']) {
    const html = harness({ step, detail: expense({ status: 'NEEDS_REVIEW', payments: [payment], paidAmount: '700', correctionOpenedAt: '2026-10-04T02:00:00Z' }) }).render();
    assert.match(html, /ประวัติการจ่าย/); assert.match(html, /ยกเลิกรายการจ่ายนี้/);
    assert.match(html, /กำลังแก้ไขเอกสารที่ยืนยันแล้ว/);
    assert.match(html, /top:calc\(var\(--app-header-h\) \+ 6\.125rem\);max-height:calc\(100dvh - var\(--app-header-h\) - 12\.125rem\)/);
    assert.match(html, /style="top:var\(--app-header-h\)"/);
    assert.doesNotMatch(html, /รอลงบัญชี/);
  }
});
test('A3 overpayment is immediate, names excess/remedy and blocks confirmation; legacy has its own next step', () => {
  const d = expense({ status: 'READY_FOR_CONFIRMATION', paidAmount: '700', outstandingAmount: '0', payments: [payment] });
  const html = harness({ detail: d }).render();
  assert.match(visible(html), /จ่ายเกินยอดสุทธิ 200.00 บาท/);
  assert.match(html, /ยกเลิกรายการจ่ายที่เกินก่อนยืนยัน/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>ยืนยันเอกสาร<\/button>/);
  assert.doesNotMatch(html, /ต้องตรวจ 0 รายการ|>จ่ายแล้ว<|>จ่ายบางส่วน</);
  // The amount to pay after the edit (500), what was paid (700) and the excess (200) explain each other.
  assert.match(html, /data-testid="expense-review-totals"[\s\S]*>ยอดรวม<\/span>[\s\S]*>500.00<span class="ml-1 text-sm font-normal text-gray-500">บาท<\/span><\/span>/, 'the review total stays 500, not the zero outstanding');
  assert.match(visible(html), /จ่ายแล้ว\s*700.00 บาท/);
  const legacy = harness({ detail: { ...d, payments: [] } }).render();
  assert.match(legacy, /ไม่พบรายการจ่ายให้ยกเลิก ติดต่อผู้มีสิทธิ์ยกเลิกเอกสาร/);
  assert.doesNotMatch(legacy, /ยกเลิกรายการจ่ายด้านล่าง/);
});
test('A4 stale payment refusals refresh balances/status and appear once beside the action', async () => {
  for (const code of ['expense_payment_exceeds_outstanding', 'expense_payment_changed', 'expense_payment_not_confirmed']) {
    const page = harness(); let reads = 0;
    const fresh = expense(code === 'expense_payment_not_confirmed' ? { status: 'NEEDS_REVIEW', correctionOpenedAt: '2026-10-04T02:00:00Z', correctionCapabilities: { ...allowed, canReopen: false, canRecordPayment: false } } : { paidAmount: '400', outstandingAmount: '100', payments: [{ ...payment, amount: '400' }] });
    const record = stub(api, 'recordExpensePayment', async () => { throw { code }; });
    const get = stub(api, 'getExpense', async () => { reads++; return fresh; });
    try {
      page.render(); const html = await page.act('form', 'วิธีจ่ายเงิน', 'onSubmit');
      assert.equal(reads, 1); assert.equal(page.state.detail, fresh);
      const message = code === 'expense_payment_not_confirmed' ? 'เอกสารถูกเปิดแก้ไขแล้ว จึงบันทึกจ่ายไม่ได้ ให้ผู้มีสิทธิ์ตรวจและยืนยันเอกสารก่อน' : 'โหลดข้อมูลล่าสุดแล้ว ตรวจยอดและประวัติการจ่ายก่อนทำรายการอีกครั้ง';
      assert.equal(html.split(message).length - 1, 1); assert.doesNotMatch(html, /•/);
      if (code !== 'expense_payment_not_confirmed') assert.match(html, /บันทึกจ่ายส่วนที่เหลือ 100.00 บาท/);
    } finally { record.mock.restore(); get.mock.restore(); }
  }
});
test('A5 leading zeros are accepted and the form names the normalized amount', () => {
  const html = harness({ paidAmount: '0500' }).render();
  assert.match(html, /<button[^>]*type="submit"(?![^>]*disabled="")[^>]*>บันทึกจ่าย 500.00 บาท<\/button>/);
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
  assert.match(tomorrow, /type="submit"(?![^>]*disabled="")[^>]*form="expense-record-payment"/);
  t.mock.timers.setTime(new Date('2026-10-04T17:30:00Z').getTime());
  assert.doesNotMatch(harness({ paidAt: '2026-10-05' }).render(), /วันที่จ่ายเงินจริงต้องไม่เกินวันนี้/);
  assert.match(harness({ paidAt: '2026-10-06' }).render(), /วันที่จ่ายเงินจริงต้องไม่เกินวันนี้/);
});
test('B correction dialogs identify payment and transition, use specific reason/actions and full-width footers', () => {
  const cancel = dialog(harness({ detail: expense({ payments: [payment] }), correctionAction: { paymentId: 'p1' }, correctionReason: 'ยอดไม่ถูกต้อง' }).render());
  assert.match(cancel, /700.00 บาท/); assert.match(cancel, /เงินสด/); assert.match(cancel, /3 ต.ค. 2569/);
  assert.match(cancel, /เหตุผลที่ยกเลิก/); assert.doesNotMatch(cancel, /autoFocus|autofocus/); assert.match(cancel, /data-expense-dialog-heading="true" role="heading" aria-level="2" tabindex="-1"/);
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
    assert.match(html, /<h2><span[^>]*>ยกเลิกรายการ<\/span><\/h2>/);
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
    assert.deepEqual(page.state.afterCorrectionFocus, { paymentId: 'p1' });
  } finally { get.mock.restore(); cancel.mock.restore(); }
});
test('C cancelled history is grey/struck with reason and aligned amount; row owns its cancel action', () => {
  const html = harness({ detail: expense({ payments: [payment, { ...payment, id: 'p2', status: 'VOIDED', cancellationReason: 'ยอดผิด' }] }) }).render();
  assert.match(html, /line-through/); assert.match(html, /ยกเลิกแล้ว/); assert.match(html, /ยอดผิด/);
  assert.match(html, /grid-cols-\[minmax\(0,1fr\)_auto\]/); assert.match(html, /text-right/);
});
test('C review footer keeps only ordered responsive actions; other actions and certificate download stay reachable', () => {
  const html = harness({ detail: expense({ status: 'NEEDS_REVIEW' }) }).render();
  const bar = html.slice(html.indexOf('mangmee-safe-bottom'));
  assert.doesNotMatch(bar, /เพิ่มเติม/); assert.doesNotMatch(bar, /grid-auto-flow:column/);
  assert.doesNotMatch(bar, /ตรวจหารายการซ้ำ/); assert.match(html, /ตรวจหารายการซ้ำ/);
  assert.match(bar, /mangmee-actions[^>]*><button[^>]*>กลับ<\/button>/);
  const exposed = bar.replace(/<details[\s\S]*?<\/details>/g, '');
  assert.equal((exposed.match(/<button/g) ?? []).length, 3, 'back, send and confirm stay in the bar; duplicate checking is in More');
  const issued = harness({ detail: expense({ whtAmount: '15' }), whtHandoff: { id: 'h1', status: 'SYSTEM_ISSUED' } }).render();
  assert.match(issued, /ดาวน์โหลดเอกสารอีกครั้ง/);
  assert.doesNotMatch(issued.slice(issued.indexOf('mangmee-safe-bottom')), /bg-green-50 p-3/);
});

test('B shops without accounting see no ledger wording on locked payment rows', () => {
  const html = harness({ detail: expense({ payments: [payment], correctionCapabilities: { ...allowed, payments: [{ id: 'p1', canCancel: false, cancelBlocker: 'ledger_posted' }] } }) }).render();
  assert.doesNotMatch(html, /ลงบัญชี|รอผ่านรายการ|สถานะบัญชี/);
  assert.match(html, /ยกเลิกรายการจ่ายไม่ได้ ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ/);
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
    assert.equal(html.split('โหลดข้อมูลล่าสุดแล้ว ตรวจยอดและประวัติการจ่ายก่อนทำรายการอีกครั้ง').length - 1, 1);
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
      const message = cancelling ? 'รายการจ่ายนี้ถูกยกเลิกไปแล้ว ดูได้ในประวัติการจ่าย' : 'เอกสารเปิดแก้ไขอยู่แล้ว ตรวจข้อมูลล่าสุด';
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
    assert.match(html, /จ่ายเกินยอดสุทธิ/); assert.doesNotMatch(html, />จ่ายแล้ว</);
  } finally { runtime.useState = real; }
});

test('DETAIL-1 reloading an old correction does not scroll or reset the selected step', () => {
  const openedAt = '2026-10-04T02:00:00Z';
  const page = harness({ detail: expense({ status: 'NEEDS_REVIEW', correctionOpenedAt: openedAt }) });
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(m => m[1]);
  const realRef = runtime.useRef; let index = 0, scrolled = 0; const frames: Array<() => void> = [];
  const originalWindow = globalThis.window;
  (globalThis as any).window = { innerHeight: 800, scrollBy: () => scrolled++, matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn: () => void) => { frames.push(fn); return 1; }, cancelAnimationFrame: noop };
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [] };
  const ref = mock.method(runtime, 'useRef', (init: any) => { const value = realRef(init); return names[index++] === 'reviewStartRef' ? { current: { scrollIntoView: () => { scrolled++; } } } : value; });
  const effect = mock.method(runtime, 'useEffect', (fn: () => unknown, deps?: unknown[]) => { if (deps?.length === 1 && deps[0] === openedAt || String(fn).includes('afterCorrectionFocus')) fn(); });
  try { page.render(); frames.forEach(fn => fn()); assert.equal(page.state.step, 'review'); assert.equal(scrolled, 0); assert.match(page.render(), /กำลังแก้ไขเอกสารที่ยืนยันแล้ว/); }
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
    assert.equal(html.split('โหลดข้อมูลล่าสุดไม่สำเร็จ เปิดหน้านี้ใหม่ก่อนทำรายการอีกครั้ง').length - 1, 1);
    assert.match(html, /type="submit"(?![^>]*disabled="")[^>]*form="expense-record-payment"/);
  } finally { record.mock.restore(); get.mock.restore(); }
});

function focusDomField(onFocus = noop): any {
  return { closest: () => null, matches: () => true, getBoundingClientRect: () => ({ top: 900, bottom: 940, height: 40 }), focus: onFocus };
}
function focusNotice(page: ReturnType<typeof harness>, refName: string, message: string, mobile = false) {
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(m => m[1]);
  const realRef = runtime.useRef, previousWindow = globalThis.window, previousDocument = globalThis.document;
  let index = 0, focused = 0, scrolled = 0; const frames: Array<() => void> = [];
  (globalThis as any).window = { innerHeight: 800, scrollBy: () => scrolled++, matchMedia: () => ({ matches: mobile }), requestAnimationFrame: (fn: () => void) => { frames.push(fn); return 1; }, cancelAnimationFrame: noop };
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [] };
  const ref = mock.method(runtime, 'useRef', (init: any) => {
    const value = realRef(init);
    return names[index++] === refName ? { current: focusDomField(() => focused++) } : value;
  });
  const effect = mock.method(runtime, 'useEffect', (fn: () => unknown, deps?: unknown[]) => { if (deps?.includes(message) || refName === 'correctionCloseRef' && deps?.[0] === page.state.correctionAction && deps?.[1] === false) fn(); });
  try { page.render(); frames.forEach(fn => fn()); return { focused, scrolled }; }
  finally { globalThis.document = previousDocument; ref.mock.restore(); effect.mock.restore(); if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow; }
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
    assert.match(html, /tabindex="-1" class="w-full scroll-mt-\[calc\(var\(--app-header-h\)\+1rem\)\]"[^>]*><div[^>]*role="alert"[^>]*rounded-xl border[^>]*bg-error-50[^>]*text-error-700[^>]*>⚠ /);
    assert.ok(html.indexOf(message) < html.indexOf('style="top:var(--app-header-h)"'));
    assert.match(html, /class="sticky z-10[^>]*style="top:var\(--app-header-h\)"/);
  } finally { record.mock.restore(); get.mock.restore(); }
});

test('round 7: unconfirmed and refreshed stale-pay notices use one boxed alert even for a read-only viewer', () => {
  for (const message of [EXPENSE_CORRECTION_WORDS.paymentOnUnconfirmed, EXPENSE_CORRECTION_WORDS.sourceRefreshed]) {
    const page = harness({ paymentNotice: message, detail: expense({ status: 'NEEDS_REVIEW' }) }, ['expense.read']);
    const html = page.render();
    assert.equal(visible(html).split(message).length - 1, 1);
    assert.match(html, /role="alert"[^>]*bg-error-50[^>]*>⚠ /);
    assert.deepEqual(focusNotice(page, 'paymentNoticeRef', message), { focused: 1, scrolled: 1 });
  }
});

test('round 7: exactly one full excess remedy follows the visible review/confirm action or stays in payment history', () => {
  const full = 'จ่ายเกินยอดสุทธิ 200.00 บาท ยกเลิกรายการจ่ายที่เกินก่อนยืนยัน';
  // Beside ส่งให้ตรวจ nothing is blocked yet, so that one screen says what is true there instead.
  const sendable = 'จ่ายเกินยอดสุทธิ 200.00 บาท ส่งให้ตรวจได้ แต่ยืนยันเอกสารไม่ได้จนกว่าจะยกเลิกรายการจ่ายที่เกิน';
  for (const status of ['NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']) {
    for (const step of ['data', 'evidence', 'review']) {
      const html = harness({ step, detail: expense({ status, paidAmount: '700', outstandingAmount: '0', payments: [payment] }) }).render();
      const besideSend = status === 'NEEDS_REVIEW' && step === 'review';
      assert.equal(visible(html).split(full).length - 1, besideSend ? 0 : 1, `${status}/${step}`);
      assert.equal(visible(html).split(sendable).length - 1, besideSend ? 1 : 0, `${status}/${step}`);
      assert.doesNotMatch(html, /ด้านล่างก่อนยืนยัน/, 'the payment card sits above the sentence on the last step');
      const card = html.match(/data-testid="expense-payment-overpayment"[^>]*>([\s\S]*?)<\/p>/)?.[1];
      assert.ok(card);
      assert.match(card, /จ่ายเกินยอดสุทธิ 200.00 บาท/);
      assert.doesNotMatch(card, /<span/);
      assert.equal(card.includes(full), step !== 'review');
      assert.equal(html.includes('id="expense-review-overpayment"'), step === 'review');
      if (status === 'READY_FOR_CONFIRMATION' && step === 'review') assert.match(html, /<button[^>]*disabled=""[^>]*>ยืนยันเอกสาร<\/button>/);
    }
  }
  // A reviewer without confirmation rights has no blocked confirm action to carry the sentence.
  const detail = expense({ status: 'READY_FOR_CONFIRMATION', paidAmount: '700', payments: [payment] });
  for (const permissions of [['expense.read', 'expense.review'], ['expense.read'], ['expense.read', 'expense.confirm']]) {
    const html = harness({ detail }, permissions).render();
    assert.equal(visible(html).split(full).length - 1, 1);
    const card = html.match(/data-testid="expense-payment-overpayment"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    assert.ok(card);
    assert.equal(card.includes(full), !permissions.includes('expense.confirm'));
  }
});

test('recheck 3: editing prices shows an adjacent excess cue and sending for review warns without blocking', async () => {
  const detail = expense({ status: 'NEEDS_REVIEW', paidAmount: '700', payments: [payment], outstandingAmount: '0',
    lines: [{ id: 'l1', description: 'สินค้า', quantity: '1', unitPrice: '500', discountAmount: '0', vatRate: '0', whtRate: '0', lineSubtotalAmount: '500', lineTaxAmount: '0', lineTotalAmount: '500' }] });
  const edit = harness({ step: 'data', detail }).render();
  assert.match(edit, /value="500"[^>]*\/><p[^>]*data-testid="expense-overpayment-cue"[^>]*>จ่ายเกินยอดสุทธิ 200.00 บาท<\/p>/);
  const page = harness({ step: 'review', detail, reviewers: [{ userId: 'checker', displayName: 'ผู้ตรวจ' }], requestedReviewer: 'checker' }); let sent = 0;
  const mark = stub(api, 'markExpenseReadyAsReviewer', async () => { sent++; return detail; });
  const get = stub(api, 'getExpense', async () => detail);
  try {
    const html = page.render();
    assert.match(html, /id="expense-review-overpayment"[^>]*>จ่ายเกินยอดสุทธิ 200.00 บาท ส่งให้ตรวจได้ แต่ยืนยันเอกสารไม่ได้จนกว่าจะยกเลิกรายการจ่ายที่เกิน/);
    assert.equal(page.nodes.find(n => n.tag === 'button' && text(n.props.children) === 'ส่งให้ตรวจ')?.props.disabled, false);
    await page.act('button', 'ส่งให้ตรวจ'); assert.equal(sent, 0);
    page.nodes.findLast(n => n.tag === 'button' && text(n.props.children) === 'ส่งให้ตรวจ')!.props.onClick();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(sent, 1);
  } finally { mark.mock.restore(); get.mock.restore(); }
});

test('recheck 4: stale reopen names the already open document and focuses a usable close control', async () => {
  const page = harness({ correctionAction: {}, correctionReason: 'แก้ยอด' });
  const reopen = stub(api, 'reopenExpense', async () => { throw { code: 'expense_correction_blocked' }; });
  const get = stub(api, 'getExpense', async () => expense({ status: 'NEEDS_REVIEW', correctionOpenedAt: '2026-10-04T02:00:00Z', correctionCapabilities: { ...allowed, canReopen: false } }));
  try {
    page.render(); const html = await page.act('form', 'expense-correction-form', 'onSubmit');
    const message = 'เอกสารเปิดแก้ไขอยู่แล้ว ตรวจข้อมูลล่าสุด';
    assert.equal(page.state.correctionError, message); assert.match(dialog(html), /เอกสารเปิดแก้ไขอยู่แล้ว/);
    assert.doesNotMatch(dialog(html), /<textarea|type="submit"|>ยกเลิก<\/button>/);
    assert.equal((dialog(html).match(/<button/g) ?? []).length, 1);
    assert.match(dialog(html), />ปิด<\/button>/);
    assert.deepEqual(focusNotice(page, 'correctionCloseRef', message), { focused: 1, scrolled: 0 });
    const modal = page.nodes.find(n => n.props.open === true && text(n.props.title) === 'แก้ไขเอกสาร');
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
    assert.equal(reads, 1); assert.match(dialog(html), /รายการจ่ายนี้ถูกยกเลิกไปแล้ว/);
    assert.deepEqual(page.successes, []); assert.equal(page.state.correctionReason, 'เหตุผลคนที่สอง');
    assert.equal(page.state.detail.payments[0].cancellationReason, 'เหตุผลเดิม');
    assert.doesNotMatch(dialog(html), /<textarea|type="submit"|>ยกเลิก<\/button>/);
    assert.equal((dialog(html).match(/<button/g) ?? []).length, 1);
    assert.match(dialog(html), />ไม่ยกเลิก<\/button>/);
    assert.deepEqual(focusNotice(page, 'correctionCloseRef', page.state.correctionError), { focused: 1, scrolled: 0 });
    const modal = page.nodes.find(n => n.props.open === true && text(n.props.title) === 'ยกเลิกรายการจ่ายนี้');
    assert.ok(modal); modal.props.footer.props.children[0].props.onClick(); assert.equal(page.state.correctionAction, null);
  } finally { cancel.mock.restore(); get.mock.restore(); }
});

test('recheck 7: blurring the amount normalizes its displayed leading zeros and remainder label', async () => {
  const page = harness({ paidAmount: '0500' });
  page.render(); const html = await page.act('input', 'expense-payment-amount', 'onBlur');
  assert.equal(page.state.paidAmount, '500');
  assert.match(html, /id="expense-payment-amount"[^>]*value="500"/);
  assert.match(html, /บันทึกจ่าย 500.00 บาท/);
});

function recordingExpense(status = 'NEEDS_REVIEW') {
  return expense({ status, taxEvidenceStatus: 'SUPPORTING_ONLY', lines: [{ id: 'l1', description: 'สินค้า', quantity: '1', unitPrice: '500', discountAmount: '0', vatRate: '0', whtRate: '0', lineSubtotalAmount: '500', lineTaxAmount: '0', lineTotalAmount: '500' }] });
}
test('R2 a confirmer sends and confirms once, stays on the expense and rejects a double press', async () => {
  const page = harness({ detail: recordingExpense(), step: 'review' });
  let sends = 0, confirms = 0, release!: () => void;
  const sent = recordingExpense('READY_FOR_CONFIRMATION'); sent.updatedAt = '2026-10-04T02:00:00Z';
  const confirmed = recordingExpense('CONFIRMED');
  const mark = stub(api, 'markExpenseReadyAsReviewer', async () => { sends++; await new Promise<void>(resolve => { release = resolve; }); return sent; });
  const confirm = stub(api, 'confirmExpense', async () => { confirms++; return confirmed; });
  const get = stub(api, 'getExpense', async () => confirmed);
  try {
    page.render();
    const primary = page.nodes.find(n => n.tag === 'button' && text(n.props.children) === 'ยืนยันเอกสาร');
    assert.ok(primary); assert.equal(primary.props.disabled, false);
    assert.ok(page.nodes.some(n => n.tag === 'button' && text(n.props.children) === 'ส่งให้ตรวจ'));
    primary.props.onClick(); primary.props.onClick(); assert.equal(sends, 1);
    release(); await new Promise(resolve => setImmediate(resolve)); page.render();
    assert.equal(confirms, 1); assert.equal(page.state.detail.status, 'CONFIRMED');
    assert.deepEqual(page.routes, []); assert.deepEqual(page.successes, ['ยืนยันเอกสารแล้ว']);
  } finally { mark.mock.restore(); confirm.mock.restore(); get.mock.restore(); }
});
test('R2 a non-confirmer keeps send-only; a confirmer may send to someone else', async () => {
  for (const permissions of [OWNER.filter(permission => permission !== 'expense.confirm'), OWNER]) {
    const sent = { ...recordingExpense('READY_FOR_CONFIRMATION'), reviewRequest: { requestedReviewerUserId: 'checker', requestedReviewerName: 'ผู้ตรวจ', submittedByUserId: 'owner', submittedByName: 'ผู้ส่ง', submittedAt: '2026-10-13T01:00:00Z' } };
    const page = harness({ detail: recordingExpense(), step: 'review', reviewers: [{ userId: 'checker', displayName: 'ผู้ตรวจ' }], requestedReviewer: 'checker' }, permissions);
    const mark = stub(api, 'markExpenseReadyAsReviewer', async (_company: string, _expense: string, person: string) => { assert.equal(person, 'checker'); return sent; });
    const get = stub(api, 'getExpense', async () => sent);
    const confirm = stub(api, 'confirmExpense', async () => { throw Error('send-only must never confirm'); });
    try {
      const html = page.render();
      const label = 'ส่งให้ตรวจ';
      assert.doesNotMatch(html, /ส่งให้ผู้มีสิทธิ์ยืนยันตรวจและยืนยันเอกสาร/);
      await page.act('button', label);
      assert.equal(mark.mock.callCount(), 0); assert.equal(page.state.reviewRequestOpen, true);
      const dialogSend = page.nodes.filter(node => node.tag === 'button' && text(node.props.children) === 'ส่งให้ตรวจ').at(-1);
      assert.ok(dialogSend);
      await dialogSend.props.onClick();
      await new Promise(resolve => setImmediate(resolve));
      const sentHtml = page.render();
      assert.equal(mark.mock.callCount(), 1); assert.equal(confirm.mock.callCount(), 0);
      assert.deepEqual(page.routes, []); assert.match(sentHtml, /ส่งให้ ผู้ตรวจ ตรวจแล้ว เมื่อ/);
    } finally { mark.mock.restore(); confirm.mock.restore(); get.mock.restore(); }
  }
});
test('R2 a refused confirmation keeps the sent expense and retries confirmation without sending again', async () => {
  const page = harness({ detail: recordingExpense(), step: 'review' });
  const sent = recordingExpense('READY_FOR_CONFIRMATION');
  let confirmations = 0;
  const mark = stub(api, 'markExpenseReadyAsReviewer', async () => sent);
  const refusal = 'กรุณาตรวจรายการซ้ำก่อนยืนยันเอกสาร';
  const confirm = stub(api, 'confirmExpense', async () => { confirmations++; if (confirmations === 1) throw { code: 'tax_period_locked', details: { code: 'tax_period_locked', message: refusal } }; return recordingExpense('CONFIRMED'); });
  const get = stub(api, 'getExpense', async () => recordingExpense('CONFIRMED'));
  try {
    page.render(); let html = await page.act('button', 'ยืนยันเอกสาร');
    assert.equal(page.state.detail.status, 'READY_FOR_CONFIRMATION'); assert.match(html, new RegExp(refusal));
    assert.deepEqual(page.routes, []); assert.deepEqual(page.successes, []);
    await page.act('button', 'ยืนยันเอกสาร'); assert.equal(mark.mock.callCount(), 1); assert.equal(confirmations, 2);
    assert.equal(page.state.detail.status, 'CONFIRMED');
  } finally { mark.mock.restore(); confirm.mock.restore(); get.mock.restore(); }
});

test('R2 Next saves the document review without a separate save instruction', () => {
  const page = harness({ step: 'evidence', detail: recordingExpense(), evidenceDirty: true });
  const html = page.render();
  assert.doesNotMatch(html, /กด “บันทึกการตรวจ”|expense-document-review-hint-e1/);
  const next = page.nodes.find(n => n.tag === 'button' && text(n.props.children) === 'ถัดไป');
  assert.equal(next?.props.disabled, false);
  assert.equal(next?.props['aria-describedby'], undefined);
  assert.doesNotMatch(html, />บันทึกการตรวจ<\/button>/);
});

test('R3 manual and cancelled expenses without AI output never show an empty AI review block', () => {
  for (const status of ['CONFIRMED', 'VOIDED']) {
    const html = harness({ detail: expense({ status, captureSource: 'MANUAL' }) }).render();
    assert.doesNotMatch(html, /ข้อมูลจาก AI \(ต้องตรวจสอบก่อนยืนยัน\)/);
  }
  const html = harness({ detail: expense({ status: 'CONFIRMED', extractionId: 'read-1', aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW' } }) }).render();
  assert.doesNotMatch(html, /ข้อมูลจาก AI \(ต้องตรวจสอบก่อนยืนยัน\)/);
});

test('R3 cancelled expense retains reading and file links but hides unavailable writes', () => {
  const details = expense({ status: 'VOIDED', duplicateStatus: 'POSSIBLE_DUPLICATE', duplicateCandidates: [{ id: 'dup', candidateExpenseId: 'other', candidateExpenseNumber: 'EX-OTHER', score: 90, reasonCodesJson: [], status: 'OPEN' }],
    payments: [{ ...payment, status: 'VOIDED', cancellationDocumentId: 'cancelled-document' }],
    cancellationDocumentId: 'cancelled-document' });
  const html = harness({ detail: details, whtHandoff: { id: 'h1', status: 'SYSTEM_ISSUED' } }, [...OWNER, 'expense.duplicate.resolve', 'expense.delete', 'expense.receipt.upload', 'expense.ocr.request', 'wht.certificate.read', 'wht.certificate.correct']).render();
  const controls = [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(match => `${match[1]}: ${match[2]!.match(/aria-label="([^"]*)"/)?.[1] ?? visible(match[3]).trim()}`);
  console.log('R3_CANCELLED_AFTER_CONTROLS', JSON.stringify(controls));
  assert.doesNotMatch(html, /คัดลอกเลขรายจ่าย/);
  for (const label of ['เปิดเต็มจอ', 'ดูไฟล์', 'EX-OTHER']) assert.match(visible(html), new RegExp(label));
  assert.match(html, /href="\/companies\/co\/expenses"/);
  assert.match(html, /ยกเลิกแล้ว/);
  assert.doesNotMatch(html, /ตรวจหารายการซ้ำ|ยืนยันว่าเป็นรายการซ้ำ|ไม่ใช่รายการซ้ำ|ให้ AI อ่านอีกครั้ง|ยอมรับยอด|ยกเลิกรายการจ่ายนี้|แก้ไขหนังสือรับรอง|ออกหนังสือรับรอง 50 ทวิ|บันทึกจ่ายส่วนที่เหลือ|บันทึกจ่าย (?:฿|[\d,]+\.\d{2} บาท)/);
});

test('R3 payment method never wraps and only an effective payment earns the remainder label', () => {
  for (const payments of [[], [{ ...payment, status: 'VOIDED' }], [payment]]) {
    const html = harness({ detail: expense({ payments }), paidAmount: '500' }).render();
    assert.equal(html.includes('บันทึกจ่ายส่วนที่เหลือ 500.00 บาท'), payments.some(row => row.status === 'RECORDED'));
  }
  const html = harness({ detail: expense({ payments: [{ ...payment, paymentMethod: 'BANK_TRANSFER' }] }) }).render();
  assert.match(html, /<span class="whitespace-nowrap">โอนเงิน<\/span>/);
});

test('R4 a totals preview refusal never hides the saved amount and Next can reveal missing fields', () => {
  const d = recordingExpense(); d.vendorNameSnapshot = '';
  const page = harness({ detail: d, step: 'data', reviewTotals: { revision: `${d.id}:${d.updatedAt}`, status: 'error', vatMode: 'NO_VAT', message: 'กรุณากรอกชื่อผู้ขาย' } });
  const html = page.render();
  assert.match(html, /500\.00/);
  assert.equal(page.nodes.find(n => n.tag === 'button' && text(n.props.children) === 'ถัดไป')?.props.disabled, false);
});

test('DETAIL-1 confirmed metrics and document facts retain the outstanding amount, withholding and certificate action', () => {
  for (const status of ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED']) {
    const html = harness({ detail: expense({ whtAmount: '15', outstandingAmount: '485' }), whtHandoff: { id: 'h1', status } }).render();
    const box = html.slice(html.indexOf('data-testid="expense-correction-actions"'), html.indexOf('data-testid="expense-review-form"'));
    assert.match(html, /ค้างจ่าย[\s\S]*485.00 บาท/); assert.match(html, /ภาษีหัก ณ ที่จ่าย[\s\S]*15.00 บาท/);
    assert.doesNotMatch(html, /ไปที่การจ่ายเงิน|ต้องจ่าย ฿/);
    assert.equal(html.includes('ไปที่หนังสือรับรอง 50 ทวิ'), status === 'REQUIRED');
    assert.doesNotMatch(html, />50 ทวิ<\/button>/);
  }
  const done = harness({ detail: expense({ outstandingAmount: '0', paymentStatus: 'PAID' }) }).render();
  assert.match(done, />จ่ายแล้ว<\/span>/);
});

test('R4 cancelled expense leads with its known date and reason, never an actor id', () => {
  const html = harness({ detail: expense({ status: 'VOIDED', voidedAt: '2026-10-12T03:00:00Z', voidedByUserId: 'private-actor-id', voidReason: 'บันทึกซ้ำ' }) }).render();
  const banner = html.slice(html.indexOf('data-testid="expense-cancellation-notice"'), html.indexOf('data-testid="expense-review-form"'));
  assert.match(banner, /รายจ่ายนี้ถูกยกเลิกแล้ว/); assert.match(banner, /12 ต.ค. 2569/); assert.match(banner, /เหตุผล: บันทึกซ้ำ/);
  assert.doesNotMatch(banner, /private-actor-id/);
  assert.match(html, />ยกเลิก<\/span>/);
});

test('R4 certificate jumps scroll to the certificate card, outside the sticky footer', () => {
  // In this build the certificate controls are the card: the jump target wraps it, and the card needs a printable hand-off to offer the issue button.
  const page = harness({ detail: expense({ whtAmount: '15' }), whtHandoff: { id: 'h1', status: 'REQUIRED', systemIssuanceOpen: true, missing: [], payerMissing: [], payeeAddress: 'ที่อยู่ผู้รับเงิน', prefill: { payeeSnapshot: { name: 'ผู้รับเงิน', address: null } } } }, [...OWNER, 'wht.certificate.issue']);
  const html = page.render();
  const anchor = html.indexOf('id="expense-wht-e1"');
  const card = html.indexOf('id="wht-certificate"', anchor);
  assert.ok(anchor >= 0); assert.ok(card > anchor);
  assert.equal(html.indexOf('data-form-action-bar'), -1, 'a confirmed page has no empty sticky bar; its other actions stay in More');
  assert.match(html, /เพิ่มเติม/);
  const previous = globalThis.document, previousWindow = globalThis.window; const jumps: unknown[] = [];
  (globalThis as any).window = { innerHeight: 800, scrollBy: (options: unknown) => jumps.push(options), matchMedia: () => ({ matches: false }) };
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [], getElementById: (id: string) => { assert.equal(id, 'expense-wht-e1'); return focusDomField(); } };
  try {
    assert.equal(page.nodes.some(node => node.tag === 'button' && text(node.props.children) === '50 ทวิ'), false);
    for (const label of ['ไปที่หนังสือรับรอง 50 ทวิ']) page.nodes.find(node => node.tag === 'button' && text(node.props.children) === label)!.props.onClick();
    assert.deepEqual(jumps, [{ top: 148, behavior: 'smooth' }]);
  } finally { (globalThis as any).document = previous; }
});


test('Lane P Next stays on step 2 after a failed save and advances after the review save succeeds', async () => {
  for (const succeeds of [false, true]) {
    let saved = 0;
    const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(match => match[1]);
    let index = 0;
    const realRef = runtime.useRef;
    const ref = stub(runtime, 'useRef', (init: any) => { const value = realRef(init); return names[index++] === 'evidenceSaveRef' ? { current: async () => { saved++; return succeeds; } } : value; });
    const page = harness({ step: 'evidence', detail: recordingExpense(), evidenceDirty: true });
    try {
      page.render(); await page.act('button', 'ถัดไป');
      assert.equal(saved, 1); assert.equal(page.state.step, succeeds ? 'review' : 'evidence');
    } finally { ref.mock.restore(); }
  }
});

test('Lane P a confirmer can press each step and return to the summary without review rights', async () => {
  const page = harness({ detail: expense({ status: 'READY_FOR_CONFIRMATION' }), step: 'review' }, ['expense.read', 'expense.confirm']);
  page.render();
  const steps = page.nodes.find(node => node.tag === 'ThemedSteps')!.props.steps;
  assert.equal(steps.length, 3); assert.ok(steps.every((entry: any) => typeof entry.onSelect === 'function'));
  await steps[0].onSelect(); page.render(); assert.equal(page.state.step, 'data');
  await page.nodes.find(node => node.tag === 'ThemedSteps')!.props.steps[2].onSelect();
  page.render(); assert.equal(page.state.step, 'review');
  await page.act('button', 'กลับ'); assert.equal(page.state.step, 'evidence');
});


test('Lane P sole confirmer sees the explanation and own confirmation, with no send-to-another button', () => {
  const page = harness({ detail: recordingExpense(), step: 'review', reviewers: [] });
  const html = page.render();
  assert.doesNotMatch(html, />ส่งให้ตรวจ<\/button>/);
  assert.match(html, /ร้านนี้ยังไม่มีคนอื่นที่ยืนยันรายจ่ายได้/);
  assert.match(html, />ยืนยันเอกสาร<\/button>/);
});

test('Lane P the checker sees who sent it and another confirmer retains confirmation authority', () => {
  const reviewRequest = { requestedReviewerUserId: 'owner', requestedReviewerName: 'ผู้ตรวจ', submittedByUserId: 'sender', submittedByName: 'ผู้ส่ง', submittedAt: '2026-10-13T01:00:00Z' };
  const html = harness({ detail: { ...recordingExpense('READY_FOR_CONFIRMATION'), reviewRequest }, step: 'review' }).render();
  assert.match(html, /ผู้ส่ง ส่งให้คุณตรวจ เมื่อ/);
  assert.doesNotMatch(html, /ส่งให้ ผู้ตรวจ ตรวจแล้ว/);
  assert.match(html, /08:00 น\./);
  assert.match(html, />ยืนยันเอกสาร<\/button>/);
  const other = harness({ detail: { ...recordingExpense('READY_FOR_CONFIRMATION'), reviewRequest: { ...reviewRequest, requestedReviewerUserId: 'another' } }, step: 'review' }).render();
  assert.match(other, />ยืนยันเอกสาร<\/button>/);
  assert.match(other, /ส่งให้ ผู้ตรวจ ตรวจแล้ว เมื่อ/);
  for (const status of ['CONFIRMED', 'NEEDS_REVIEW', 'DRAFT', 'VOIDED']) {
    assert.doesNotMatch(harness({ detail: { ...recordingExpense(status), reviewRequest } }).render(), /ส่งให้คุณตรวจ เมื่อ|ตรวจแล้ว เมื่อ/);
  }
});

test('Lane P expense payment starts on transfer, has no empty prompt and allows cash instead', () => {
  const page = harness(); page.render();
  const method = page.nodes.find(node => node.tag === 'ThemedSelect' && node.props['aria-label'] === 'วิธีจ่ายเงิน')!.props;
  assert.equal(method.value, 'BANK_TRANSFER'); assert.ok(method.children.flat().every((option: any) => option.props.value));
  method.onChange({ target: { value: 'CASH' } }); page.render(); assert.equal(page.state.paymentMethod, 'CASH');
});

test('Lane P draft payment-document information keeps direct payment available and respects the draft link capability', () => {
  for (const viewerMay of ['open', 'none']) {
    const html = harness({ detail: expense({ correctionCapabilities: { ...allowed, disbursementReservation: { status: 'DRAFT', voucherId: viewerMay === 'open' ? 'draft' : null, documentNumber: null, preparerName: 'ผู้จัดทำ', viewerMay, viewerCanPay: false } } }) }).render();
    assert.match(html, /อยู่ในร่างใบเตรียมจ่ายของ ผู้จัดทำ/);
    assert.equal(html.includes('>เปิดร่าง<'), viewerMay === 'open');
    assert.match(html, /id="expense-payment-amount"/);
    assert.doesNotMatch(html, /เพิ่มเข้าใบเตรียมจ่าย/);
  }
});

test('P defect: a blocked last step names step 2 and its normal-size notice takes the reviewer there', async () => {
  const d = recordingExpense('READY_FOR_CONFIRMATION'); d.aiVerificationSummaryJson = null;
  const page = harness({ detail: d, step: 'review' });
  const html = page.render();
  assert.doesNotMatch(html, /กรุณาบันทึกการตรวจ|text-center text-xs font-medium text-warning/);
  assert.match(html, /ตรวจ “ประเภทเอกสาร” และ “ใช้เป็นหลักฐานรายจ่ายได้ไหม”/);
  assert.match(html, /data-tone="warning"[^>]*class="[^"]*text-sm/);
  assert.match(html, /mangmee-actions[^>]*><button[^>]*>กลับ<\/button>/);
  assert.equal((html.match(/data-form-action-bar/g) ?? []).length, 1);
  assert.doesNotMatch(html, /mangmee-safe-bottom sticky bottom-0/);
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let focused = false;
  (globalThis as any).window = { innerHeight: 800, scrollBy: noop, matchMedia: () => ({ matches: false }), requestAnimationFrame: (callback: () => void) => callback() };
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [], getElementById: (id: string) => {
    assert.equal(id, 'expense-document-review-e1');
    return { closest: () => null, matches: () => false, querySelector: () => focusDomField(() => { focused = true; }) };
  } };
  try { await page.act('button', 'ไปขั้นที่ 2'); }
  finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
  assert.equal(page.state.step, 'evidence');
  assert.equal(focused, true);
  page.state.step = 'review'; page.render();
  await page.act('button', 'กลับ');
  assert.equal(page.state.step, 'evidence');
});

test('P defect: staff headings and final action use the same handoff name and share a group with Back', () => {
  const page = harness({ detail: recordingExpense(), step: 'evidence' }, ['expense.read_own', 'expense.update']);
  const evidence = page.render();
  assert.doesNotMatch(evidence, /ดูเอกสารและหลักฐาน ผู้ตรวจจะเลือกคำตอบให้/);
  assert.match(evidence, /ผู้ตรวจจะเลือกประเภทเอกสารให้ กด “ถัดไป” ได้เลย/);
  assert.doesNotMatch(evidence, /เลือกประเภทเอกสาร แล้วตอบว่า/);
  page.state.step = 'review'; const summary = page.render();
  assert.doesNotMatch(summary, /ดูสรุปอีกครั้ง แล้วส่งให้ตรวจ|ขั้นที่ 3:/);
  assert.match(summary, /mangmee-actions[^>]*><button[^>]*>กลับ<\/button><button[^>]*>ส่งให้ตรวจ<\/button>/);
  assert.doesNotMatch(summary, />ส่งตรวจสอบ<|>ส่งให้คนอื่นตรวจ</);
});


test('P second defects: blocked confirmation explains itself outside the single-row safe-area bar', () => {
  const detail = recordingExpense('READY_FOR_CONFIRMATION'); detail.aiVerificationSummaryJson = null;
  const html = harness({ detail, step: 'review' }).render();
  const bar = html.slice(html.indexOf('data-form-action-bar'));
  assert.doesNotMatch(bar, /ยืนยันไม่ได้|ไปขั้นที่ 2|text-warning/);
  assert.match(html.slice(0, html.indexOf('data-form-action-bar')), /ไปขั้นที่ 2/);
  assert.doesNotMatch(bar, /grid-auto-flow:column/);
  assert.ok(bar.indexOf('>กลับ<') < bar.indexOf('>ยืนยันเอกสาร<'));
});


test('P second defects: receipt absence is shown in the header and summary without an invented tax choice', () => {
  for (const receiptProblem of ['NOT_AVAILABLE', 'LOST']) {
    const detail = recordingExpense('READY_FOR_CONFIRMATION');
    detail.sourceDocumentType = 'EXPENSE_NOTE_TEXT'; detail.taxEvidenceReasonCode = 'MANUAL_OVERRIDE';
    detail.aiVerificationSummaryJson.documentReview.assessment = { route: 'SUBSTITUTE_RECEIPT', receiptProblem, reason: 'ไม่มีใบเสร็จ', attachmentIds: [] };
    const html = harness({ detail, step: 'review' }).render();
    assert.match(html, /ไม่มีใบเสร็จ/); assert.match(html, /ยังไม่ได้ทำใบรับรองแทนใบเสร็จ/);
    if (receiptProblem === 'LOST') assert.match(html, /ใบเสร็จหาย/);
    assert.doesNotMatch(html, /โน้ตค่าใช้จ่าย|ผู้ตรวจแก้ไขผลด้วยตนเอง|ยังไม่มีเลขที่เอกสารอ้างอิง/);
  }
});

test('PAY-LINK payment is primary and the voucher route is quiet below it; refusal is retained', () => {
  const html = harness({}, [...OWNER, 'expense.disbursement.prepare'], true).render();
  const draft = html.indexOf('รวมกับบิลอื่น หรือให้คนอื่นอนุมัติก่อนจ่าย → ใบเตรียมจ่าย');
  const pay = html.indexOf('form="expense-record-payment"');
  assert.ok(pay > 0 && draft > pay);
  const group = html.slice(html.lastIndexOf('<div', pay), html.indexOf('</div>', pay));
  assert.match(group, /mangmee-actions[^>]*><button/);
  assert.doesNotMatch(group, /ใบเตรียมจ่าย|จ่ายแล้วพิมพ์/);
  assert.doesNotMatch(html, /เพิ่มเข้าใบเตรียมจ่าย/);
  assert.match(html, /จ่ายแล้วพิมพ์ใบสำคัญจ่ายได้จากประวัติการจ่าย/);
  const blocked = harness({ detail: expense({ correctionCapabilities: { ...allowed, canRecordPayment: false, recordPaymentBlocker: 'permission_denied' } }) }, ['expense.read']).render();
  assert.match(blocked, /คุณบันทึกจ่ายไม่ได้ ให้คนที่มีสิทธิ์จ่ายเงินของร้านบันทึกให้/);
  assert.doesNotMatch(blocked, /ติดต่อผู้มีสิทธิ์ดำเนินการ/);
});

function receiptlessExpense(certificateStatus?: string) {
  const d = recordingExpense('READY_FOR_CONFIRMATION');
  d.sourceDocumentType = 'EXPENSE_NOTE_TEXT';
  d.vendorNameSnapshot = '';
  d.attachments = [{ id: 'payment-proof', purpose: 'expense.payment.evidence', status: 'ACTIVE', originalFileName: 'หลักฐานการจ่าย.png', mimeType: 'image/png' }];
  const assessment = { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: ['payment-proof'], reason: 'ร้านไม่มีใบเสร็จ' };
  d.aiVerificationSummaryJson = { documentReview: { version: 2, assessment, reviewedAt: d.updatedAt, reviewedByUserId: 'owner', fingerprint: expenseEvidenceFingerprint(d, assessment as any) } };
  d.substituteReceiptEvidence = certificateStatus ? { id: 'src', documentNumber: 'SRC-01', status: certificateStatus, payeeName: 'ป้าศรี แผงผัก ตลาดเช้า',
    signatureMode: 'DIGITAL', payerUserId: 'owner', payerName: 'เจ้าของกิจการ', fundingSource: 'COMPANY', artifactAttachmentId: certificateStatus === 'ISSUED' ? 'issued-file' : null,
    paymentEvidenceAttachmentIds: ['payment-proof'], supportingAttachmentIds: [], businessPurpose: 'ซื้อผัก' } : null;
  return d;
}

test('receiptless step one names the payee and expense date, still offers attaching a receipt, and names its issued certificate', () => {
  const html = harness({ detail: receiptlessExpense('ISSUED'), step: 'data' }).render();
  assert.doesNotMatch(html, /ขั้นที่ 1:|ตรวจชื่อผู้รับเงิน วันที่ และยอดเงิน/);
  assert.match(html, /placeholder="ชื่อผู้รับเงิน"[^>]*value="ป้าศรี แผงผัก ตลาดเช้า"/);
  assert.match(html, /วันที่เกิดค่าใช้จ่าย/);
  assert.match(html, /แนบใบเสร็จ/);
  assert.match(html, /ใบรับรองแทนใบเสร็จ SRC-01 · ออกแล้ว/);
  assert.match(html, /จะแก้ข้อมูลในใบ ต้องยกเลิกใบนี้แล้วสร้างใบใหม่/);
  assert.match(html, />เปิดใบรับรองแทนใบเสร็จ<\/button>/);
  assert.doesNotMatch(html, /ผูกกับใบแทน|ให้ตรงกับใบเสร็จที่แนบไว้|วันที่บนใบเสร็จ ไม่ใช่วันที่จ่าย|ชื่อตามใบเสร็จ|เปลี่ยนไฟล์ใบเสร็จ/);
});

test('receiptless summary gives a way to make or finish the certificate and treats issued evidence as passed', () => {
  for (const [status, expected] of [[undefined, 'ยังไม่ได้ทำใบรับรองแทนใบเสร็จ'], ['PREPARED', 'รอเซ็น'], ['PAYER_CERTIFIED', 'รออนุมัติ'], ['ISSUED', 'ออกแล้ว']] as const) {
    const d = receiptlessExpense(status); d.vendorNameSnapshot = 'ร้านทดสอบ';
    // The saved review must describe these exact facts.
    d.aiVerificationSummaryJson.documentReview.fingerprint = expenseEvidenceFingerprint(d, d.aiVerificationSummaryJson.documentReview.assessment);
    const html = harness({ detail: d, step: 'review' }).render();
    const summary = html.slice(html.indexOf('สรุปการตรวจ'), html.indexOf('สรุปการตรวจ') + 4500);
    assert.ok(summary.includes(expected), status);
    assert.doesNotMatch(summary, /ยังไม่มีเลขผู้เสียภาษี|ยังไม่มีเลขที่เอกสาร|ผู้ตรวจแก้ไขผลด้วยตนเอง|จะทำใบรับรองแทนใบเสร็จ/);
    if (status !== 'ISSUED') assert.ok(summary.includes(status ? 'เปิดใบรับรองแทนใบเสร็จ' : 'ทำใบรับรองแทนใบเสร็จ'));
  }
});

test('missing seller is explained above the preview and both warning actions focus the seller on step one', async () => {
  const page = harness({ detail: receiptlessExpense('ISSUED'), step: 'review' });
  const html = page.render();
  assert.ok(html.indexOf('ยืนยันไม่ได้:') < html.indexOf('data-testid="expense-review-form"'));
  assert.equal((html.match(/>เติมชื่อผู้ขาย<\/button>/g) ?? []).length, 2);
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let focused = 0;
  (globalThis as any).window = { innerHeight: 800, scrollBy: noop, matchMedia: () => ({ matches: false }), requestAnimationFrame: (callback: () => void) => callback() };
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [], getElementById: (id: string) => {
    assert.equal(id, 'expense-vendor-name-e1');
    return focusDomField(() => focused++);
  } };
  try { await page.act('button', 'เติมชื่อผู้ขาย'); }
  finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
  assert.equal(page.state.step, 'data'); assert.equal(focused, 1);
});

test('final review actions let the shared group stack phone buttons and keep compact equal desktop columns', () => {
  for (const status of ['NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']) {
    const html = harness({ detail: recordingExpense(status), step: 'review' }).render();
    const bar = html.slice(html.indexOf('data-form-action-bar'));
    assert.match(bar, /mangmee-safe-bottom/);
    assert.match(bar, /class="mangmee-actions"/);
    assert.doesNotMatch(bar, /grid-auto-flow|grid-auto-columns|!w-full/);
    assert.ok(bar.indexOf('>กลับ<') < bar.indexOf('>ยืนยันเอกสาร<'));
    assert.doesNotMatch(bar, /ยืนยันไม่ได้|width:100%/);
  }
});

test('Next attempts unsaved certificate payee changes and stays on step one if the existing save refuses', async () => {
  const page = harness({ detail: receiptlessExpense('ISSUED'), step: 'data', dataDirty: true });
  page.render(); let saves = 0;
  const form = page.nodes.find(node => node.tag === 'ExpenseReviewEditSection');
  assert.ok(form);
  form.props.saveRef.current = async () => { saves++; return false; };
  await page.act('button', 'ถัดไป');
  assert.equal(saves, 1);
  assert.equal(page.state.step, 'data');
});

test('UX4 totals show a known field refusal with a fix action, and retry only a request failure', async () => {
  const d = recordingExpense();
  const message = 'เอกสารนี้มี VAT เลือกอัตรา หรือกรอกยอด VAT ตามใบเสร็จ';
  const page = harness({ detail: d, step: 'data', reviewTotals: { revision: `${d.id}:${d.updatedAt}`, status: 'error', vatMode: 'VAT_INCLUDED', blocked: true, message } });
  const html = page.render();
  assert.ok(html.includes(message));
  assert.ok(html.includes('ตรวจข้อมูลที่ต้องแก้'));
  assert.ok(!html.includes('คำนวณอีกครั้ง'));
  const form = page.nodes.find(node => node.tag === 'ExpenseReviewEditSection');
  assert.ok(form);
  let revealed = 0;
  form.props.saveRef.current = async () => { revealed++; return false; };
  const previousWindow = globalThis.window;
  (globalThis as any).window = { requestAnimationFrame: (run: () => void) => run() };
  try {
    await page.act('button', 'ตรวจข้อมูลที่ต้องแก้');
    assert.equal(page.state.step, 'data');
    assert.equal(revealed, 1, 'uses the form validation that reveals and focuses the first invalid field');
  } finally { (globalThis as any).window = previousWindow; }
  page.state.reviewTotals = { ...page.state.reviewTotals, blocked: false };
  assert.ok(page.render().includes('คำนวณอีกครั้ง'));
});

test('UX6 confirmed answers appear once in document facts with decision attribution', () => {
  const html = harness({ detail: expense({ vatAmount: '7', taxEvidenceStatus: 'USABLE_FOR_TAX', inputVatClaimStatus: 'CLAIMABLE', inputVatRight: {
    status: 'CLAIMABLE', vatStatus: 'REGISTERED', fixed: false,
    latestDecision: { decidedByName: 'ผู้ตรวจทดสอบ', decidedAt: '2026-10-14T01:00:00Z', reason: 'ใช้ในร้าน' },
  } }) }).render();
  assert.equal((html.match(/>ใช้ VAT ตอนยื่นภาษี<\/dt>/g) ?? []).length, 1);
  assert.equal((html.match(/>หลักฐานรายจ่าย<\/dt>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /ใช้ VAT ตอนยื่นภาษี:|หลักฐานรายจ่าย:/);
  assert.equal((html.match(/ตรวจโดย ผู้ตรวจทดสอบ/g) ?? []).length, 1);
  assert.match(html, /เหตุผล: ใช้ในร้าน/);
  assert.match(html, /<dd[^>]*>ใช้ได้<\/dd>/);
  assert.match(html, /เปลี่ยนคำตอบเรื่อง VAT/);
});
test('UX6 review and confirmed pages omit the right for nonregistered shops and VAT-free papers', () => {
  for (const status of ['NEEDS_REVIEW', 'CONFIRMED']) for (const vatStatus of ['REGISTERED', 'UNKNOWN', 'NOT_REGISTERED']) for (const vatAmount of ['0', '7']) {
    const html = harness({ detail: expense({ status, vatAmount, inputVatClaimStatus: 'NEEDS_REVIEW', inputVatRight: { status: 'NEEDS_REVIEW', vatStatus, fixed: false } }), step: 'review' }).render();
    if (vatStatus === 'NOT_REGISTERED' || vatAmount === '0') assert.doesNotMatch(html, /ใช้ VAT ตอนยื่นภาษี|รอตรวจ VAT สำหรับยื่นภาษี/);
    else assert.match(html, /ใช้ VAT ตอนยื่นภาษี/);
  }
});

test('UX7 payment proof and cancel actions share one equal-sized ActionGroup', () => {
  const page = harness({ detail: expense({ payments: [{ ...payment, slipAttachmentId: 'att' }] }) });
  page.render();
  const group = page.nodes.find(n => n.tag === 'ActionGroup' && text(n.props.children).includes('ดูหลักฐานการจ่าย'));
  assert.ok(group, 'proof belongs to the same shared group as cancel');
  assert.match(text(group.props.children), /ยกเลิกรายการจ่ายนี้/);
  assert.doesNotMatch(text(group.props.children), /col-span-2 justify-self-start/);
});

test('UX7 payment document notices stay outside the equal-sized button group', () => {
  const page = harness({ detail: expense({ payments: [{ ...payment, slipAttachmentId: 'att', disbursementVoucher: { id: null, documentNumber: 'DV-1' } }] }) }, OWNER, true);
  const html = page.render();
  assert.match(html, /DV-1/);
  const group = page.nodes.find(n => n.tag === 'ActionGroup' && text(n.props.children).includes('ดูหลักฐานการจ่าย'));
  assert.ok(group);
  const children = React.Children.toArray(group.props.children).filter(React.isValidElement);
  assert.ok(children.every(child => ['button', 'a'].includes(String(child.type))), 'only buttons and links take equal columns');
});

test('UX8 confirmed waiting VAT keeps its header badge only for a VAT paper outside a nonregistered shop', () => {
  for (const vatStatus of ['REGISTERED', 'UNKNOWN', 'NOT_REGISTERED']) for (const vatAmount of ['0', '7']) {
    const page = harness({ detail: expense({ vatAmount, inputVatClaimStatus: 'NEEDS_REVIEW', inputVatRight: { status: 'NEEDS_REVIEW', vatStatus, fixed: false } }) });
    page.render();
    const badge = page.nodes.some(node => node.tag === 'MangmeeBadge' && text(node.props.children) === 'ใช้ VAT ตอนยื่นภาษี: รอตรวจสอบ');
    assert.equal(badge, vatAmount !== '0' && vatStatus !== 'NOT_REGISTERED');
  }
});

test('DETAIL-1 confirmed document has one metrics card, plain facts and no obsolete navigation', () => {
  const page = harness({ detail: expense({ lines: [{ id: 'line1', description: 'กระดาษ', quantity: '2', unitPrice: '250', discountAmount: '0', lineTotalAmount: '500', lineSubtotalAmount: '500', vatAmount: '0', whtAmount: '0' }] }) });
  const html = page.render();
  assert.match(html, /mangmee-flat/);
  assert.match(html, /รายละเอียดเอกสาร/);
  assert.match(html, /<th[^>]*>รายการ<\/th>/);
  assert.match(html, /<dt[^>]*>ชื่อผู้ขาย<\/dt>/);
  assert.doesNotMatch(html, /คัดลอกเลขรายจ่าย|ไปที่การจ่ายเงิน|ต้องจ่าย ฿|ไฟล์ที่ใช้ประกอบรายการ|รูปแบบ VAT|รายการนี้หักภาษี ณ ที่จ่ายไหม/);
  assert.doesNotMatch(html, /value="กระดาษ"|value="ร้านทดสอบ"/);
  const meta = page.nodes.find(node => node.tag === 'MangmeePage')!.props;
  assert.ok(meta.back);
  assert.equal(text(meta.description).includes('รอจ่าย'), true);
  assert.equal(text(meta.description).includes('บันทึกด้วยมือ'), false);
  assert.equal(text(meta.actions).includes('แก้ไขเอกสาร'), true);
  assert.equal(text(meta.actions).includes('เพิ่มเติม'), true);
  assert.ok(page.nodes.some(node => node.tag === 'ActionGroup' && text(node.props.children).includes('แก้ไขเอกสาร') && text(node.props.children).includes('เพิ่มเติม')), 'header actions share equal sizing');
});

test('DETAIL-1 review retains its steps without the green instruction and capture badge', () => {
  const page = harness({ detail: expense({ status: 'NEEDS_REVIEW' }), step: 'data' });
  const html = page.render();
  assert.match(html, /ข้อมูลผู้ขายและรายการ/);
  assert.doesNotMatch(html, /ขั้นที่ 1:|ตรวจชื่อผู้ขาย เลขที่เอกสาร วันที่ และยอดเงิน ให้ตรงกับใบเสร็จที่แนบไว้/);
  const meta = page.nodes.find(node => node.tag === 'MangmeePage')!.props.description;
  assert.match(text(meta), /รอตรวจ/);
  assert.doesNotMatch(text(meta), /บันทึกด้วยมือ|หลักฐานรายจ่าย/);
});

test('DETAIL-1 confirmed audit contains only warnings and disappears when none remain', () => {
  const good = expense({ vendorDocumentNumber: 'RC-1', taxEvidenceStatus: 'USABLE_FOR_TAX', lines: [{ id: 'l1', description: 'สินค้า', quantity: '1', unitPrice: '500', discountAmount: '0', lineTotalAmount: '500', lineSubtotalAmount: '500', vatAmount: '0', whtAmount: '0' }] });
  const clean = harness({ detail: good }).render();
  assert.doesNotMatch(clean, /สรุปการตรวจ/);
  const warning = harness({ detail: { ...good, vendorNameSnapshot: '' } }).render();
  const summary = warning.slice(warning.indexOf('สรุปการตรวจ'), warning.indexOf('data-expense-document-facts'));
  assert.match(summary, /ยังไม่ระบุชื่อผู้ขาย\/ผู้รับเงิน/);
  assert.doesNotMatch(summary, /มีเลขที่เอกสารอ้างอิง|มีวันที่เอกสาร|หลักฐานรายจ่าย: ใช้ได้/);
});

test('DETAIL-1 confirmed substitute receipt is shown once inside document details with its correction fact', () => {
  const page = harness({ detail: expense({ sourceDocumentType: 'SUBSTITUTE_RECEIPT', substituteReceiptEvidence: { id: 'src1', documentNumber: 'SRC-01', status: 'ISSUED', fundingSource: 'COMPANY', signatureMode: 'DIGITAL', payerName: 'ผู้จ่าย', payeeName: 'ร้านทดสอบ' } }) });
  const html = page.render();
  assert.equal((html.match(/aria-label="ใบรับรองแทนใบเสร็จของรายการนี้"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /border-b border-brand-100 bg-brand-25/);
  assert.match(html, /รายละเอียดเอกสาร[\s\S]*จะแก้ข้อมูลในใบ ต้องยกเลิกใบนี้แล้วสร้างใบใหม่[\s\S]*เปิดดูเอกสาร/);
});

test('DETAIL-1 file append and removal sit in the preview overflow on both layouts', () => {
  const html = harness({ detail: recordingExpense(), step: 'data' }).render();
  assert.equal((html.match(/<summary[^>]*>ตัวเลือกไฟล์<\/summary>/g) ?? []).length, 2);
  assert.match(html, /class="mangmee-actions"><details[\s\S]*?ตัวเลือกไฟล์[\s\S]*?<button[^>]*class="mangmee-btn mangmee-btn-secondary"[^>]*>ดูไฟล์<\/button><\/div>/);
  for (const block of html.split('<summary').slice(1).filter(block => block.includes('ตัวเลือกไฟล์'))) {
    const menu = block.slice(0, block.indexOf('</details>'));
    assert.match(menu, /แนบหลักฐานเพิ่ม/); assert.match(menu, /ลบไฟล์/); assert.match(menu, /โหลดไฟล์ใหม่/);
  }
});

test('BEH-P invalid amounts keep payment pressable and describe the amount beside its input', async () => {
  const page = harness({ paidAmount: '99999' });
  const html = page.render();
  const amount = page.nodes.find(n => n.props.id === 'expense-payment-amount')!;
  assert.equal(amount.props['aria-describedby'], 'expense-payment-amount-error');
  assert.equal(amount.props['aria-invalid'], true);
  assert.match(html, /id="expense-payment-amount-error"/);
  assert.ok(html.indexOf('id="expense-payment-amount-error"') < html.indexOf('แนบสลิป (ถ้ามี)'));
  assert.equal(page.nodes.find(n => n.tag === 'button' && n.props.form === 'expense-record-payment')?.props.disabled, false);
});

test('BEH-P next stays pressable after field validation fails on either step', () => {
  for (const step of ['data', 'evidence']) {
    const page = harness({ step, dataErrorCount: 1, dataErrorMessage: 'ใส่ราคาต่อหน่วย', evidenceStepBlocker: 'expenses.doc_review_choose_required', detail: expense({ status: 'NEEDS_REVIEW' }) });
    page.render();
    assert.equal(page.nodes.find(n => n.tag === 'button' && text(n.props.children) === 'ถัดไป')?.props.disabled, false);
  }
});

test('BEH-P an invalid payment press focuses the amount and sends nothing', async () => {
  const page = harness({ paidAmount: '99999' });
  let focused = 0, sent = 0;
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [], getElementById(id: string) { assert.equal(id, 'expense-payment-amount'); return focusDomField(() => focused++); } };
  (globalThis as any).window = { innerHeight: 800, scrollBy: noop, matchMedia: () => ({ matches: true }) };
  const record = stub(api, 'recordExpensePayment', async () => { sent++; });
  try {
    page.render(); await page.act('form', 'expense-record-payment', 'onSubmit');
    assert.equal(focused, 1); assert.equal(sent, 0);
    assert.equal(page.nodes.find(n => n.tag === 'button' && n.props.form === 'expense-record-payment')?.props.disabled, false);
  } finally { record.mock.restore(); globalThis.document = oldDocument; globalThis.window = oldWindow; }
});

test('BEH-P header keeps its status left and review actions in the header at both widths', () => {
  for (const status of ['NEEDS_REVIEW', 'CONFIRMED']) {
    const page = harness({ detail: expense({ status }) }, [...OWNER, 'expense.reject']); page.render();
    const header = page.nodes.find(n => n.tag === 'MangmeePage')!.props;
    assert.equal(header.meta, undefined);
    assert.match(text(header.description), status === 'CONFIRMED' ? /รอจ่าย/ : /รอตรวจ/);
    assert.match(text(header.actions), /เพิ่มเติม/);
    assert.ok(page.nodes.some(n => n.tag === 'ActionGroup' && n.props.className?.includes('!grid-flow-col') && text(n.props.children).includes('เพิ่มเติม')));
  }
});

test('BEH-P correction and reject focus their heading on touch and their reason on wide screens', () => {
  for (const touch of [true, false]) for (const rejecting of [true, false]) {
    const page = harness({ correctionAction: rejecting ? null : {}, showReject: rejecting });
    const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(m => m[1]);
    const realRef = runtime.useRef; let index = 0;
    const focused: string[] = [];
    const originalWindow = globalThis.window;
    (globalThis as any).window = { requestAnimationFrame: (fn: () => void) => { fn(); return 1; }, cancelAnimationFrame: noop, matchMedia: () => ({ matches: touch }) };
    const reason = { focus: () => focused.push('reason'), closest: () => ({ querySelector: () => ({ focus: () => focused.push('heading') }) }) };
    const refs = stub(runtime, 'useRef', (init: any) => { const value = realRef(init); return names[index++] === (rejecting ? 'rejectReasonRef' : 'correctionReasonRef') ? { current: reason } : value; });
    const effects = stub(runtime, 'useEffect', (fn: () => void, deps?: any[]) => { if (deps?.length === 3 && deps[0] === page.state.correctionAction && deps[1] === rejecting) fn(); });
    try { page.render(); assert.deepEqual(focused, [touch ? 'heading' : 'reason']); }
    finally { refs.mock.restore(); effects.mock.restore(); globalThis.window = originalWindow; }
  }
});

test('BEH-P closing an owned reason dialog returns focus to its opener without scrolling', () => {
  const page = harness({ correctionAction: null, showReject: false });
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(m => m[1]);
  const realRef = runtime.useRef; let index = 0;
  const focused: any[] = [];
  const originalWindow = globalThis.window;
  (globalThis as any).window = { requestAnimationFrame: (fn: () => void) => { fn(); return 1; }, cancelAnimationFrame: noop };
  const refs = stub(runtime, 'useRef', (init: any) => { const value = realRef(init); return names[index++] === 'dialogOpenerRef' ? { current: { focus: (options: any) => focused.push(options) } } : value; });
  const effects = stub(runtime, 'useEffect', (fn: () => void, deps?: any[]) => { if (deps?.length === 3 && deps[0] === null && deps[1] === false) fn(); });
  try { page.render(); assert.deepEqual(focused, [{ preventScroll: true }]); }
  finally { refs.mock.restore(); effects.mock.restore(); globalThis.window = originalWindow; }
});

test('BEH-P only a completed correction action requests history or review focus', () => {
  for (const afterCorrectionFocus of [null, { paymentId: 'p1' }, {}]) {
    const page = harness({ afterCorrectionFocus, correctionAction: null, detail: expense({ correctionOpenedAt: '2026-10-04T02:00:00Z' }) });
    const oldDocument = globalThis.document, oldWindow = globalThis.window;
    const focused: string[] = [];
    const heading = focusDomField(() => focused.push('expense-payment-history-heading'));
    const row = focusDomField();
    const history = { ...focusDomField(), querySelector: (selector: string) => selector === '[data-payment-history-heading]' ? heading : row };
    (globalThis as any).document = { querySelector: (selector: string) => selector === '[data-testid="expense-payment-history"]' ? history : null, querySelectorAll: () => [], getElementById: (id: string) => focusDomField(() => focused.push(id)) };
    (globalThis as any).window = { innerHeight: 800, scrollBy: noop, matchMedia: () => ({ matches: true }) };
    const effects = stub(runtime, 'useEffect', (fn: () => void) => { if (String(fn).includes('afterCorrectionFocus')) fn(); });
    try {
      page.render();
      assert.deepEqual(focused, afterCorrectionFocus === null ? [] : ['paymentId' in afterCorrectionFocus ? 'expense-payment-history-heading' : 'expense-review-start']);
      assert.equal(page.state.afterCorrectionFocus, null);
    } finally { effects.mock.restore(); globalThis.document = oldDocument; globalThis.window = oldWindow; }
  }
});

test('BEH-P pressing a payment with a stale-total conflict focuses its refusal and never writes again', async () => {
  const page = harness({ conflictReload: true, paymentNotice: 'เปิดหน้านี้ใหม่ก่อนทำรายการอีกครั้ง' });
  let focused = 0, sent = 0;
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [], getElementById(id: string) { assert.equal(id, 'expense-payment-notice'); return focusDomField(() => focused++); } };
  (globalThis as any).window = { innerHeight: 800, scrollBy: noop, matchMedia: () => ({ matches: true }) };
  const record = stub(api, 'recordExpensePayment', async () => { sent++; });
  try {
    page.render(); await page.act('form', 'expense-record-payment', 'onSubmit');
    assert.equal(focused, 1); assert.equal(sent, 0);
  } finally { record.mock.restore(); globalThis.document = oldDocument; globalThis.window = oldWindow; }
});

test('DETAIL-2a step 1 shows seller invoice fields in paper order without a fold', () => {
  const html = harness({ detail: expense({ status: 'DRAFT' }), step: 'data' }).render();
  const fields = html.slice(html.indexOf('id="expense-review-fields-e1"'), html.indexOf('id="expense-line-items-e1"'));
  const labels = ['ชื่อผู้ขาย', 'เลขประจำตัวผู้เสียภาษีผู้ขาย', 'สาขาของผู้ขายตามใบ', 'เลขที่เอกสาร', 'ที่อยู่ผู้ขายตามใบ', 'วันที่เอกสาร'];
  let last = -1;
  for (const label of labels) { const at = fields.indexOf(label); assert.ok(at > last, label); last = at; }
  assert.doesNotMatch(fields, /<details|พิมพ์ตามที่ใบพิมพ์ไว้ ไม่บังคับ/);
  assert.match(fields, /ใส่ตามที่ใบระบุ ถ้าใบไม่ระบุให้เลือกสำนักงานใหญ่/);
  assert.match(fields, /วันที่บนใบเสร็จ ไม่ใช่วันที่จ่าย/);
});

test('DETAIL-2a draft save and Next share the sticky bar and equal button sizing', () => {
  const page = harness({ detail: expense({ status: 'DRAFT' }), step: 'data' });
  const html = page.render();
  const bar = html.slice(html.indexOf('data-form-action-bar'));
  assert.match(bar, /mangmee-actions[\s\S]*>บันทึกร่าง<\/button>[\s\S]*>ถัดไป<\/button>/);
  assert.equal((html.match(/>บันทึกร่าง<\/button>/g) ?? []).length, 1);
  for (const label of ['บันทึกร่าง', 'ถัดไป']) {
    const button = page.nodes.find(n => n.tag === 'button' && text(n.props.children) === label)!;
    assert.match(button.props.className, /mangmee-btn/);
  }
  for (const busyState of ['stepSaving', 'reviewSaving']) {
    const saving = harness({ detail: expense({ status: 'DRAFT' }), step: 'data', [busyState]: true }).render();
    assert.match(saving.slice(saving.indexOf('data-form-action-bar')), /disabled=""[^>]*aria-busy="true"/);
  }
});

test('DETAIL-2a review metrics show live total and tax facts without an unpaid badge or pay bar', () => {
  const d = expense({ status: 'DRAFT' });
  for (const taxed of [false, true]) {
    const page = harness({ detail: d, step: 'data', reviewTotals: { revision: `${d.id}:${d.updatedAt}`, status: 'ready', vatMode: taxed ? 'VAT_EXCLUDED' : 'NO_VAT', totals: {
      subtotalAmount: '1000', discountAmount: '0', taxableAmount: '1000', vatAmount: taxed ? '70' : '0', whtAmount: taxed ? '30' : '0', grandTotalAmount: taxed ? '1070' : '1000', netPayableAmount: taxed ? '1040' : '1000', outstandingAmount: taxed ? '1040' : '1000',
    } } });
    page.render();
    const grid = page.nodes.find(n => n.tag === 'MetricGrid')!;
    assert.ok(grid);
    assert.deepEqual(grid.props.items.map((item: any) => item.key), taxed ? ['total', 'vat', 'wht', 'net'] : ['total']);
    assert.equal(grid.props.items[0].label, 'ยอดรวม');
    assert.equal(grid.props.items[0].value, taxed ? '1,070.00' : '1,000.00');
    const card = page.render().split('data-testid="expense-review-totals"')[1]?.split('</section>')[0] ?? '';
    assert.doesNotMatch(card, /ยังไม่จ่าย|bg-brand-50|ยอดที่ต้องจ่าย/);
  }
});

// Focus on open (heading on a phone, reason on a wide screen) is pinned by the BEH-P dialog test above.
test('DETAIL-2a payment cancellation puts its error below the reason and never autofocuses it', () => {
  const html = dialog(harness({ detail: expense({ payments: [payment] }), correctionAction: { paymentId: 'p1' }, correctionError: EXPENSE_CORRECTION_WORDS.reasonRequired }).render());
  assert.doesNotMatch(html, /autofocus=""/);
  assert.match(html, /data-expense-dialog-heading/);
  assert.ok(html.indexOf('</textarea>') < html.indexOf(EXPENSE_CORRECTION_WORDS.reasonRequired));
});

test('DETAIL-2a receipt pane uses review 2:3 and confirmed 1:2 with a capped, intrinsic image height', () => {
  for (const status of ['DRAFT', 'CONFIRMED']) {
    const html = harness({ step: 'data', detail: expense({ status, attachments: [{ id: 'att', purpose: 'expense.receipt.primary', mimeType: 'image/jpeg', originalFileName: 'ใบเสร็จ' }] }), viewerUrls: { att: 'blob:receipt' } }).render();
    assert.ok(html.includes(status === 'DRAFT' ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'));
    assert.match(html, /overflow-hidden rounded-xl bg-white shadow-sm/);
    assert.match(html, /style="top:[^"]*;max-height:[^"]*"/);
    assert.doesNotMatch(html, /;height:calc/);
    assert.match(html, /<img[^>]*class="block h-auto w-full bg-white"/);
  }
});

test('DETAIL-2a sticky draft save calls the existing explicit save and stays on step 1 while busy', async () => {
  const page = harness({ detail: expense({ status: 'DRAFT' }), step: 'data' });
  const names = [...readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8').matchAll(/const (\w+) = useRef/g)].map(m => m[1]);
  const realRef = runtime.useRef; let index = 0;
  const calls: boolean[] = [];
  let finish!: (saved: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const ref = mock.method(runtime, 'useRef', (init: any) => {
    const value = realRef(init);
    return names[index++] === 'reviewSaveRef' ? { current: (explicit: boolean) => { calls.push(explicit); return pending; } } : value;
  });
  try {
    page.render();
    const button = page.nodes.find(n => n.tag === 'button' && text(n.props.children) === 'บันทึกร่าง')!;
    const saving = button.props.onClick();
    assert.equal(page.state.stepSaving, true);
    assert.deepEqual(calls, [true]);
    finish(true); await saving;
    assert.equal(page.state.stepSaving, false);
    assert.equal(page.state.step, 'data');
  } finally { ref.mock.restore(); }
});


test('DETAIL-2b back control keeps the list target and asks before discarding typed text', async () => {
  const target = '/companies/co/expenses?month=2026-09&page=3&highlight=e1';
  for (const dirty of [false, true]) for (const leave of [false, true]) {
    const view = harness({ dataDirty: dirty, leaveAnswer: leave }, OWNER, false, '/companies/co/expenses?month=2026-09&page=3');
    const html = view.render();
    const link = view.nodes.find(node => node.tag === 'MangmeePage')!.props.back.props;
    assert.equal(link.href, target); assert.equal(link.children, 'กลับไปรายการ');
    assert.match(link.className, /mangmee-btn-secondary !min-h-9 !py-1.5/);
    assert.doesNotMatch(html, /← กลับไปรายการ/);
    const preventDefault = mock.fn(); link.onClick({ preventDefault });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(preventDefault.mock.callCount(), dirty ? 1 : 0);
    assert.deepEqual(view.routes, dirty && leave ? [target] : []);
  }
});

test('PAY-LINK the first-payment hint disappears once a payment history exists', () => {
  const payment = { id: 'pay', status: 'RECORDED', amount: '100', paidAt: '2026-10-04', paymentMethod: 'CASH', canIssueDisbursementVoucher: true };
  const html = harness({ detail: expense({ payments: [payment] }) }, [...OWNER, 'expense.disbursement.issue'], true).render();
  assert.doesNotMatch(html, /จ่ายแล้วพิมพ์ใบสำคัญจ่ายได้จากประวัติการจ่าย/);
  assert.match(html, /ออกใบสำคัญจ่าย/);
});
test('PAY-LINK voucher-only payer keeps the secondary entry and direct-payment refusal', () => {
  const html = harness({ detail: expense({ correctionCapabilities: { ...allowed, canRecordPayment: false, recordPaymentBlocker: 'permission_denied' } }) }, ['expense.read', 'expense.disbursement.prepare', 'expense.disbursement.approve'], true).render();
  assert.match(html, /รวมกับบิลอื่น หรือให้คนอื่นอนุมัติก่อนจ่าย → ใบเตรียมจ่าย/);
  assert.match(html, /คุณบันทึกจ่ายไม่ได้ ให้คนที่มีสิทธิ์จ่ายเงินของร้านบันทึกให้/);
  assert.doesNotMatch(html, /form="expense-record-payment"|จ่ายแล้วพิมพ์ใบสำคัญจ่ายได้จากประวัติการจ่าย/);
});


test('WHT-LIST4 landing focuses only the section heading once and consumes its query without scrolling the router', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  for (const [section, id] of Object.entries({ payment: 'expense-payment-heading', withholding: 'expense-withholding-heading', certificate: 'wht-certificate', checks: 'expense-checks-heading' })) {
    const focuses: any[] = [], scrolls: any[] = [];
    const sectionBox = { closest: () => null, getBoundingClientRect: () => ({ top: 1000, bottom: 1900, height: 900 }) };
    const heading = { closest: (selector: string) => selector === 'section, fieldset' ? sectionBox : null, matches: () => false, getBoundingClientRect: () => ({ top: 1000, bottom: 1030, height: 30 }), focus: (options: any) => focuses.push(options) };
    (globalThis as any).document = {
      getElementById: (value: string) => { assert.equal(value, id); return heading; },
      querySelector: () => null, querySelectorAll: () => [],
    };
    (globalThis as any).window = { innerHeight: 800, matchMedia: () => ({ matches: true }), scrollBy: (options: any) => scrolls.push(options) };
    const page = harness({ detail: expense({ whtAmount: '15' }) }, [...OWNER, 'wht.certificate.issue'], false, '/companies/co/expenses?tab=confirmed', section);
    try {
      const html = page.render(); assert.ok(html.includes(`id="${id}"`));
      assert.equal(page.landingEffects.length, 1);
      page.landingEffects[0](); page.landingEffects[0](); // Strict Mode replays the effect.
      assert.deepEqual(focuses, [{ preventScroll: true }]); assert.deepEqual(scrolls, [{ top: 992, behavior: 'auto' }]);
      assert.equal(page.replacements.length, 1); assert.deepEqual(page.replacements[0].options, { scroll: false });
      const url = new URL(page.routes[0], 'http://localhost');
      assert.equal(url.searchParams.has('section'), false); assert.equal(url.searchParams.get('back'), '/companies/co/expenses?tab=confirmed');
      assert.doesNotMatch(html, /data-dialog|role="dialog"/);
      // The only focused node is the heading; there is no field click or picker/menu invocation.
      assert.equal((heading as any).tabIndex, -1);
    } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
  }
});

test('WHT-LIST4 absent or hidden sections consume the landing without a jump; loading waits', () => {
  const oldDocument = globalThis.document;
  try {
    for (const target of [null, { closest: () => ({ hidden: true }) }]) {
      (globalThis as any).document = { getElementById: () => target };
      const page = harness({}, OWNER, false, null, 'certificate'); page.render();
      page.landingEffects[0](); page.landingEffects[0]();
      assert.deepEqual(page.routes, ['/companies/co/expenses/e1']);
    }
    (globalThis as any).document = { getElementById: () => { throw Error('must wait for the expense'); } };
    const loading = harness({ loading: true }, OWNER, false, null, 'payment'); loading.render(); loading.landingEffects[0]();
    assert.deepEqual(loading.routes, []);
    const ordinary = harness(); ordinary.render(); ordinary.landingEffects[0](); assert.deepEqual(ordinary.routes, []);
  } finally { globalThis.document = oldDocument; }
});


test('EVIDENCE-1 confirmed checks contain only list failures and use the existing correction command', () => {
  const page = harness({ detail: expense({ categoryName: null, taxEvidenceStatus: 'NEEDS_REVIEW', vendorNameSnapshot: '' }) });
  const html = page.render();
  const card = /<section[^>]+data-testid="expense-evidence-checks"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
  assert.match(card, /id="expense-checks-heading" tabindex="-1"/);
  for (const phrase of ['สิ่งที่ต้องแก้', 'ไม่มีผู้ขาย', 'ยังไม่จัดหมวด', 'หลักฐานรายจ่ายรอตรวจ', 'แก้ชื่อผู้ขาย', 'แก้หมวดหมู่', 'แก้หลักฐานรายจ่าย']) assert.ok(card.includes(phrase), phrase);
  assert.doesNotMatch(card, /ครบแล้ว|ไม่มีไฟล์|✓|—/);
  page.nodes.find(node => node.tag === 'button' && text(node.props.children) === 'แก้หมวดหมู่')!.props.onClick({ currentTarget: { focus() {}, closest() { return null; } } });
  assert.deepEqual(page.state.correctionAction, {});
});

test('EVIDENCE-1 complete expenses have no accounting failure card and evidence back preserves its page', () => {
  const back = '/companies/co/expenses/evidence?yearMonth=2026-09&flagFilter=ok&order=oldest&page=3';
  const page = harness({ detail: expense({ categoryName: 'สำนักงาน', expenseCategoryId: 'c1', taxEvidenceStatus: 'USABLE_FOR_TAX' }) }, OWNER, false, back);
  const html = page.render();
  assert.doesNotMatch(html, /data-testid="expense-evidence-checks"/);
  assert.match(html, /href="\/companies\/co\/expenses\/evidence\?page=3&amp;yearMonth=2026-09&amp;flagFilter=ok&amp;order=oldest&amp;highlight=e1"/);
});


test('UAT-T1 issued substitute receipt displays one named document while retaining the evidence chain', () => {
  const files = [{ id: 'certified', purpose: 'expense.review.evidence', originalFileName: 'SRC-01-certified.svg', mimeType: 'image/svg+xml' },
    { id: 'issued', purpose: 'expense.review.evidence', originalFileName: 'SRC-01.svg', mimeType: 'image/svg+xml' }];
  const detail = expense({ attachments: files, substituteReceiptEvidence: { status: 'ISSUED', documentNumber: 'SRC-01', artifactAttachmentId: 'issued', certifiedArtifactAttachmentId: 'certified' } });
  const html = harness({ detail }).render();
  assert.match(html, /ใบรับรองแทนใบเสร็จ SRC-01/); assert.equal((html.match(/ไฟล์เอกสาร/g) ?? []).length, 2);
  assert.doesNotMatch(html, /SRC-01-certified.svg|SRC-01.svg|ภาพเวกเตอร์/);
  assert.equal(detail.attachments.length, 2);
});

test('UAT-T1 AI missing-field output never renders a blank chip or an empty missing-list heading', () => {
  const html = harness({ detail: expense({ status: 'NEEDS_REVIEW', extractionId: 'ocr', aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['', '  ', 'unknown_field'] } }) }).render();
  assert.doesNotMatch(html, /ข้อมูลที่ยังขาด:|ข้อมูลที่ต้องตรวจเพิ่ม/);
});


test('UAT-T1 issued receipt payee and purpose remain visible as read-only facts in the review form', () => {
  const d = recordingExpense();
  Object.assign(d, { vendorNameSnapshot: 'แม่ค้าผักทดสอบ', note: 'วัตถุประสงค์: ทดสอบระบบ',
    sourceDraft: { header: { vendorName: null, businessPurpose: null, expenseDate: '2026-10-03' }, items: [], missingFields: [], canEdit: true },
    substituteReceiptEvidence: { status: 'ISSUED', documentNumber: 'SRC-01', payeeName: 'แม่ค้าผักทดสอบ', businessPurpose: 'ทดสอบระบบ', artifactAttachmentId: 'issued' } });
  const page = harness({ detail: d, step: 'data' }); page.render();
  const seller = page.nodes.find(n => n.tag === 'input' && n.props.id === 'expense-vendor-name-e1')!.props;
  const purpose = page.nodes.find(n => n.tag === 'textarea' && n.props['aria-label'] === 'ซื้อไปใช้ทำอะไร')!.props;
  assert.equal(seller.value, 'แม่ค้าผักทดสอบ'); assert.equal(seller.readOnly, true);
  assert.equal(purpose.value, 'ทดสอบระบบ'); assert.equal(purpose.readOnly, true);
});

test('EVID-1 confirmed original-paper expense shows the image to-do until its later file is selected', () => {
  const detail = expense({ sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', inputVatClaimStatus: 'CLAIMABLE', categoryName: 'สำนักงาน' });
  detail.attachments = []; detail.primaryAttachmentId = null;
  const assessment = { route: 'SOURCE_DOCUMENT' as const, receiptProblem: 'NONE' as const, attachmentIds: [] as string[], reason: '', originalDocumentAvailable: true, note: 'อยู่กับผู้ทำบัญชี' };
  const review = () => { detail.aiVerificationSummaryJson = { documentEvidenceDraft: assessment, documentReview: { version: 2, assessment, reviewedAt: detail.updatedAt, reviewedByUserId: 'owner', fingerprint: expenseEvidenceFingerprint(detail, assessment) } }; };
  review();
  const before = harness({ detail }).render();
  assert.match(before, /ยังไม่มีรูปเอกสาร/); assert.match(before, /เพิ่มไฟล์หลักฐาน/); assert.match(before, /อยู่กับผู้ทำบัญชี/);
  detail.attachments = [{ id: 'later', status: 'ACTIVE', purpose: 'expense.receipt.primary', originalFileName: 'ใบกำกับ.png', mimeType: 'image/png' }];
  assert.match(harness({ detail }).render(), /ยังไม่มีรูปเอกสาร/);
  assessment.attachmentIds = ['later']; review();
  assert.doesNotMatch(harness({ detail }).render(), /ยังไม่มีรูปเอกสาร/);
});


test('PWS-VAT renders the plain VAT question, reviewer condition and reason without changing codes', () => {
  const { ExpenseInputVatRight } = require('./ExpenseInputVatRight');
  const detail = expense({ sourceDocumentType: 'TAX_INVOICE', vatAmount: '7', inputVatClaimStatus: 'CLAIMABLE',
    inputVatRight: { status: 'CLAIMABLE', vatStatus: 'REGISTERED', fixed: false, conditions: [{ code: 'CLAIMABLE_TYPE', answer: true }] } });
  const html = renderToStaticMarkup(h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true, saveRef: { current: null } }));
  assert.match(html, /aria-label="ใช้ VAT ตอนยื่นภาษี"/);
  assert.match(html, /VAT นี้ไม่ใช่รายการที่กฎห้ามใช้ เช่น ค่าเลี้ยงรับรอง/);
  assert.match(html, /ประเภทเอกสารใช้ VAT ตอนยื่นภาษีได้/);
  assert.doesNotMatch(html, /ภาษีซื้อต้องห้าม|สิทธิภาษีซื้อ/);
  const reason = renderToStaticMarkup(h(ExpenseInputVatRight, { companyId: 'co', detail: { ...detail, inputVatClaimStatus: 'NON_CLAIMABLE', inputVatRight: { ...detail.inputVatRight, status: 'NON_CLAIMABLE' } }, canReview: true, saveRef: { current: null } }));
  assert.match(reason, /aria-label="เหตุผลที่เลือกใช้ VAT ตอนยื่นภาษี"/);
  for (const canReview of [true, false]) {
    const unclassified = renderToStaticMarkup(h(ExpenseInputVatRight, { companyId: 'co', detail: { ...detail, sourceDocumentType: 'NEEDS_REVIEW' }, canReview }));
    assert.ok(unclassified.includes(canReview ? 'เลือกประเภทเอกสารแล้วกด “ถัดไป” เพื่อตรวจ VAT' : 'ผู้ตรวจจะเลือกประเภทเอกสารก่อนตรวจ VAT'));
  }
});


test('PWS-VAT free source drafts keep financial VAT controls hidden while paid readers see only facts', () => {
  const detail = expense({ status: 'NEEDS_REVIEW', sourceDocumentType: 'TAX_INVOICE', vatAmount: '7', inputVatClaimStatus: 'NEEDS_REVIEW',
    inputVatRight: { status: 'NEEDS_REVIEW', vatStatus: 'REGISTERED', fixed: false } });
  const free = harness({ detail, freeExpenseDrafts: true }).render();
  assert.doesNotMatch(free, /ใช้ VAT ตอนยื่นภาษี|ตรวจ VAT สำหรับยื่นภาษี|บันทึกคำตอบเรื่อง VAT|เปลี่ยนคำตอบเรื่อง VAT/);
  for (const permissions of [['expense.read'], ['expense.read', 'expense.confirm']]) {
    const paid = harness({ detail: { ...detail, status: 'CONFIRMED' } }, permissions).render();
    assert.match(paid, /ใช้ VAT ตอนยื่นภาษี/);
    assert.doesNotMatch(paid, />ตรวจ VAT สำหรับยื่นภาษี<|>เปลี่ยนคำตอบเรื่อง VAT<|aria-label="ใช้ VAT ตอนยื่นภาษี"/);
  }
});

test('PWS-DICTIONARY-EN buyer VAT guidance keeps undo neutral and directs line-owned VAT to its items', () => {
  const { t } = require('@/common/i18n/workspace-i18n.logic');
  assert.equal(t('expenses.buyer_match_undo', 'en'), 'Undo the mark');
  assert.equal(t('expenses.buyer_match_change_line_tax_code', 'en'), 'Choose a VAT option that excludes each item from tax filing, then save.');
  for (const suffix of ['hint', 'mark_non_claimable', 'mark_title', 'mark_message', 'marked_toast', 'marked_non_claimable', 'mark_needs_reviewer', 'undo', 'already_not_claimed', 'change_line_tax_code', 'line_tax_not_claimed']) {
    assert.doesNotMatch(t(`expenses.buyer_match_${suffix}`, 'en'), /input VAT|claimable|tax settings/);
  }
});


test('PWS-MONEY rendered override keeps document amounts, reason and the actual confirm action', () => {
  const { certificateHarness } = require('./expense-certificate-test-harness');
  const { ExpenseReviewEditSection } = require('./ExpensesPages');
  const capture = stub(policy, 'useExpenseCapturePolicy', () => ({ mode: 'FULL', vatStatus: 'NOT_REGISTERED' }));
  const d = recordingExpense();
  d.vatMode = 'VAT_EXCLUDED'; d.taxableAmount = '100'; d.vatAmount = '7'; d.lines[0].vatRate = '0.07';
  d.vatCaptureSnapshotJson = { version: 1, source: { inputType: 'BOTH', origin: 'REVIEWER', vatRatePercent: '7', vatAmount: '9', taxableAmount: '100', grossAmount: '109' },
    calculation: { vatAmount: '7', vatBaseAmount: '100', lineResults: [] },
    reconciliation: { status: 'MISMATCH', acceptedSource: null, differenceAmount: '2', toleranceAmount: '0.05', attentionLineNumbers: [1] } };
  const view = certificateHarness(() => h(ToastContext.Provider, { value: { success: noop, error: noop, warning: noop } }, h(ExpenseReviewEditSection, { companyId: 'co', detail: d, isMutable: true, canReview: true, canConfirm: true, onSaved: async () => {} })));
  try {
    const html = view.render();
    assert.match(html, /ร้านไม่ได้จด VAT จึงนำ VAT ในใบนี้ไปใช้ตอนยื่นภาษีไม่ได้/);
    assert.match(html, /รายการที่รับส่วนต่าง VAT/);
    assert.match(html, /เหตุผล \(จำเป็น\)/);
    assert.match(html, /VAT จากเอกสาร/);
    view.find('ThemedSelect', (props: any) => String(props.onChange).includes('setVatOverrideLineNumber')).onChange({ target: { value: '1' } });
    view.find('textarea', (props: any) => props.placeholder?.startsWith('เช่น ใบเสร็จพิมพ์ VAT')).onChange({ target: { value: 'ตรวจบิลแล้ว' } });
    assert.match(view.render(), /กด “ยืนยันเอกสาร” เพื่อใช้ยอดตามเอกสารและเก็บเหตุผลไว้/);
    assert.equal(d.vatCaptureSnapshotJson.source.vatAmount, '9');
    const missingCarrier = certificateHarness(() => h(ToastContext.Provider, { value: { success: noop, error: noop, warning: noop } }, h(ExpenseReviewEditSection, { companyId: 'co', detail: { ...d, lines: [{ ...d.lines[0], vatRate: '0' }] }, isMutable: true, canReview: true, canConfirm: true, onSaved: async () => {} })));
    assert.match(missingCarrier.render(), /ยังเลือก “ใช้ยอดตามเอกสาร” ไม่ได้ เพราะไม่มีรายการไหนมี VAT/);
    assert.doesNotMatch(missingCarrier.render(), /รายการที่รับส่วนต่าง VAT/);
  } finally { view.cleanup(); capture.mock.restore(); }
});

test('PWS-CERTIFICATE names the paper plainly and lower packs retain only external recording', () => {
  const { ExpenseCertificateReopen } = require('./ExpenseCertificateReopen');
  const { WHT_CERTIFICATE_CORRECTION_WORDS, TIER_FEATURE_PRESETS } = require('@watchdog-bms/contracts');
  const { shopHasSystemWhtCertificates } = require('./expense-wht-certificates.logic');
  for (const kind of ['SYSTEM', 'EXTERNAL']) {
    const html = renderToStaticMarkup(h(ExpenseCertificateReopen, { certificate: { kind, number: 'WHT-1' }, busy: false,
      children: (_attested: boolean, notice: React.ReactNode, _footer: unknown, attestation: React.ReactNode) => h('div', null, notice, attestation) }));
    assert.match(html, /หนังสือรับรอง 50 ทวิ/);
    assert.match(html, /WHT-1/);
    assert.match(html, /ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้/);
    if (kind === 'EXTERNAL') assert.match(html, /ระบบยกเลิกใบที่ทำนอกระบบให้ไม่ได้ ร้านต้องยกเลิกเอง/);
  }
  assert.equal(WHT_CERTIFICATE_CORRECTION_WORDS.fieldLocked, 'แก้ยอด อัตรา รายการที่จ่าย หรือเลขผู้เสียภาษีที่รายจ่ายด้วย “แก้ไขเอกสาร”');
  const handoff = { id: 'handoff', status: 'REQUIRED', systemIssuanceOpen: true, missing: [], payerMissing: [], payeeAddress: 'ที่อยู่',
    prefill: { formType: 'PND53', incomeCategoryCode: '01', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '100', withheldAmount: '3', payeeSnapshot: { name: 'ผู้รับ', address: 'ที่อยู่' } } };
  const { certificateHarness } = require('./expense-certificate-test-harness');
  const { ExpenseCertificateCard } = require('./ExpenseCertificateCard');
  for (const tier of ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999']) {
    const available = shopHasSystemWhtCertificates(TIER_FEATURE_PRESETS[tier]);
    assert.equal(available, tier === 'ENTERPRISE_1999', tier);
    const view = certificateHarness(() => h(ToastContext.Provider, { value: { success: noop, error: noop } as any }, h(ExpenseCertificateCard, {
      companyId: 'co', expenseId: 'e1', handoff, permissions: ['wht.certificate.issue', 'wht.external_certificate.link'], systemCertificatesAvailable: available,
      issueButton: h('button', null, 'ออกหนังสือรับรอง 50 ทวิ'), busy: false, onChanged: noop, onDownload: noop,
    })), [{ row: handoff, loading: false, error: null }]);
    try {
      const html = view.render();
      assert.equal(html.includes('>ออกหนังสือรับรอง 50 ทวิ</button>'), available, tier);
      assert.match(html, /จดเลขที่ใบ 50 ทวิ/);
    } finally { view.cleanup(); }
  }
});
