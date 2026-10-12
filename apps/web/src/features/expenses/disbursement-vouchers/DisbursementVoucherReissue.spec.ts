import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
(globalThis as any).React = React;
const svg = require.extensions['.svg'], css = require.extensions['.css'];
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { section: 'section', stack: 'stack', action: 'action', error: 'error' }; };
const api = { ...require('./disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers.api')]!.exports = api;
const modalPath = require.resolve('@/common/components/modal'), modal = require(modalPath);
require.cache[modalPath]!.exports = { ...modal, Modal: (props: any) => props.open ? h('section', { 'data-dialog': true }, h('h2', null, props.title), props.children, props.footer) : null };
const { DisbursementVoucherReissue } = require('./DisbursementVoucherReissue');
require.cache[modalPath]!.exports = modal;
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
const h = React.createElement;
const noop = () => {};
const cancelled = { header: { id: 'old', status: 'CANCELLED', cancelledAfterPaid: true }, canReissue: true, reissuedVoucher: null, replacesVoucher: null,
  lines: [{ expenseNumber: 'EX-1', expensePaymentId: 'one', paymentInEffect: false }, { expenseNumber: 'EX-2', expensePaymentId: 'two', paymentInEffect: true }] };
function render(detail: any, menu = false, push: (path: string) => void = noop, success: (message: string) => void = noop) {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: { push } as any }, h(ToastContext.Provider, { value: { success, warning: noop, error: () => { throw Error('automatic refusal toast'); } } },
    h(DisbursementVoucherReissue, { companyId: 'shop', detail, children: (button: any, notice: any) => h('div', null, menu && h('aside', null, button()), notice) }))));
}
test('the document shows cancelled-payment states, suppresses ineligible buttons, and links both replacement directions', () => {
  assert.match(render(cancelled), /การจ่ายรายการอื่นยังอยู่ ออกใบใหม่สำหรับการจ่ายที่เหลือได้/);
  assert.match(render(cancelled), />ออกใบใหม่สำหรับการจ่ายที่เหลือ<\/button>/);
  const noRight = render({ ...cancelled, canReissue: false });
  assert.match(noRight, /ผู้มีสิทธิ์ออกใบสำคัญจ่ายออกใบใหม่สำหรับการจ่ายที่เหลือได้/);
  assert.doesNotMatch(noRight, /<button/);
  const none = render({ ...cancelled, lines: [cancelled.lines[0]] });
  assert.match(none, /ไม่มีการจ่ายที่ยังมีผลเหลือในใบนี้/); assert.doesNotMatch(none, /<button/);
  const issued = render({ ...cancelled, reissuedVoucher: { id: 'new/one', documentNumber: 'DV-2' } });
  assert.match(issued, /ออกใบใหม่แทนแล้ว เลขที่ DV-2/); assert.match(issued, /disbursement-vouchers\/new%2Fone/);
  assert.doesNotMatch(issued, /<button/);
  const replacement = { ...cancelled, header: { ...cancelled.header, status: 'PAID' }, replacesVoucher: { id: 'old/one', documentNumber: 'DV-1' }, sourceChangedAfterPaid: true };
  const html = render(replacement);
  assert.match(html, /ออกแทนใบเลขที่ DV-1/); assert.match(html, /disbursement-vouchers\/old%2Fone/);
  assert.match(html, /รายจ่ายในใบนี้ถูกแก้ไขหลังจ่าย ใบสำคัญจ่ายยังแสดงข้อมูล ณ วันที่จ่าย/);
  assert.doesNotMatch(render({ ...replacement, sourceChangedAfterPaid: false }), /รายจ่ายในใบนี้ถูกแก้ไขหลังจ่าย/);
  assert.doesNotMatch(render({ ...cancelled, reissuedVoucher: { id: null, documentNumber: 'DV-2' } }), /<a/);
});
test('banner and menu require confirmation, cancellation sends nothing, and refusal retry shares one busy command id', async () => {
  const runtime = require('react');
  const state: any[] = [false, null, false]; const refs: any[] = [{ current: false }, { current: null }];
  const nodes: any[] = [], bodies: any[] = [], successes: string[] = [], paths: string[] = [];
  const realState = runtime.useState, realRef = runtime.useRef, realCreate = runtime.createElement;
  let finish: (value: any) => void = noop;
  const post = mock.method(api, 'reissueDisbursementVoucher', async (_company: string, _id: string, body: any) => {
    bodies.push(body);
    if (bodies.length === 1) throw { code: 'disbursement_source_changed', status: 409, message: 'รายจ่ายเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง' };
    return new Promise(resolve => { finish = resolve; });
  });
  function draw() {
    let i = 0, r = 0; nodes.length = 0;
    runtime.useState = (init: any) => { const pair = realState(init), index = i++; return index < 3 ? [state[index], (value: any) => { state[index] = value; }] : pair; };
    runtime.useRef = (value: any) => { const real = realRef(value), index = r++; return index < 2 ? refs[index] : real; };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'button') nodes.push({ ...props, children }); return realCreate(tag, props, ...children); };
    try { return render(cancelled, true, path => paths.push(path), message => successes.push(message)); }
    finally { runtime.useState = realState; runtime.useRef = realRef; runtime.createElement = realCreate; }
  }
  try {
    const entries = () => nodes.filter(node => node.children.includes('ออกใบใหม่สำหรับการจ่ายที่เหลือ'));
    const confirm = () => nodes.find(node => node.children.includes('ออกใบใหม่'));
    draw(); assert.equal(entries().length, 2);
    entries()[0].onClick(); assert.equal(bodies.length, 0);
    const question = draw(); assert.match(question, /ออกใบสำคัญจ่ายใบใหม่สำหรับการจ่ายที่ยังมีผล 1 รายการ\? ระบบจะออกเลขที่ใหม่ ใบเดิมยังอยู่ในสถานะยกเลิก/);
    assert.ok(question.indexOf('>ปิด</button>') >= 0 && question.indexOf('>ปิด</button>') < question.indexOf('>ออกใบใหม่</button>'));
    nodes.find(node => node.children.includes('ปิด')).onClick(); assert.doesNotMatch(draw(), /data-dialog/); assert.equal(bodies.length, 0);
    entries()[1].onClick(); draw(); confirm().onClick(); await new Promise(resolve => setImmediate(resolve));
    const refused = draw();
    assert.equal(refused.split('รายจ่ายเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง').length - 1, 1);
    assert.ok(refused.indexOf('data-dialog') < refused.indexOf('รายจ่ายเปลี่ยนไปแล้ว'));
    const retry = confirm(); retry.onClick(); draw();
    assert.ok(nodes.every(node => node.disabled));
    retry.onClick(); assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(Object.keys(bodies[0]), ['commandId']);
    finish({ id: 'new', documentNumber: 'DV-2' }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(paths, ['/companies/shop/expenses/disbursement-vouchers/new']);
    assert.deepEqual(successes, ['ออกใบสำคัญจ่ายเลขที่ DV-2 แล้ว']);
  } finally { post.mock.restore(); }
});
test('the page uses the same reissue component for its notice and more-menu entry', () => {
  const page = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<DisbursementVoucherReissue key=\{id\}/);
  assert.match(page, /action === 'reissue' \? <span key=\{action\}>\{reissueButton\(\)\}/);
  assert.match(page, /\{reissueNotice\}/);
});

