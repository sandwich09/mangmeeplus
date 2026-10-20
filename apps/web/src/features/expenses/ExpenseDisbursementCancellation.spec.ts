import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, mock } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
const svg = require.extensions['.svg'];
require.extensions['.svg'] = m => { m.exports = () => null; };
const api = { ...require('./disbursement-vouchers/disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers/disbursement-vouchers.api')]!.exports = api;
const { ExpenseDisbursementCancellation } = require('./ExpenseDisbursementCancellation');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const h = React.createElement;
const payment = { id: 'payment', status: 'RECORDED', disbursementVoucher: { id: 'voucher', documentNumber: 'DV-1' } };

test('the cancellation child reads an openable voucher quietly, warns above the reason and adds the same number to success', async () => {
  const read = mock.method(api, 'getDisbursementVoucher', async (company: string, id: string, options: any) => {
    assert.equal(company, 'shop'); assert.equal(id, 'voucher'); assert.deepEqual(options, { suppressErrorToast: true });
    return { header: { status: 'PAID' }, lines: [{ expenseId: 'expense', expensePaymentId: 'payment', paymentInEffect: true }, { expenseId: 'other', expensePaymentId: 'other-payment', paymentInEffect: true }] };
  });
  const runtime = require('react'), realState = runtime.useState, realEffect = runtime.useEffect;
  const states: any[] = [{}, true]; let started = false, cleanup: any, successMessage: any;
  const draw = () => {
    let index = 0;
    runtime.useState = (init: any) => { const pair = realState(init), i = index++; return i < 2 ? [states[i], (value: any) => { states[i] = value; }] : pair; };
    runtime.useEffect = (effect: any, deps: any) => { if (!started) { started = true; cleanup = effect(); } else realEffect(effect, deps); };
    try { return renderToStaticMarkup(h(ExpenseDisbursementCancellation, { companyId: 'shop', expenseId: 'expense', paymentId: 'payment', payments: [payment],
      children: (warning: React.ReactNode, message: any) => { successMessage = message; return h('section', null, warning, h('label', null, 'เหตุผล')); } })); }
    finally { runtime.useState = realState; runtime.useEffect = realEffect; }
  };
  try {
    draw(); await new Promise(resolve => setImmediate(resolve)); const html = draw();
    // The window's title already says "ยกเลิกรายการจ่ายนี้": the sentence under it says only the consequence.
    assert.match(html, /<p>ใบสำคัญจ่ายเลขที่ DV-1 จะถูกยกเลิกด้วย<\/p>/); assert.doesNotMatch(html, /ยกเลิกรายการจ่ายนี้ แล้ว/);
    assert.doesNotMatch(html, /การจ่ายรายการอื่นในใบยังอยู่/); assert.ok(html.indexOf('จะถูกยกเลิกด้วย') < html.indexOf('เหตุผล'));
    assert.equal(successMessage('ยกเลิกรายการจ่ายแล้ว'), 'ยกเลิกรายการจ่ายแล้ว ใบสำคัญจ่ายเลขที่ DV-1 ถูกยกเลิกด้วย');
    draw(); assert.equal(read.mock.callCount(), 1);
    states[0].voucher.header.status = 'CANCELLED'; assert.doesNotMatch(draw(), /ถ้ายกเลิก/);
    assert.equal(successMessage('ยกเลิกรายการจ่ายแล้ว'), 'ยกเลิกรายการจ่ายแล้ว');
  } finally { cleanup?.(); read.mock.restore(); }
});

