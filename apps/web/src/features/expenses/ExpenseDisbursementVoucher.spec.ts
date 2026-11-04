import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { expenseDisbursementReservationMessage } from '@watchdog-bms/contracts';
(globalThis as any).React = React;
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (m) => { m.exports = () => null; };
const modals = { ...require('@/common/components/modal/Modal') };
require.cache[require.resolve('@/common/components/modal/Modal')]!.exports = modals;
const api = { ...require('./disbursement-vouchers/disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers/disbursement-vouchers.api')]!.exports = api;
const child = require('./ExpenseDisbursementVoucher');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const h = React.createElement;
const noop = () => {};
const reservation = { voucherId: 'voucher/one', documentNumber: 'DV-1', preparerName: 'สมชาย', viewerCanPay: true };
const detail = { id: 'expense/one', status: 'CONFIRMED', outstandingAmount: '100', correctionCapabilities: { disbursementReservation: null } };
function render(node: React.ReactNode) {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push: noop } as any }, h(ToastContext.Provider, { value: { success: noop, warning: noop, error: noop } }, node)));
}
test('the reservation names the preparer when known and keeps existing pending work reachable', () => {
  const notice = (value: any) => render(h(child.ExpenseDisbursementReservation, { companyId: 'shop', reservation: value }));
  assert.equal(notice(null), '');
  assert.match(notice(reservation), /อยู่ในใบเตรียมจ่ายเลขที่ <span class="whitespace-nowrap">DV-1<\/span>.*จัดทำโดย สมชาย/);
  assert.match(notice(reservation), /href="\/companies\/shop\/expenses\/disbursement-vouchers\/voucher%2Fone"/);
  assert.doesNotMatch(notice({ ...reservation, preparerName: null }), /จัดทำโดย/);
  assert.doesNotMatch(notice({ ...reservation, voucherId: null }), /<a /);
  assert.ok(notice({ ...reservation, documentNumber: null }).includes('รายการนี้ถูกจองไว้ในใบเตรียมจ่าย'));
  assert.equal(render(h(child.ExpenseDisbursementDirectPayment, { reservation }, 'direct payment form')), '');
  assert.equal(render(h(child.ExpenseDisbursementDirectPayment, { reservation: null }, 'direct payment form')), 'direct payment form');
});
test('reserved void uses its own server sentence and hides both reason input and command', () => {
  const html = render(h(child.ExpenseDisbursementVoidBlocker, { reservation, onClose: noop }, h('button', null, 'confirm void')));
  assert.ok(html.includes(expenseDisbursementReservationMessage('void', 'DV-1', 'สมชาย').replaceAll('"', '&quot;')));
  assert.doesNotMatch(html, /confirm void/);
  assert.match(html, /ปิด/);
});
test('prepare is a secondary link with the expense selected and disappears when rights or the menu are missing', () => {
  const node = (permissions: string[], entryOpen: boolean) => h(child.ExpenseDisbursementPrepareEntry, { companyId: 'shop', detail, permissions, entryOpen });
  assert.equal(render(node([], true)), ''); assert.equal(render(node(['expense.disbursement.prepare'], false)), '');
  const html = render(node(['expense.disbursement.prepare'], true));
  assert.match(html, /new\?expenseId=expense%2Fone/); assert.match(html, /รวมกับบิลอื่น หรือให้คนอื่นอนุมัติก่อนจ่าย → ใบเตรียมจ่าย/);
  assert.doesNotMatch(html, /รวมหลายรายการ หรือรออนุมัติก่อนจ่าย/);
});
test('payment rows show one eligible action only inside the payment card, with a non-openable document as text', () => {
  const payment = { id: 'payment', status: 'RECORDED', canIssueDisbursementVoucher: true, disbursementVoucher: null };
  const node = (p = payment, permissions = ['expense.disbursement.issue'], entryOpen = true) => h(child.ExpenseDisbursementPaymentEntry, { companyId: 'shop', expenseId: 'expense', payment: p, permissions, entryOpen });
  const inCard = (n: React.ReactNode) => h(child.ExpenseDisbursementPaymentScope, null, n);
  assert.equal(render(node()), '');
  assert.match(render(inCard(node())), /ออกใบสำคัญจ่าย/);
  assert.equal(render(inCard(node(payment, [], true))), '');
  assert.equal(render(inCard(node(payment, ['expense.disbursement.issue'], false))), '');
  const linked: any = { ...payment, disbursementVoucher: { id: 'doc', documentNumber: 'DV-1' } };
  assert.match(render(inCard(node(linked, ['expense.disbursement.read']))), /ดูใบสำคัญจ่าย/);
  assert.match(render(inCard(node(linked, ['expense.disbursement.read'], false))), /ดูใบสำคัญจ่าย/);
  for (const [id, permissions, entryOpen] of [[null, ['expense.disbursement.read'], true], ['doc', [], true], [null, ['expense.disbursement.read'], false]] as const) {
    const html = render(inCard(node({ ...linked, disbursementVoucher: { ...linked.disbursementVoucher, id } }, [...permissions], entryOpen)));
    assert.match(html, /อยู่ในใบสำคัญจ่ายเลขที่ <span class="whitespace-nowrap">DV-1<\/span>/); assert.doesNotMatch(html, /<a /);
  }
});
test('the issue confirmation keeps a server refusal inside its dialog and reuses the command after a lost answer', async () => {
  const runtime = require('react');
  const state: any[] = [true, false, null];
  const refs: any[] = [{ current: false }, { current: null }];
  const nodes: any[] = []; const bodies: any[] = [];
  const realState = runtime.useState, realRef = runtime.useRef, realCreate = runtime.createElement;
  const modal = mock.method(modals, 'Modal', ({ open, title, children, footer }: any) => open ? h('section', { 'data-dialog': true }, h('h2', null, title), children, footer) : null);
  const post = mock.method(api, 'issueDisbursementVoucherFromPayment', async (_company: string, body: any) => {
    bodies.push(body); throw { status: 409, code: 'disbursement_source_changed', message: 'รายจ่ายเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง' };
  });
  function draw() {
    let i = 0, r = 0; nodes.length = 0;
    runtime.useState = (init: any) => { const pair = realState(init), index = i++; return index < 3 ? [state[index], (value: any) => { state[index] = value; }] : pair; };
    runtime.useRef = (value: any) => { const real = realRef(value), index = r++; return index < 2 ? refs[index] : real; };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'button') nodes.push({ ...props, children }); return realCreate(tag, props, ...children); };
    try { return render(h(child.ExpenseDisbursementPaymentScope, null, h(child.ExpenseDisbursementPaymentEntry, { companyId: 'shop', expenseId: 'expense', payment: { id: 'payment', amount: '9700', status: 'RECORDED', canIssueDisbursementVoucher: true }, permissions: ['expense.disbursement.issue'], entryOpen: true }))); }
    finally { runtime.useState = realState; runtime.useRef = realRef; runtime.createElement = realCreate; }
  }
  try {
    let html = draw();
    // The question names the payment by its amount; the body is the one consequence.
    assert.match(html, /<h2>ออกใบสำคัญจ่ายสำหรับการจ่าย 9,700.00 บาท\?<\/h2>/); assert.match(html, /ระบบจะออกเลขที่ใบให้ทันที/);
    for (let attempt = 0; attempt < 2; attempt++) {
      nodes.findLast(node => node.children.includes('ออกใบสำคัญจ่าย')).onClick();
      await new Promise(resolve => setImmediate(resolve)); html = draw();
      assert.equal(html.split('รายจ่ายเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง').length - 1, 1);
      assert.ok(html.indexOf('data-dialog') < html.indexOf('รายจ่ายเปลี่ยนไปแล้ว'));
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(bodies[0].expenseId, 'expense'); assert.equal(bodies[0].paymentId, 'payment');
  } finally { modal.mock.restore(); post.mock.restore(); }
});
test('the pinned page adds child components and preserves the primary payment and existing reopen blocker flow', () => {
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.equal(page.split('<ExpenseDisbursementPaymentScope>').length - 1, 1);
  assert.match(page, /<ExpenseDisbursementDirectPayment reservation=\{detail.correctionCapabilities\?\.disbursementReservation\}/);
  // A free-drafts shop gets no prepare-payment entry (049aa51de), so the entry sits behind that gate.
  assert.match(page, /<\/ExpenseDisbursementDirectPayment>\s*\{!freeExpenseDrafts && <ExpenseDisbursementPrepareEntry/);
  assert.match(page, /expenseReopenBlockerMessages/);
});

test('a reserved payment says the notice once and gives only the server next step for this viewer', () => {
  for (const viewerMay of ['act', 'open', 'none']) {
    const html = render(h(child.ExpenseDisbursementReservation, { companyId: 'shop', reservation: { ...reservation, viewerMay, viewerCanPay: viewerMay === 'act' } }));
    assert.equal(html.split('ใบเตรียมจ่ายเลขที่ <span class="whitespace-nowrap">DV-1</span>').length - 1, 1);
    assert.equal(html.includes('href='), viewerMay !== 'none');
    if (viewerMay === 'act') assert.match(html, /ให้บันทึกจ่ายจากใบนั้น/);
    if (viewerMay === 'open') assert.match(html, /ให้ผู้จัดทำหรือผู้อนุมัติของใบนั้นกด/);
    if (viewerMay === 'none') { assert.match(html, /ให้ติดต่อผู้จัดทำใบนั้น/); assert.doesNotMatch(html, /กลับไปแก้|เปิดใบ/); }
  }
});
test('the reservation follows the separate payment right without asking a preparer to pay', () => {
  const html = render(h(child.ExpenseDisbursementReservation, { companyId: 'shop', reservation: { ...reservation, viewerMay: 'act', viewerCanPay: false } }));
  assert.match(html, /ให้ผู้มีสิทธิ์บันทึกจ่ายบันทึกจากใบนั้น/);
  assert.doesNotMatch(html, /<p>ให้บันทึกจ่ายจากใบนั้น/);
  const payer = render(h(child.ExpenseDisbursementReservation, { companyId: 'shop', reservation: { ...reservation, viewerMay: 'open', viewerCanPay: true } }));
  assert.match(payer, /ให้บันทึกจ่ายจากใบนั้น/);
});

test('a payment still in effect whose document was cancelled names both ways when the issue button is offered', () => {
  const payment = { id: 'payment', status: 'RECORDED', canIssueDisbursementVoucher: true,
    cancelledDisbursementVoucher: { id: 'old', documentNumber: 'DV-202610-00001' } };
  const html = render(h(child.ExpenseDisbursementPaymentScope, null, h(child.ExpenseDisbursementPaymentEntry, {
    companyId: 'shop', expenseId: 'expense', payment, permissions: ['expense.disbursement.read', 'expense.disbursement.issue'], entryOpen: true })));
  assert.match(html, />ออกใบสำคัญจ่าย<\/button>/);
  assert.match(html, /ออกใบใหม่เฉพาะการจ่ายนี้ได้ด้วยปุ่ม “ออกใบสำคัญจ่าย” ด้านล่าง หรือออกใบเดียวรวมทุกการจ่ายที่ยังมีผลได้ที่หน้าของใบนั้น/);
  const withoutRight = render(h(child.ExpenseDisbursementPaymentScope, null, h(child.ExpenseDisbursementPaymentEntry, {
    companyId: 'shop', expenseId: 'expense', payment, permissions: ['expense.disbursement.read'], entryOpen: true })));
  assert.doesNotMatch(withoutRight, />ออกใบสำคัญจ่าย<\/button>/);
  assert.match(withoutRight, /ออกใบใหม่สำหรับการจ่ายที่ยังมีผลได้ที่หน้าของใบนั้น/);
  assert.doesNotMatch(html, /\{button\}|\{number\}/);
});

test('cancelled coverage stays in the payment card with an unbroken number and a readable link, including hidden menus', () => {
  for (const status of ['VOIDED', 'RECORDED']) for (const entryOpen of [false, true]) {
    const payment = { id: 'payment', status, canIssueDisbursementVoucher: false,
      cancelledDisbursementVoucher: { id: 'old/one', documentNumber: 'DV-202610-00001' } };
    const node = (permissions: string[], id: string | null = 'old/one') => h(child.ExpenseDisbursementPaymentEntry, {
      companyId: 'shop', expenseId: 'expense', payment: { ...payment, cancelledDisbursementVoucher: { ...payment.cancelledDisbursementVoucher, id } }, permissions, entryOpen,
    });
    assert.equal(render(node(['expense.disbursement.read'])), '');
    const inCard = (node: React.ReactNode) => h(child.ExpenseDisbursementPaymentScope, null, node);
    const html = render(inCard(node(['expense.disbursement.read'])));
    assert.match(html, /ใบสำคัญจ่ายเลขที่ <span class="whitespace-nowrap">DV-202610-00001<\/span>/);
    assert.match(html, status === 'VOIDED' ? /ถูกยกเลิกพร้อมการจ่ายนี้/ : /ของการจ่ายนี้ถูกยกเลิกแล้ว ออกใบใหม่สำหรับการจ่ายที่ยังมีผลได้ที่หน้าของใบนั้น/);
    assert.match(html, /href="\/companies\/shop\/expenses\/disbursement-vouchers\/old%2Fone"/);
    assert.match(html, />เปิดใบ<\/a>/);
    for (const [permissions, id] of [[[], 'old/one'], [['expense.disbursement.read'], null]] as const) {
      const masked = render(inCard(node([...permissions], id)));
      assert.match(masked, /DV-202610-00001/); assert.doesNotMatch(masked, /<a /);
    }
  }
});
test('a current voucher wins over cancelled coverage; older answers and issuance behave as before', () => {
  const renderPayment = (payment: any) => render(h(child.ExpenseDisbursementPaymentScope, null,
    h(child.ExpenseDisbursementPaymentEntry, { companyId: 'shop', expenseId: 'expense', payment,
      permissions: ['expense.disbursement.read', 'expense.disbursement.issue'], entryOpen: true })));
  const base = { id: 'payment', status: 'RECORDED', canIssueDisbursementVoucher: false };
  assert.equal(renderPayment(base), '');
  const cancelled = { ...base, cancelledDisbursementVoucher: { id: 'old', documentNumber: 'DV-OLD' } };
  const current = renderPayment({ ...cancelled, disbursementVoucher: { id: 'new', documentNumber: 'DV-NEW' } });
  assert.match(current, /disbursement-vouchers\/new/); assert.doesNotMatch(current, /DV-OLD|ถูกยกเลิก/);
  assert.match(renderPayment({ ...cancelled, canIssueDisbursementVoucher: true }), /ออกใบสำคัญจ่าย/);
});

test('reserved refusals have a readable document exit, and void makes opening it primary after closing', () => {
  for (const viewerMay of ['act', 'read', 'none']) for (const voucherId of ['voucher/one', null]) {
    const value = { ...reservation, viewerMay, voucherId };
    const link = render(h(child.ExpenseDisbursementOpenLink, { companyId: 'shop', reservation: value }));
    const allowed = viewerMay !== 'none' && Boolean(voucherId);
    assert.equal(link.includes('เปิดใบ'), allowed);
    if (allowed) assert.match(link, /disbursement-vouchers\/voucher%2Fone/);
    const body = render(h(child.ExpenseDisbursementVoidBlocker, { companyId: 'shop', reservation: value, onClose: noop }, 'unavailable command'));
    assert.equal(body.includes('เปิดใบ'), allowed); assert.doesNotMatch(body, /unavailable command/);
    if (allowed) { assert.ok(body.indexOf('>ปิด<') < body.indexOf('>เปิดใบ<')); assert.match(body, /class="mangmee-btn mangmee-btn-primary/); }
  }
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /!detail.correctionCapabilities\?\.canReopen && <ExpenseDisbursementOpenLink companyId=\{companyId\}/);
});

const prepareLabel = 'รวมกับบิลอื่น หรือให้คนอื่นอนุมัติก่อนจ่าย → ใบเตรียมจ่าย';
function prepareHarness(permissions: string[], canRecordPayment = true, entryOpen = true) {
  const runtime = require('react');
  let state: any = null, ref = { current: null as any }, cleanup: (() => void) | undefined;
  const draw = () => {
    const originalState = runtime.useState, originalRef = runtime.useRef, originalEffect = runtime.useEffect;
    let s = 0, r = 0, e = 0, effect: any;
    runtime.useState = (init: any) => { const pair = originalState(init); return s++ === 0 ? [state, (next: any) => { state = next; }] : pair; };
    runtime.useRef = (init: any) => { const value = originalRef(init); return r++ === 0 ? ref : value; };
    runtime.useEffect = (fn: any, deps: any) => { if (e++ === 0) effect = fn; originalEffect(fn, deps); };
    let html: string;
    try { html = render(h(child.ExpenseDisbursementPrepareEntry, { companyId: 'shop', detail, permissions, entryOpen, canRecordPayment }, canRecordPayment ? h('button', { className: 'mangmee-btn mangmee-btn-primary' }, 'บันทึกจ่าย') : null)); }
    finally { runtime.useState = originalState; runtime.useRef = originalRef; runtime.useEffect = originalEffect; }
    cleanup?.(); cleanup = effect?.();
    return html!;
  };
  return { draw, leave: () => cleanup?.() };
}
for (const approve of [false, true]) for (const outcome of ['other', 'alone', 'failed']) test(`PAY-LINK approve=${approve}, payable read=${outcome}`, async () => {
  const rows = [{ expenseId: detail.id, payeeKey: 'payee', selectable: true },
    { expenseId: 'different-payee', payeeKey: 'different', selectable: true },
    { expenseId: 'reserved', payeeKey: 'payee', selectable: false, reservation: { voucherId: 'draft' } },
    ...(outcome === 'other' ? [{ expenseId: 'other', payeeKey: 'payee', selectable: true, reservation: null }] : [])];
  const read = mock.method(api, 'listDisbursementPayableExpenses', async (...args: any[]) => {
    assert.deepEqual(args, ['shop', {}, { suppressErrorToast: true }]);
    if (outcome === 'failed') throw new Error('offline'); return rows;
  });
  const screen = prepareHarness(['expense.disbursement.prepare', ...(approve ? ['expense.disbursement.approve'] : [])]);
  try {
    screen.draw(); await new Promise(resolve => setImmediate(resolve));
    const html = screen.draw();
    assert.equal(html.includes(prepareLabel), !approve || outcome !== 'alone');
    assert.match(html, />บันทึกจ่าย<\/button>/);
    assert.doesNotMatch(html, /mangmee-btn-secondary|เพิ่มเข้าใบเตรียมจ่าย/);
    if (html.includes(prepareLabel)) assert.ok(html.indexOf('</button>') < html.indexOf(prepareLabel));
    screen.draw(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(read.mock.callCount(), approve ? 1 : 0);
  } finally { screen.leave(); read.mock.restore(); }
});
test('PAY-LINK without direct payment keeps a secondary route even for an approver; unavailable path does not read', () => {
  const read = mock.method(api, 'listDisbursementPayableExpenses', async () => []);
  try {
    const permissions = ['expense.disbursement.prepare', 'expense.disbursement.approve'];
    const html = prepareHarness(permissions, false).draw();
    assert.match(html, /class="mangmee-btn mangmee-btn-secondary/); assert.ok(html.includes(prepareLabel));
    assert.doesNotMatch(html, />บันทึกจ่าย</);
    assert.doesNotMatch(prepareHarness(permissions, true, false).draw(), /ใบเตรียมจ่าย/);
    assert.equal(read.mock.callCount(), 0);
  } finally { read.mock.restore(); }
});

test('PAY-LINK an approver waits for the optional read before offering the quiet route, while direct payment stays available', async () => {
  let answer!: (rows: any[]) => void;
  const read = mock.method(api, 'listDisbursementPayableExpenses', () => new Promise(resolve => { answer = resolve; }));
  const screen = prepareHarness(['expense.disbursement.prepare', 'expense.disbursement.approve']);
  try {
    const pending = screen.draw();
    assert.doesNotMatch(pending, /รวมกับบิลอื่น/); assert.match(pending, />บันทึกจ่าย<\/button>/);
    screen.draw(); assert.equal(read.mock.callCount(), 1);
    answer([{ expenseId: detail.id, payeeKey: 'payee', selectable: true }, { expenseId: 'other', payeeKey: 'payee', selectable: true }]);
    await new Promise(resolve => setImmediate(resolve)); assert.ok(screen.draw().includes(prepareLabel));
  } finally { screen.leave(); read.mock.restore(); }
});
