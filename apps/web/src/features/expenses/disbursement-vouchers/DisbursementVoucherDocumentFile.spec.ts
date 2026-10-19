import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastContext } from '@/common/components/toast/use-toast';
(globalThis as any).React = React;
const svg = require.extensions['.svg'], css = require.extensions['.css'];
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { section: 'section', stack: 'stack', action: 'action', error: 'error', journeyBar: 'journeyBar', journeyBarInner: 'journeyBarInner' }; };
const api = { ...require('./disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers.api')]!.exports = api;
const { DisbursementVoucherDocumentFile } = require('./DisbursementVoucherDocumentFile');
const modalPath = require.resolve('@/common/components/modal'), modal = require(modalPath);
require.cache[modalPath]!.exports = { ...modal, Modal: (props: any) => props.open ? React.createElement('div', {}, props.title, props.children, props.footer) : null };
const { DisbursementVoucherPayCard } = require('./DisbursementVoucherPayCard');
require.cache[modalPath]!.exports = modal;
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
const h = React.createElement;
const header = { id: 'doc', documentNumber: 'DV-1', revision: 1, status: 'PAID', cancelledAfterPaid: false };
const render = (value = header, primary = true) => renderToStaticMarkup(h(DisbursementVoucherDocumentFile, { companyId: 'shop', header: value, primary }));
test('file buttons distinguish preparation, paid primary and cancelled-paid secondary without blocking pending files', () => {
  assert.match(render(), /journeyBar/); assert.match(render(), />ดาวน์โหลดใบสำคัญจ่าย<\/button>/);
  assert.match(render({ ...header, status: 'APPROVED' }, false), />พิมพ์ใบเตรียมจ่าย<\/button>/);
  assert.equal(render({ ...header, status: 'DRAFT', documentNumber: null as any, revision: 0 }), '');
  const cancelled = render({ ...header, status: 'CANCELLED', cancelledAfterPaid: true }, false);
  assert.match(cancelled, /ดาวน์โหลดใบ \(ยกเลิกแล้ว\)/);
  assert.match(render({ ...header, status: 'CANCELLED' }, false), /พิมพ์ใบ \(ยกเลิกแล้ว\)/); assert.doesNotMatch(cancelled, /journeyBar/);
  assert.doesNotMatch(render({ ...header, documentFileReady: false } as any), / disabled=/);
});
test('the new paid primary respects the page guard after a successful confirmation', () => {
  const html = renderToStaticMarkup(h(DisbursementVoucherDocumentFile, { companyId: 'shop', header, primary: true, actionBlocked: true }));
  assert.match(html, /disabled="" aria-busy="true"/);
  const source = readFileSync(new URL('./DisbursementVoucherDocumentFile.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(inFlight.current \|\| actionBlocked/);
});
test('download refusal stays beside the button once, retry remains possible, and a busy download cannot repeat', async () => {
  const runtime = require('react'), realState = runtime.useState, realRef = runtime.useRef, realCreate = runtime.createElement;
  const state: any[] = [false, null], ref = { current: false }, nodes: any[] = [];
  let calls = 0, finish: () => void = () => {};
  const download = mock.method(api, 'downloadDisbursementVoucherDocument', async (company: string, id: string, number: string) => {
    assert.equal(company, 'shop'); assert.equal(id, 'doc'); assert.equal(number, 'DV-1'); calls++;
    if (calls === 1) throw { code: 'disbursement_file_unavailable', message: 'ยังจัดทำไฟล์ไม่สำเร็จ กรุณาลองดาวน์โหลดอีกครั้ง' };
    await new Promise<void>(resolve => { finish = resolve; });
  });
  function draw() {
    let i = 0; nodes.length = 0;
    runtime.useState = (init: any) => { const pair = realState(init), index = i++; return index < 2 ? [state[index], (value: any) => { state[index] = value; }] : pair; };
    runtime.useRef = (value: any) => { realRef(value); return ref; };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'button') nodes.push(props); return realCreate(tag, props, ...children); };
    try { return render(); }
    finally { runtime.useState = realState; runtime.useRef = realRef; runtime.createElement = realCreate; }
  }
  try {
    draw(); nodes[0].onClick(); await new Promise(resolve => setImmediate(resolve));
    const html = draw(); assert.equal(html.split('ยังจัดทำไฟล์ไม่สำเร็จ กรุณาลองดาวน์โหลดอีกครั้ง').length - 1, 1);
    assert.match(html, /role="alert"/); assert.equal(nodes[0].disabled, false);
    nodes[0].onClick(); draw(); assert.equal(nodes[0].disabled, true); assert.equal(nodes[0]['aria-busy'], true);
    nodes[0].onClick(); assert.equal(calls, 2);
    finish(); await new Promise(resolve => setImmediate(resolve)); assert.doesNotMatch(draw(), /role="alert"/);
  } finally { download.mock.restore(); }
});
test('a successful pay answer with a pending file uses the exact pending toast and rereads only once', async () => {
  const runtime = require('react'), realState = runtime.useState, realRef = runtime.useRef, realCreate = runtime.createElement;
  const state: any[] = [undefined, null, false, false, true], refs: any[] = Array.from({ length: 6 }, () => ({ current: null }));
  refs[3].current = false;
  const forms: any[] = [], buttons: any[] = [], messages: string[] = [];
  let requests = 0, reads = 0;
  const pay = mock.method(api, 'payDisbursementVoucher', async () => { requests++; return { id: 'doc', documentNumber: 'DV-1', documentFileReady: false }; });
  const detail = { header: { ...header, status: 'APPROVED', plannedMethod: 'CASH', version: 1, totalAmount: '100.00', payeeName: 'ร้าน ก' },
    actions: { pay: true }, lines: [] };
  function draw() {
    let i = 0, r = 0; forms.length = 0; buttons.length = 0;
    runtime.useState = (init: any) => { const pair = realState(init), index = i++; if (index >= 5) return pair; if (state[index] === undefined) state[index] = pair[0]; return [state[index], (value: any) => { state[index] = value; }]; };
    runtime.useRef = (value: any) => { const real = realRef(value), index = r++; return index < 6 ? refs[index] : real; };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { if (tag === 'form') forms.push(props); if (tag === 'button') buttons.push({ ...props, children }); return realCreate(tag, props, ...children); };
    try { return renderToStaticMarkup(h(ToastContext.Provider, { value: { success: message => { messages.push(message); }, warning: () => {}, error: () => { throw Error('automatic toast'); } } },
      h(DisbursementVoucherPayCard, { companyId: 'shop', detail, onReload: async () => { reads++; } }))); }
    finally { runtime.useState = realState; runtime.useRef = realRef; runtime.createElement = realCreate; }
  }
  try {
    draw(); forms[0].onSubmit({ preventDefault: () => {} }); draw();
    assert.equal(requests, 0);
    buttons.find(button => button.children.includes('ยืนยัน จ่ายแล้ว 100.00 บาท')).onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 1); assert.equal(reads, 1); assert.deepEqual(messages, ['บันทึกจ่ายแล้ว เอกสารกำลังจัดทำ']);
  } finally { pay.mock.restore(); }
});
test('document placement keeps paid download primary, cancelled-paid download plain and print in MoreActions', () => {
  const page = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /action === 'print' \? <DisbursementVoucherDocumentFile/);
  assert.match(page, /primary=\{header.status === 'PAID'\}/);
  assert.match(page, /header.status === 'CANCELLED' && header.cancelledAfterPaid/);
  const button = readFileSync(new URL('./DisbursementVoucherDocumentFile.tsx', import.meta.url), 'utf8');
  assert.equal((button.match(/apiErrorMessage\(error\)/g) ?? []).length, 1);
  assert.doesNotMatch(button, /toast\.error|documentFileReady/);
  assert.doesNotMatch(page + button, /h[-]screen|100v[h]/);
});