test('a non-openable voucher gets the short warning without an unauthorized detail request', () => {
  const read = mock.method(api, 'getDisbursementVoucher', async () => { throw new Error('unexpected read'); });
  try {
    const html = renderToStaticMarkup(h(ExpenseDisbursementCancellation, { companyId: 'shop', expenseId: 'expense', payments: [{ ...payment, disbursementVoucher: { id: null, documentNumber: 'DV-1' } }], children: (warning: React.ReactNode) => warning }));
    assert.match(html, /รายการจ่ายและใบสำคัญจ่ายเลขที่ DV-1 จะถูกยกเลิกด้วย/); assert.doesNotMatch(html, /ยกเลิกรายการจ่ายนี้/); assert.doesNotMatch(html, /การจ่ายรายการอื่น/); assert.equal(read.mock.callCount(), 0);
  } finally { read.mock.restore(); }
});

test('all expense cancellation paths add children above the existing reason without new page state', () => {
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  const certificate = readFileSync(new URL('./ExpenseCertificateVoidDialog.tsx', import.meta.url), 'utf8');
  assert.match(page, /ExpenseDisbursementCancellation[^\n]*payments=\{detail.payments\}[\s\S]*?\{warning\}[\s\S]*?expenses.void_reason/);
  assert.match(page, /payments=\{correctionAction\?\.paymentId \? detail.payments : \[\]\}/);
  assert.match(page, /\{warning\}[\s\S]*?expense-correction-reason/);
  assert.match(page, /successMessage\('ยกเลิกเอกสารแล้ว'\)/);
  assert.match(page, /toast.success\(successMessage\(paymentId \? EXPENSE_CORRECTION_WORDS.paymentCancelled/);
  assert.match(certificate, /\{warning\}\s+<label[^\n]*expenses.void_reason/);
  assert.match(certificate, /toast.success\(successMessage\(expenseCertificateVoidedMessage/);
  assert.doesNotMatch(page, /const \[.*[Vv]oucher.*\] = useState/);
});


for (const kind of ['SYSTEM', 'EXTERNAL']) for (const number of ['WT-1', null]) for (const withVoucher of [false, true]) {
  test(`payment cancellation keeps the ${kind} certificate ${number ? 'numbered' : 'without a number'} ${withVoucher ? 'beside the voucher warning' : 'without a voucher'}`, () => {
    const certificate = { kind, number, date: null, canCancel: false };
    const payments = [{ ...payment, disbursementVoucher: withVoucher ? { id: null, documentNumber: 'DV-1' } : null }];
    const render = (paymentId?: string) => renderToStaticMarkup(h(ExpenseDisbursementCancellation, {
      companyId: 'shop', expenseId: 'expense', paymentId, payments, certificate,
      children: (warning: React.ReactNode) => h('section', null, warning, h('label', null, 'เหตุผล')),
    }));
    const expected = (kind === 'SYSTEM' ? 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)' : 'การบันทึกหนังสือรับรองที่ทำนอกระบบ')
      + (number ? (kind === 'SYSTEM' ? ' เลขที่ ' : 'เลขที่ ') + number : '')
      + ' ของเอกสารนี้ยังอยู่ การยกเลิกการจ่ายไม่ยกเลิกหนังสือรับรอง';
    const html = render('payment');
    assert.ok(html.includes(expected), html);
    assert.ok(html.indexOf(expected) < html.indexOf('เหตุผล'));
    assert.equal(html.includes('จะถูกยกเลิกด้วย'), withVoucher);
    assert.doesNotMatch(render(), /การยกเลิกการจ่ายไม่ยกเลิกหนังสือรับรอง/);
  });
}

test('the payment cancellation dialog passes the expense certificate to its child', () => {
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /ExpenseDisbursementCancellation[^\n]*paymentId=\{correctionAction\?\.paymentId\}[^\n]*certificate=\{detail.correctionCapabilities\?\.certificateOnExpense\}/);
});

test('payment cancellation without a certificate does not invent a certificate warning', () => {
  const html = renderToStaticMarkup(h(ExpenseDisbursementCancellation, { companyId: 'shop', expenseId: 'expense', paymentId: 'payment', payments: [{ ...payment, disbursementVoucher: null }], children: (warning: React.ReactNode) => warning }));
  assert.doesNotMatch(html, /หนังสือรับรอง/);
});
