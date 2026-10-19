import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BillingAdjustments, BillingInvoiceItem } from '@watchdog-bms/contracts';
(globalThis as any).React = React;
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
const { default: BillingAdjustmentsPage } = require('./BillingAdjustmentsPage');
const { BillingWorkspaceContext } = require('./BillingCustomerFrame');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const runtime = require('react');
const invoice: BillingInvoiceItem = { id: 'invoice', number: 'PAY-001', currency: 'THB', amountSatang: 49900,
  offer: { key: 'BASIC_499', label: 'เติบโต', interval: 'month' }, method: 'CARD', refundedSatang: 0, disputed: false,
  financialObservedAt: null, paymentState: 'paid', applyState: 'APPLIED', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z',
  paidAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', hasDocuments: true };
function render(patch: Partial<BillingInvoiceItem> = {}, items: BillingAdjustments['items'] = [], other: BillingAdjustments['items'] = [], onStateChange: (index: number, value: any) => void = () => {}, states: Record<number, any> = {}) {
  const data: BillingAdjustments = { invoiceId: invoice.id, invoiceNumber: invoice.number, invoice: { ...invoice, ...patch }, kind: 'refunds', mode: 'TEST',
    items, nextCursor: null, observedAt: invoice.createdAt, canOpenDocuments: true, documentActions: { canResend: true }, recipientEmail: 'docs@example.com' };
  const original = runtime.useState, create = runtime.createElement;
  let index = 0;
  const buttons: any[] = [];
  Reflect.set(runtime, 'useState', (initial: any) => {
    const current = index++; const [value] = original(initial);
    return [current in states ? states[current] : current === 3 ? data : current === 4 ? false : current === 7 ? { ...data, items: other } : value, (next: any) => onStateChange(current, next)];
  });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'button') buttons.push({ ...props, children });
    return create(type, props, ...children);
  });
  try { return { html: renderToStaticMarkup(React.createElement(BillingWorkspaceContext.Provider, { value: true },
    React.createElement(BillingAdjustmentsPage, { companyId: 'shop', invoiceId: 'invoice' }))), buttons }; }
  finally { Reflect.set(runtime, 'useState', original); Reflect.set(runtime, 'createElement', create); }
}
test('PAY-MENU payment facts, one equal document group and PDF invoice; no empty refunds', () => {
  const { html, buttons } = render();
  for (const text of ['เติบโต · 1 ต.ค. 2569', 'ยอดที่จ่าย', '499.00', 'บาท', 'จ่ายแล้ว', 'ใช้ได้', 'วันที่จ่าย', 'จ่ายด้วย', 'บัตร', 'เลขที่', 'PAY-001', 'กลับไปแพ็กเกจ', 'docs@example.com', 'แก้อีเมลรับเอกสาร']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/class="mangmee-actions"/g) ?? []).length, 1);
  assert.match(html, /mangmee-flat/); assert.doesNotMatch(html, /mangmee-eyebrow|mangmee-page-description|฿|ประวัติคืนเงิน|คืนเงินและเอกสารปรับยอด|ไฟล์ PDF ใบแจ้งหนี้/);
  const docs = buttons.filter(b => ['ใบเสร็จรับเงิน', 'ใบแจ้งหนี้', 'ส่งอีเมลอีกครั้ง'].includes(b.children.join('')));
  assert.equal(docs.length, 3); assert.equal(new Set(docs.map(b => b.className)).size, 1);
  assert.ok(docs.every(b => b.disabled === b['aria-busy']));
  assert.match(String(docs.find(b => b.children.join('') === 'ใบแจ้งหนี้').onClick), /open\(["']pdf["']\)/);
});

for (const scenario of ['receipt', 'pdf', 'unsafe', 'failed', 'blocked'] as const) test(`UAT-Q2 provider document opens in an isolated tab and keeps the payment page: ${scenario}`, async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalFetch = globalThis.fetch;
  const events: string[] = [], navigated: string[] = [], updates: any[] = [];
  const tab = { opener: {} as unknown, location: { replace: (url: string) => navigated.push(url) }, close: () => events.push('close') };
  const providerUrl = scenario === 'unsafe' ? 'https://example.com/document' : `https://invoice.stripe.com/${scenario}`;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    open: (url: string, target: string) => { assert.equal(url, 'about:blank'); assert.equal(target, '_blank'); events.push('open'); return scenario === 'blocked' ? null : tab; },
    location: { assign: () => events.push('left-app') },
  } });
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    assert.equal(tab.opener, null, 'detach opener before reading the document URL');
    events.push('read'); assert.equal(JSON.parse(init.body as string).kind, scenario === 'pdf' ? 'pdf' : 'receipt');
    return response;
  }) as typeof fetch;
  try {
    const { buttons } = render({}, [], [], (index, value) => { updates[index] = value; });
    buttons.find(button => button.children.join('') === (scenario === 'pdf' ? 'ใบแจ้งหนี้' : 'ใบเสร็จรับเงิน')).onClick();
    assert.deepEqual(events, scenario === 'blocked' ? ['open'] : ['open', 'read'], 'reserve the tab synchronously before awaiting the API');
    assert.deepEqual(navigated, []);
    finish(scenario === 'failed' ? Response.json({}, { status: 503 }) : Response.json({ url: providerUrl }));
    await new Promise(resolve => setImmediate(resolve));
    if (scenario === 'receipt' || scenario === 'pdf') {
      assert.deepEqual(navigated, [providerUrl]); assert.ok(!events.includes('close'));
    } else {
      assert.deepEqual(navigated, []);
      if (scenario === 'blocked') assert.equal(updates[5]?.kind, 'popup');
      else assert.ok(events.includes('close'), 'do not leave a blank tab on an error or unsafe URL');
    }
    assert.ok(!events.includes('left-app'));
    assert.equal(updates[6], false, 'the document buttons stop loading');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
test('PAY-MENU unknown offer and method stay unknown, and paid and refund states follow the item', () => {
  const unknown = render({ offer: null, method: null }).html;
  assert.match(unknown, /การจ่ายเงิน PAY-001/); assert.doesNotMatch(unknown, /จ่ายด้วย|พร้อมเพย์/);
  assert.match(render({ paymentState: 'open' }).html, /รอผล/);
  assert.match(render({ refundedSatang: 49900 }).html, /คืนเงินแล้ว/);
  assert.match(render({ refundedSatang: 10000, method: 'PROMPTPAY' }).html, /คืนบางส่วน/);
  assert.match(render({ method: 'PROMPTPAY' }).html, /พร้อมเพย์/);
});

for (const scenario of ['receipt', 'pdf', 'api-failure'] as const) test(`UAT-Q4 document retry keeps the right recovery action: ${scenario}`, async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalFetch = globalThis.fetch;
  const states: Record<number, any> = {}, navigated: string[] = [];
  let blocked = scenario !== 'api-failure', opens = 0, reads = 0;
  const tab = { opener: {} as unknown, location: { replace: (url: string) => navigated.push(url) }, close: () => {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: () => { opens++; return blocked ? null : tab; } } });
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    reads++; assert.equal(JSON.parse(init.body as string).kind, scenario === 'pdf' ? 'pdf' : 'receipt');
    return scenario === 'api-failure' ? Response.json({}, { status: 503 }) : Response.json({ url: 'https://invoice.stripe.com/retried' });
  }) as typeof fetch;
  const show = () => render({}, [], [], (index, next) => { states[index] = typeof next === 'function' ? next(states[index] ?? 0) : next; }, states);
  try {
    show().buttons.find(button => button.children.join('') === (scenario === 'pdf' ? 'ใบแจ้งหนี้' : 'ใบเสร็จรับเงิน')).onClick();
    await new Promise(resolve => setImmediate(resolve));
    const { html, buttons } = show(), alert = html.slice(html.indexOf('<section role="alert"'), html.indexOf('</section>', html.indexOf('<section role="alert"')));
    const retry = buttons.find(button => button.children.join('') === 'ลองอีกครั้ง');
    assert.ok(retry); assert.equal(retry.disabled, retry['aria-busy']);
    if (scenario === 'api-failure') {
      assert.match(alert, /ติดต่อทีมงานมั่งมี/);
      retry.onClick(); assert.equal(states[2], 1); assert.equal(opens, 1);
    } else {
      assert.match(alert, /เปิดแท็บเอกสารไม่ได้ อนุญาตหน้าต่างใหม่แล้วกดเอกสารอีกครั้ง/);
      assert.doesNotMatch(alert, /ติดต่อทีมงานมั่งมี|mailto:/);
      assert.equal(reads, 0);
      blocked = false; retry.onClick();
      assert.equal(opens, 2, 'retry opens the same document synchronously in this click gesture');
      assert.equal(reads, 1); assert.equal(states[2], undefined, 'retry does not reload the payment page');
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(navigated, ['https://invoice.stripe.com/retried']);
      assert.equal(states[5], null);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
test('PAY-MENU adjustment rows alone reveal the section, including credit notes, and promotions keep free time', () => {
  const credit = [{ id: 'cn_one', number: 'CN-001', amountSatang: 10000, createdAt: invoice.createdAt, status: 'issued' as const }];
  assert.match(render({}, [], credit).html, /คืนเงินและเอกสารปรับยอด/);
  assert.match(render({}, credit).html, /CN-001/);
  const html = render({ promotion: { displayName: 'แถมหนึ่งเดือน', paidEnd: invoice.periodEnd, benefitEnd: '2026-12-01T00:00:00Z', bonusReceiptUnits: 50 } }).html;
  assert.match(html, /1 ธ.ค. 2569/); assert.match(html, /แถมหนึ่งเดือน/);
});

test('PAY-MENU the date paid is evidence, never the date the local row was created', () => {
  assert.match(render({ paidAt: '2026-10-02T00:00:00Z' }).html, /เติบโต · 2 ต.ค. 2569/);
  const unknown = render({ paidAt: null }).html;
  assert.match(unknown, /การจ่ายเงิน PAY-001/);
  assert.match(unknown, /ไม่ทราบวันที่จ่าย/);
});