test('a cancelled paid banner shows the typed source reason below its first sentence, never the generated reason', () => {
  const detail = { ...cancelled, header: { ...cancelled.header, cancelSourceReason: 'โอนผิดบัญชี', cancelReason: 'การจ่ายของรายการ EX-1 ถูกยกเลิก' } };
  const html = render(detail);
  assert.match(html, /เหตุผล: โอนผิดบัญชี/);
  assert.ok(html.indexOf('ใบนี้ถูกยกเลิกเพราะ') < html.indexOf('เหตุผล: โอนผิดบัญชี'));
  assert.doesNotMatch(html, /เหตุผล: การจ่ายของรายการ/);
  assert.doesNotMatch(render({ ...detail, header: { ...detail.header, cancelSourceReason: null } }), /เหตุผล:/);
  assert.doesNotMatch(render({ ...detail, header: { ...detail.header, status: 'PAID' } }), /เหตุผล:/);
  const reissued = render({ ...detail, reissuedVoucher: { id: 'new', documentNumber: 'DV-2' } });
  assert.ok(reissued.indexOf('ใบนี้ถูกยกเลิกเพราะ') < reissued.indexOf('เหตุผล: โอนผิดบัญชี'));
  assert.ok(reissued.indexOf('เหตุผล: โอนผิดบัญชี') < reissued.indexOf('ออกใบใหม่แทนแล้ว'));
  assert.doesNotMatch(reissued, /ออกใบใหม่สำหรับการจ่ายที่เหลือได้/);
  const source = readFileSync(new URL('./DisbursementVoucherReissue.tsx', import.meta.url), 'utf8');
  assert.match(source, /closeOnBackdrop=\{false\}/); assert.match(source, /<CoverLoader active=\{busy\} scope="modal"/);
  assert.equal((source.match(/w-full sm:w-auto/g) ?? []).length, 2); assert.match(source, /styles.modalFooter/);
});
