import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createBillingPreview, type PreviewScenario } from './billing-preview.fixture';
import { formatThaiDate } from '@/common/i18n/thai-date';
import type { BillingEventDiscountView, BillingInvoiceItem, BillingAttemptView, BillingPurchaseMode, BillingQuote, BillingStatus } from '@watchdog-bms/contracts';

(globalThis as any).React = React;
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const BillingPage = require('./BillingPage').default;
const { BillingWorkspaceContext } = require('./BillingCustomerFrame');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const runtime = require('react') as typeof React;
const words = (node: any): string => Array.isArray(node) ? node.map(words).join('') : React.isValidElement(node) ? (node.props as any)['aria-hidden'] ? '' : words((node.props as any).children) : node == null || typeof node === 'boolean' ? '' : String(node);

async function withBuyer(run: (ui: { render: () => string; button: (name: string) => any; input: (name: string, value?: string) => any; calls: any[]; quoteCalls: number; flushRecipient: () => Promise<void>; replayInitialLoad: () => Promise<void>; capacityPicker: () => any; changeRecipient: (email: string) => void; next: () => Promise<string>; method: (mode: BillingPurchaseMode) => void; pay: () => any; packageStep: () => void; row: (name: string) => any; latestRecipientInvoice: () => BillingInvoiceItem | null; documentsOpened: () => number }) => Promise<void>, unavailable = false, customize?: { returning?: boolean; attempt?: BillingAttemptView; heldView?: BillingEventDiscountView; timedOut?: boolean; checkoutCanceled?: boolean; startWithPlans?: boolean; quote?: (quote: BillingQuote) => BillingQuote; status?: (status: BillingStatus) => void; annualMismatch?: boolean; scenario?: PreviewScenario; captureCapacity?: boolean; history?: (cursor?: string, limit?: number) => Promise<{ items: BillingInvoiceItem[]; nextCursor: string | null }>; retrySelection?: { offer: string; interval: 'month' | 'year'; purchaseMode: BillingPurchaseMode } }) {
  const api = createBillingPreview('shop', customize?.scenario ?? 'start', null, () => {});
  if (customize?.history) api.history = customize.history;
  const originalQuote = api.quote;
  let quoteCalls = 0;
  api.quote = async (...args) => { quoteCalls++; const quote = await originalQuote(...args); return customize?.quote ? customize.quote(quote) : quote; };
  const status = await api.status(); customize?.status?.(status);
  if (unavailable) { status.enabledPurchaseModes = ['CARD_ONCE']; status.availablePurchaseModes = ['CARD_ONCE']; }
  if (customize?.status) api.status = async () => status;
  const data = { status, catalog: await api.catalog(), history: await api.history(undefined, 10) };
  if (customize?.annualMismatch) data.catalog.offers.find(offer => offer.interval === 'year')!.priceSatang += 1;
  const calls: any[] = [];
  api.checkout = async (body, key) => { calls.push({ body, key }); return { attemptId: 'attempt', state: 'OPEN', checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }; };
  const originalState = runtime.useState, originalRef = runtime.useRef, originalEffect = runtime.useEffect, originalCreate = runtime.createElement;
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => ({ scrollIntoView: () => {} }) } });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' }, sessionStorage: { getItem: () => customize?.retrySelection ? JSON.stringify(customize.retrySelection) : null, setItem: () => {} } } });
  const states: any[] = [], refs: any[] = [];
  let recipientInvoice: BillingInvoiceItem | null = null, documentOpens = 0, capacityProps: any;
  let cursor = 0, refCursor = 0, elements: { type: string; props: any; children: any[] }[] = [];
  Reflect.set(runtime, 'useState', (initial: any) => {
    const index = cursor++; const [value] = (originalState as any)(initial);
    if (!(index in states)) states[index] = index === 2 ? data : index === 27 && customize?.heldView ? customize.heldView : index === 30 && customize?.timedOut ? true : index === 32 && customize?.attempt ? customize.attempt : index === 36 && customize?.checkoutCanceled ? true : value;
    return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  });
  Reflect.set(runtime, 'useRef', (initial: any) => { const index = refCursor++; const ref = originalRef(initial); return refs[index] ?? (refs[index] = ref); });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type?.name === 'BillingEmailRecipientPanel') recipientInvoice = props.latestInvoice;
    if (customize?.captureCapacity && type?.name === 'BillingCapacityPicker') { capacityProps = props; return originalCreate('section', { 'aria-label': 'เลือกสาขาและผู้ใช้' }); }
    if (typeof type === 'string') elements.push({ type, props, children });
    return (originalCreate as any)(type, props, ...children);
  });
  let effects: { work: () => void; deps?: React.DependencyList }[] = [];
  Reflect.set(runtime, 'useEffect', (work: () => void, deps?: React.DependencyList) => { effects.push({ work, deps }); });
  const noop = () => undefined;
  const render = () => {
    cursor = 0; refCursor = 0; elements = []; effects = [];
    return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push: noop, replace: noop, prefetch: noop } as any },
      React.createElement(BillingWorkspaceContext.Provider, { value: true }, React.createElement(BillingPage, { companyId: 'shop', returning: customize?.returning, returnAttemptId: customize?.returning ? 'return-attempt' : null, preview: { api, navigate: noop, openDocumentHistory: () => { documentOpens++; }, startWithPlans: customize?.startWithPlans ?? true, retrySelection: customize?.retrySelection } }))));
  };
  const button = (name: string) => { const el = elements.find(el => el.type === 'button' && words(el.children) === name); assert.ok(el, name); return el.props; };
  const input = (name: string, value?: string) => { const el = elements.find(el => el.type === 'input' && (name === 'checkbox' ? el.props.type === name : el.props.name === name && (value === undefined || el.props.value === value))); assert.ok(el, `${name} ${value}`); return el.props; };
  const next = async () => { await button('ถัดไป').onClick(); return render(); };
  const method = (mode: BillingPurchaseMode) => {
    if (elements.some(el => el.type === 'input' && el.props.name === 'offer')) { button('ถัดไป').onClick(); render(); }
    input('renewalChoice', mode.endsWith('_ONCE') ? 'once' : 'auto').onChange(); render();
    input('paymentChoice', mode.startsWith('CARD') ? 'card' : 'qr').onChange(); render();
  };
  const pay = () => { const el = elements.find(el => el.type === 'button' && /^จ่าย [\d,]+\.\d{2} บาท$/.test(words(el.children))); assert.ok(el, 'amount on the pay button'); return el.props; };
  const packageStep = () => { button('กลับ').onClick(); render(); if (!elements.some(el => el.type === 'input' && el.props.name === 'offer')) { button('กลับ').onClick(); render(); } };
  const row = (name: string) => { const el = elements.find(el => el.type === 'tr' && el.props['aria-label'] === name); assert.ok(el, name); return el.props; };
  const flushRecipient = async () => { const effect = effects.filter(effect => effect.deps?.length === 1 && effect.deps[0] === (status.recipient?.email ?? '')); assert.equal(effect.length, 1); effect[0].work(); await new Promise(resolve => setImmediate(resolve)); };
  const replayInitialLoad = async () => {
    const load = effects.find(effect => effect.deps?.length === 4 && effect.deps[0] === api && typeof effect.deps[1] === 'number'); assert.ok(load);
    const cleanup = load.work() as unknown as () => void; cleanup(); load.work(); await new Promise(resolve => setImmediate(resolve));
  };
  const changeRecipient = (email: string) => { status.recipient = { email, source: 'STRIPE_CHECKOUT', bouncedAt: null, canChange: true }; };
  try { await run({ render, button, input, calls, get quoteCalls() { return quoteCalls; }, flushRecipient, replayInitialLoad, capacityPicker: () => capacityProps, changeRecipient, next, method, pay, packageStep, row, latestRecipientInvoice: () => recipientInvoice, documentsOpened: () => documentOpens }); }
  finally { Reflect.set(runtime, 'useEffect', originalEffect); Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'useRef', originalRef); Reflect.set(runtime, 'createElement', originalCreate); if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window'); if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document'); }
}

test('UAT-Q2 payment method radios explicitly use the visible Thai names', async () => {
  await withBuyer(async ({ render, input, next }) => {
    render(); input('offer', 'STARTER_249').onChange(); render();
    const html = await next();
    for (const [group, value, label] of [['renewalChoice', 'auto', 'ต่ออายุอัตโนมัติ'], ['renewalChoice', 'once', 'จ่ายครั้งเดียว'],
      ['paymentChoice', 'qr', 'QR พร้อมเพย์'], ['paymentChoice', 'card', 'บัตร']]) {
      assert.equal(input(group, value)['aria-label'], label);
      assert.ok(html.includes(`/>${label}</label>`), label);
    }
  });
});

test('UAT-Q1 package cards keep discounted prices without repeating the event name or instructions', async () => {
  await withBuyer(async ({ render, input, method, packageStep }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_ONCE'); packageStep();
    const html = render();
    const choice = html.slice(html.indexOf('aria-label="ส่วนลดจากงาน"'), html.indexOf('</fieldset>', html.indexOf('aria-label="ส่วนลดจากงาน"')));
    const cards = html.slice(html.indexOf('aria-label="แพ็กเกจ"'), html.indexOf('นับเฉพาะใบเสร็จ'));
    assert.match(cards, /หลังส่วนลด 239\.00 บาท/);
    assert.match(cards, /หลังส่วนลด 489\.00 บาท/);
    assert.doesNotMatch(cards, /ส่วนลดจากงาน event4|ลดเฉพาะการจ่ายครั้งนี้/);
    assert.equal((choice.match(/<p /g) ?? []).length, 1);
    assert.match(choice, /ใช้ได้ครั้งละ 1 ส่วนลด/);
    assert.match(choice, /ส่วนลดอื่นเก็บไว้ใช้ครั้งถัดไปได้/);
  }, false, { status: status => { status.eventDiscount = { ticketSerial: 'ticket', eventName: 'event4', discountSatang: 1000,
    expiresAt: '2099-12-31T00:00:00.000Z', reason: null, offers: [
      { offerKey: 'STARTER_249', interval: 'month', eventName: 'event4', shownDiscountSatang: 1000 },
      { offerKey: 'BASIC_499', interval: 'month', eventName: 'event4', shownDiscountSatang: 1000 },
    ] }; } });
});

test('UAT-Q1 history links name the package, amount, payment date and status on phone and wide screens', async () => {
  const source = createBillingPreview('shop', 'success', null, () => {});
  const base = (await source.history()).items[0];
  await withBuyer(async ({ render }) => {
    const html = render();
    const names = [...html.matchAll(/(?:<tr|<a)\b[^>]*aria-label="(เปิดรายการจ่ายเงิน [^"]+)"/g)].map(match => match[1]);
    assert.equal(names.length, 2);
    for (const name of names) {
      assert.match(name, /เริ่มต้น · รายเดือน/);
      assert.match(name, /249\.00 บาท/);
      assert.match(name, /2 ต.ค. 2569/);
      assert.match(name, /จ่ายแล้ว/);
    }
    assert.equal(names[0], names[1]);
  }, false, { scenario: 'success', startWithPlans: false, history: async () => ({ items: [{ ...base,
    offer: { key: 'STARTER_249', label: 'เริ่มต้น', interval: 'month' }, amountSatang: 24900,
    paidAt: '2026-10-02T03:00:00.000Z', createdAt: '2026-10-01T03:00:00.000Z',
  }], nextCursor: null }) });
});

test('PAY-1 package then payment: early presses show the missing choice in sight and never quote', async () => {
  await withBuyer(async ({ render, input, calls, next }) => {
    let html = render(); assert.match(html, /ขั้นตอนซื้อแพ็กเกจ/); assert.doesNotMatch(html, /ประวัติและเอกสารการจ่ายเงิน|name="paymentChoice"/);
    html = await next(); assert.match(html, /เลือกแพ็กเกจก่อน/); assert.ok(html.indexOf('เลือกแพ็กเกจก่อน') < html.indexOf('name="offer"'));
    input('offer', 'STARTER_249').onChange(); render(); html = await next();
    assert.match(html, /จ่ายแบบไหน[^]*จ่ายด้วย/); assert.doesNotMatch(html, /name="offer"/);
    html = await next(); assert.match(html, /เลือกวิธีจ่ายก่อน/); assert.ok(html.indexOf('เลือกวิธีจ่ายก่อน') < html.indexOf('name="renewalChoice"')); assert.equal(calls.length, 0);
  });
});

test('PAY-1 unavailable combinations keep the reason and contact in place and cannot reach payment', async () => {
  await withBuyer(async ({ render, input, method, next, calls }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('PROMPTPAY_ONCE');
    assert.match(render(), /ยังไม่เปิดใช้วิธีนี้[^]*ติดต่อทีมงานมั่งมี/);
    assert.equal(input('paymentChoice', 'qr').disabled, undefined);
    assert.match(await next(), /เลือกวิธีจ่ายก่อน/); assert.equal(calls.length, 0);
    method('CARD_ONCE'); assert.match(await next(), /aria-label="ตรวจก่อนจ่าย"/);
  }, true);
});

for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE', 'CARD_AUTO', 'PROMPTPAY_RENEW'] as BillingPurchaseMode[]) {
  test(`PAY-1 ${mode}: explicit accepted purchase sends one quote revision and one attempt`, async () => {
    await withBuyer(async ({ render, input, method, next, pay, calls }) => {
      render(); input('offer', 'STARTER_249').onChange(); render(); method(mode); await next();
      const once = mode.endsWith('_ONCE');
      if (!once) { assert.equal(input('checkbox').checked, false); input('checkbox').onChange({ target: { checked: true } }); render(); await next(); }
      const review = render(); assert.match(review, /aria-label="ตรวจก่อนจ่าย"/); assert.equal(calls.length, 0);
      assert.match(review, /ยอดที่จ่ายวันนี้[^]*249.00[^]*บาท/);
      assert.doesNotMatch(review, /฿|เมื่อจ่ายสำเร็จ ใช้งานได้ 1 เดือน/);
      assert.match(review, /กดจ่าย คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง/);
      assert.match(review, /href="\/terms"/); assert.equal(pay().disabled, false);
      const handler = pay().onClick; await Promise.all([handler(), handler()]);
      assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { quoteId: 'preview-quote', consentRevision: 'preview-consent', accepted: true, channel: 'web' }); assert.ok(calls[0].key);
    });
  });
}

test('PAY-1 an expired quote cannot submit before the timer paints its refresh control', async () => {
  const now = Date.now;
  try { await withBuyer(async ({ render, input, method, next, pay, calls }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_ONCE'); await next();
    Date.now = () => now() + 3 * 86_400_000;
    await pay().onClick(); assert.equal(calls.length, 0);
  }); } finally { Date.now = now; }
});

for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) for (const interval of ['month', 'year'] as const) {
  test(`PAY-1 ${mode} ${interval}: quote-specific consent sits under the method, an early next cannot buy`, async () => {
    await withBuyer(async ({ render, button, input, method, next, pay, calls }) => {
      render(); if (interval === 'year') { button('รายปี · ฟรี 2 เดือน').onClick(); render(); }
      input('offer', 'STARTER_249').onChange(); render(); method(mode); let html = await next();
      const cadence = interval === 'year' ? 'ปี' : 'เดือน';
      assert.match(html, /aria-label="วิธีจ่าย"/); assert.doesNotMatch(html, /aria-label="ตรวจก่อนจ่าย"/);
      assert.ok(html.includes(mode === 'CARD_AUTO' ? `ยอมรับการตัดบัตรอัตโนมัติทุก${cadence}` : `ยอมรับการออกบิลพร้อมเพย์ทุก${cadence}`));
      assert.equal(input('checkbox').checked, false);
      assert.doesNotMatch(html, /ติ๊กยอมรับการต่ออายุก่อน/);
      assert.equal(input('checkbox')['aria-invalid'], false);
      let focused = false; input('checkbox').ref.current = { focus: () => { focused = true; } };
      html = await next(); assert.match(html, /ติ๊กยอมรับการต่ออายุก่อน/); assert.equal(focused, true); assert.equal(calls.length, 0);
      input('checkbox').onChange({ target: { checked: true } }); render(); html = await next();
      assert.match(html, /aria-label="ตรวจก่อนจ่าย"/); assert.doesNotMatch(html, /ติ๊กยอมรับการต่ออายุก่อน/);
      assert.ok(html.includes(mode === 'CARD_AUTO' ? `เลือกบัตรที่หน้าจ่ายเงิน บัตรใบนั้นจะใช้ต่ออายุอัตโนมัติทุก${cadence}` : `ระบบออกบิลทุก${cadence} ต้องสแกนจ่ายเอง ไม่มีการหักเงินอัตโนมัติ`));
      assert.equal((html.match(/ยอดที่จ่ายวันนี้/g) ?? []).length, 1);
      await pay().onClick(); assert.equal(calls.length, 1);
    });
  });
}

for (const change of ['package', 'cadence', 'method'] as const) test(`PAY-1 changing ${change} clears consent and requires a fresh quote`, async () => {
  await withBuyer(async ({ render, button, input, method, next, calls, packageStep }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_AUTO'); await next(); input('checkbox').onChange({ target: { checked: true } }); render(); await next();
    if (change === 'method') { button('กลับ').onClick(); render(); method('PROMPTPAY_RENEW'); }
    else { packageStep(); if (change === 'package') input('offer', 'BASIC_499').onChange(); else button('รายปี · ฟรี 2 เดือน').onClick(); render(); await next(); }
    await next(); assert.equal(input('checkbox').checked, false); assert.equal(calls.length, 0);
    assert.match(await next(), /ติ๊กยอมรับการต่ออายุก่อน/);
  });
});

for (const canManageCard of [false, true]) test(`PAY-1 provider card management follows the allowed action: ${canManageCard}`, async () => {
  await withBuyer(async ({ render, input, method, next }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_AUTO'); await next(); input('checkbox').onChange({ target: { checked: true } }); render(); await next();
    assert.equal(render().includes('จัดการบัตรที่ใช้ต่ออายุ'), canManageCard);
  }, false, { status: status => { status.allowedActions = canManageCard ? ['new_sales', 'portal_payment_method'] : ['new_sales']; } });
});

test('PAY-1 missing next date is never invented', async () => {
  await withBuyer(async ({ render, input, method, next }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_AUTO'); await next(); input('checkbox').onChange({ target: { checked: true } }); render(); await next();
    assert.doesNotMatch(render(), /ตัดบัตรครั้งถัดไปโดยประมาณ/);
  }, false, { quote: quote => ({ ...quote, purchase: undefined }) });
});

test('PAY-1 a pending annual change supplies the cadence of repeat consent', async () => {
  await withBuyer(async ({ render, input, method, next }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_AUTO');
    assert.match(await next(), /ยอมรับการตัดบัตรอัตโนมัติทุกปี/);
  }, false, { quote: quote => ({ ...quote, purchase: { ...quote.purchase!, kind: 'REPEAT' }, pendingPlanChange: { operationId: 'change', oldEffectiveAt: '2027-01-01T00:00:00Z', newEffectiveAt: '2027-02-01T00:00:00Z', offer: { ...quote.offer, interval: 'year' }, totalSatang: 249000, capacity: { retainedBranches: [], retainedMembers: [], suspendedBranches: [], suspendedMembers: [], defaults: [] } } }) });
});

for (const [tierKey, label] of [['STARTER_249', 'เริ่มต้น'], ['BASIC_499', 'เติบโต'], ['PRO_999', 'มืออาชีพ'], ['ENTERPRISE_1999', 'ธุรกิจ']] as const) test(`PAY-1 paid ${tierKey} keeps its Thai name in the overview metrics`, async () => {
  await withBuyer(async ({ render }) => {
    const html = render(); assert.ok(html.includes(label)); assert.match(html, /อ่านใบเสร็จได้อีก/); assert.doesNotMatch(html, /\((STARTER|BASIC|PRO|ENTERPRISE)\)/);
    assert.ok(html.indexOf('สถานะแพ็กเกจ') < html.indexOf('billing-history')); assert.ok(html.indexOf('billing-history') < html.indexOf('billing-payment'));
    assert.doesNotMatch(html, /หมวดแพ็กเกจและการจ่ายเงิน|data-breadcrumb|แพ็กเกจและการจ่ายเงิน/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { accessState: 'ACTIVE', paymentState: 'PAID', applyState: 'APPLIED', tierKey }) });
});

for (const taxTreatment of ['NOT_VAT_REGISTERED', 'INCLUSIVE_VAT_7', 'EXCLUSIVE_VAT_7'] as const) test(`PAY-1 ${taxTreatment}: review keeps payable tax facts once`, async () => {
  await withBuyer(async ({ render, input, method, next }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_ONCE'); const html = await next();
    assert.doesNotMatch(html, /ไม่มีวันแพ็กเกจเดิมให้ทบ|โควตา|ยังไม่ได้จด VAT/);
    if (taxTreatment === 'NOT_VAT_REGISTERED') assert.doesNotMatch(html, /ราคาก่อนภาษี|VAT 7%/);
    else { assert.match(html, /ราคาก่อนภาษี/); assert.match(html, taxTreatment === 'INCLUSIVE_VAT_7' ? /ราคารวม VAT 7% แล้ว/ : /ราคาเพิ่ม VAT 7%/); }
    assert.equal((html.match(/ยอดที่จ่ายวันนี้/g) ?? []).length, 1);
  }, false, { quote: quote => ({ ...quote, previousSource: 'NO_TERM', taxTreatment, subtotalSatang: taxTreatment === 'INCLUSIVE_VAT_7' ? 23271 : 24900, taxSatang: taxTreatment === 'NOT_VAT_REGISTERED' ? 0 : taxTreatment === 'INCLUSIVE_VAT_7' ? 1629 : 1743, totalSatang: taxTreatment === 'EXCLUSIVE_VAT_7' ? 26643 : 24900 }) });
});

for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE', 'CARD_AUTO', 'PROMPTPAY_RENEW'] as const) for (const cadence of ['month', 'year'] as const) test(`PAY-1 repeat ${mode} ${cadence} opens step 3 with one extension and back reaches methods`, async () => {
  const previous = '2098-01-01T00:00:00.000Z', nextDate = '2099-01-01T00:00:00.000Z';
  await withBuyer(async ({ render, button, input, calls }) => {
    render(); await button(`ต่ออายุ ${cadence === 'year' ? '2,490.00' : '249.00'} บาท`).onClick(); await new Promise(resolve => setImmediate(resolve)); const html = render();
    assert.match(html, /aria-label="ตรวจก่อนจ่าย"/); assert.match(html, /อ่านใบเสร็จได้เพิ่ม/); assert.match(html, /ใช้ได้ถึง/); assert.match(html, /2641/); assert.match(html, /2642/);
    assert.equal(html.includes('ตัดบัตรครั้งถัดไป'), mode === 'CARD_AUTO'); assert.equal(html.includes('ออกบิลครั้งถัดไป'), mode === 'PROMPTPAY_RENEW');
    assert.equal(html.includes('type="checkbox"'), !mode.endsWith('_ONCE')); if (!mode.endsWith('_ONCE')) assert.equal(input('checkbox').checked, false); assert.equal(calls.length, 0);
    button('กลับ').onClick(); render(); assert.equal(input('renewalChoice', mode.endsWith('_ONCE') ? 'once' : 'auto').checked, true); assert.equal(input('paymentChoice', mode.startsWith('CARD') ? 'card' : 'qr').checked, true);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { tierKey: 'STARTER_249', interval: cadence, paidThrough: previous, renewalMode: mode, accessState: 'ACTIVE', cancelAtPeriodEnd: mode === 'CARD_AUTO', subscriptionState: mode.endsWith('_ONCE') ? 'NONE' : 'active' }), quote: quote => ({ ...quote, purchase: { kind: 'REPEAT', previousPaidThrough: previous, projectedPaidThrough: nextDate, receiptUnitsAdded: cadence === 'year' ? 360 : 30, projectedRemainingReceipts: 400 } }) });
});

test('PAY-1 an incompatible previous method is not silently replaced', async () => {
  await withBuyer(async ({ render, button, input, calls, next }) => {
    render(); button('ต่ออายุ 249.00 บาท').onClick(); render();
    for (const value of ['auto', 'once']) assert.equal(input('renewalChoice', value).checked, false);
    for (const value of ['card', 'qr']) assert.equal(input('paymentChoice', value).checked, false);
    assert.match(await next(), /เลือกวิธีจ่ายก่อน/); assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'month', renewalMode: 'CARD_AUTO', cancelAtPeriodEnd: true, enabledPurchaseModes: ['PROMPTPAY_ONCE'], availablePurchaseModes: ['PROMPTPAY_ONCE'] }) });
});

test('PAY-1 issued QR bill is the main action and does not create a second purchase', async () => {
  await withBuyer(async ({ render, button, calls }) => {
    const html = render(); assert.match(html, /มีบิลต่ออายุรอจ่าย/); assert.equal(button('เปิดบิลพร้อมเพย์').disabled, false); assert.match(button('เปิดบิลพร้อมเพย์').className, /primary/); assert.doesNotMatch(html, />จ่ายบิลงวดนี้</);
    assert.doesNotMatch(html, />ต่ออายุ [^<]*บาท<|>เลือกแพ็กเกจ<|>เปลี่ยนแพ็กเกจ</); assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'month', renewalMode: 'PROMPTPAY_RENEW', renewalInvoiceUrl: 'https://invoice.stripe.com/i/original' }) });
});

test('PAY-1 running card renewal has its date and change action without a main purchase button', async () => {
  await withBuyer(async ({ render, button }) => { const html = render(); assert.match(html, /ตัดบัตรอัตโนมัติ/); assert.match(button('เปลี่ยนแพ็กเกจ').className, /secondary/); assert.doesNotMatch(html, />ต่ออายุ [^<]*บาท</); }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'year', renewalMode: 'CARD_AUTO', subscriptionState: 'active', nextChargeAt: '2099-01-01' }) });
});

test('PAY-1 changing cadence revalidates a previously selected package', async () => {
  await withBuyer(async ({ render, button, input, next }) => {
    render(); button('เปลี่ยนแพ็กเกจ').onClick(); render(); input('offer', 'STARTER_249').onChange(); render(); button('รายปี · ฟรี 2 เดือน').onClick(); render();
    assert.equal(input('offer', 'STARTER_249').disabled, true); assert.match(await next(), /เลือกแพ็กเกจก่อน/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'month', renewalMode: 'CARD_ONCE', packageChangesEnabled: false }) });
});

for (const allowed of [true, false]) test(`PAY-1 explicit change preserves the current interval and only compatible methods: ${allowed}`, async () => {
  await withBuyer(async ({ render, button, input, next, calls }) => {
    render(); button('เปลี่ยนแพ็กเกจ').onClick(); render(); assert.equal(button('รายปี · ฟรี 2 เดือน')['aria-pressed'], true);
    input('offer', 'STARTER_249').onChange(); render(); await next();
    assert.equal(input('renewalChoice', 'auto').checked, allowed); assert.equal(input('paymentChoice', 'card').checked, allowed); assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'year', renewalMode: 'CARD_AUTO', subscriptionState: 'active', ...(allowed ? {} : { enabledPurchaseModes: ['PROMPTPAY_ONCE'], availablePurchaseModes: ['PROMPTPAY_ONCE'] }) }) });
});

test('PAY-1 all package cards are labels, selected border is strong and added menus are computed', async () => {
  await withBuyer(async ({ render, input }) => {
    let html = render(); assert.equal((html.match(/cursor-pointer flex-col/g) ?? []).length, 4); assert.doesNotMatch(html, /ดูรายละเอียดทั้งหมด|฿|499.00/);
    assert.match(html, /ภาษีหัก ณ ที่จ่าย \/ 50 ทวิ/); assert.equal((html.match(/เครดิตสำหรับคุย/g) ?? []).length, 1);
    input('offer', 'BASIC_499').onChange(); html = render(); assert.match(html, /border-brand-700 bg-brand-50[^]*name="offer" checked="" value="BASIC_499"/);
  });
});

for (const [state, apply, heading] of [
  ['UNKNOWN', 'NONE', 'ยังไม่ทราบผลการจ่ายเงิน'],
  ['PAID', 'PENDING', 'ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ'],
  ['PAID', 'HELD', 'ได้รับเงินแล้ว ต้องตรวจสอบแพ็กเกจ'],
] as const) test(`D5 mounted ${state}/${apply}: one state block without an access badge or a second purchase`, async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render();
    assert.match(html, new RegExp(`<h2[^>]*>${heading}</h2>`));
    assert.match(html, new RegExp(`aria-label="${heading}" class="space-y-4"`));
    const overview = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('<section id="billing-history"'));
    assert.doesNotMatch(overview, /mangmee-badge/);
    assert.doesNotMatch(overview, />เลือกแพ็กเกจ<|>ต่ออายุ [^<]*บาท<|ยังไม่ได้รับเงิน/);
    assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
    if (state === 'PAID') assert.doesNotMatch(overview, />จ่ายต่อ<|>ยกเลิกรายการนี้</);
    if (apply === 'HELD') { assert.match(html, /เลขอ้างอิง/); assert.match(html, /mailto:/); }
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paymentState: state, applyState: apply, attemptId: 'original', reference: 'original', canCancelCheckout: state === 'UNKNOWN', allowedActions: ['new_sales'] }) });
});

for (const paymentState of ['PENDING', 'FAILED', 'PAID'] as const) test(`D5 return attempt ${paymentState} outranks stale subscription failure and timeout`, async () => {
  const attempt: BillingAttemptView = { attemptId: 'return-attempt', state: 'OPEN', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState, applyState: paymentState === 'PAID' ? 'PENDING' : 'NONE' };
  await withBuyer(async ({ render, button }) => {
    const html = render();
    if (paymentState === 'FAILED') assert.match(html, /<h2[^>]*>ยังไม่ได้รับเงิน<\/h2>/);
    else assert.doesNotMatch(html, /<h2[^>]*>ยังไม่ได้รับเงิน/);
    if (paymentState === 'PENDING') {
      assert.match(html, /ยังไม่ทราบผลการจ่ายเงิน/);
      button('ยกเลิกรายการนี้').onClick();
      assert.match(render(), /ยกเลิกรายการจ่ายนี้\?/);
    } else assert.doesNotMatch(html, />ยกเลิกรายการนี้<|>จ่ายต่อ</);
  }, false, { startWithPlans: false, returning: true, timedOut: true, attempt, status: status => Object.assign(status, { paymentState: 'FAILED', attemptId: 'return-attempt', canCancelCheckout: true, allowedActions: ['new_sales'] }) });
});

test('D5 an older failed return cannot offer another purchase over a newer collectible attempt', async () => {
  await withBuyer(async ({ render }) => {
    const html = render(); assert.match(html, /มีรายการจ่ายเงินที่ยังไม่เสร็จ/);
    assert.doesNotMatch(html, /<h2[^>]*>ยังไม่ได้รับเงิน|>เลือกแพ็กเกจ<|>ต่ออายุ [^<]*บาท</);
  }, false, { startWithPlans: false, returning: true, attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { paymentState: 'PENDING', attemptId: 'newer-attempt', canCancelCheckout: true, allowedActions: ['new_sales'] }) });
});


test('D5 a cancelled redirect with an ordinary pending attempt still ends in one press', async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render(); assert.match(html, /มีรายการจ่ายเงินที่ยังไม่เสร็จ/);
    assert.doesNotMatch(html, /ยังไม่ได้รับเงิน/);
    button('ยกเลิกรายการนี้').onClick(); await new Promise(resolve => setImmediate(resolve));
    const ended = render(); assert.match(ended, /ยกเลิกรายการเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย/);
    assert.doesNotMatch(ended, /ยกเลิกรายการจ่ายนี้\?/);
  }, false, { startWithPlans: false, returning: true, checkoutCanceled: true,
    attempt: { attemptId: 'return-attempt', state: 'OPEN', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'PENDING', applyState: 'NONE' },
    status: status => Object.assign(status, { paymentState: 'PENDING', attemptId: 'return-attempt', canCancelCheckout: true, allowedActions: [] }) });
});

test('D5 a paid future deal keeps its dated facts without claiming the package is opening now', async () => {
  await withBuyer(async ({ render }) => {
    const html = render(); assert.match(html, /จ่ายดีลแล้ว รอเริ่มสิทธิ์/);
    assert.match(html, /สิทธิ์แพ็กเกจปัจจุบันยังใช้ได้ถึง/); assert.match(html, /งวดแรกสิ้นสุด/);
    assert.doesNotMatch(html, /ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ|ทีมงานกำลังตรวจสอบ|>เลือกแพ็กเกจ<|>จ่ายต่อ<|>ยกเลิกรายการนี้</);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paymentState: 'PAID', applyState: 'PENDING', attemptId: 'future', canCancelCheckout: false, allowedActions: ['new_sales'],
    pendingDeal: { dealId: 'deal', purchaseMode: 'PROMPTPAY_RENEW', startsAt: '2026-11-01T00:00:00Z', firstCycleEndsAt: '2026-12-01T00:00:00Z', nextChargeAt: '2026-12-01T00:00:00Z', state: 'PAID' } }) });
});


test('D5 unknown actions are equal shared controls; ending is its own destructive step', async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render();
    assert.equal((html.match(/เพื่อไม่ให้จ่ายซ้ำ/g) ?? []).length, 1);
    assert.doesNotMatch(html, /หรือไม่/);
    for (const name of ['ตรวจผลการจ่ายเงิน', 'จ่ายต่อ', 'ยกเลิกรายการนี้']) assert.match(button(name).className, /mangmee-btn/);
    button('ยกเลิกรายการนี้').onClick();
    const question = render();
    assert.match(button('ยกเลิกรายการนี้').className, /mangmee-btn-danger/);
    assert.doesNotMatch(question, />จ่ายต่อ<|>ตรวจผลการจ่ายเงิน<|mangmee-btn-primary/);
    button('ไม่ยกเลิก').onClick(); render(); assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paymentState: 'UNKNOWN', attemptId: 'original', canCancelCheckout: true, allowedActions: ['new_sales'] }) });
});

const heldEventDiscount = (state: 'AVAILABLE' | 'USED' = 'AVAILABLE'): BillingEventDiscountView => ({
  path: 'CREDIT', renewalMode: 'CARD_AUTO', renewalState: 'RUNNING', tickets: [{
    serial: 'remaining-ticket', eventName: 'event4', discountSatang: 1000, chatCreditUnits: 0, receiptImageUnits: 0,
    expiresAt: '2026-10-30T16:59:59.000Z', state, batchSuspended: false,
  }],
});

for (const mode of ['PROMPTPAY_ONCE', 'CARD_AUTO'] as const) for (const returning of [true, false]) {
  test(`PAY-4 applied ${mode}, ${returning ? 'return' : 'later visit'}: no last-result block or recheck after settlement`, async () => {
    const discounted = mode === 'CARD_AUTO', amountSatang = discounted ? 198900 : 12900;
    const invoice = (await createBillingPreview('shop', 'success', null, () => {}).history()).items[0];
    await withBuyer(async ({ render, button }) => {
      const html = render(), text = html.replace(/<[^>]+>/g, '');
      assert.doesNotMatch(html, /ผลการจ่ายเงินล่าสุด|>ตรวจผลการจ่ายเงิน</);
      assert.match(text, /อ่านใบเสร็จได้อีก/);
      if (returning) {
        assert.ok(text.includes(`จ่าย ${discounted ? '1,989.00' : '129.00'} บาทแล้ว`));
        assert.ok(button('ดูใบเสร็จรับเงิน'));
        if (discounted) {
          assert.match(text, /ใช้ส่วนลดจากงานแล้ว · −10.00 บาท/);
          assert.doesNotMatch(html, /คุณมีส่วนลดจากงาน|ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้/);
        }
      } else if (discounted) {
        assert.match(text, /คุณมีส่วนลดจากงาน event4 ลด 10 บาท/);
        assert.doesNotMatch(html, /ใช้ส่วนลดจากงานแล้ว/);
      }
    }, false, { scenario: 'success', startWithPlans: false, returning,
      attempt: returnView('PAID', 'APPLIED', discounted ? { eventDiscount: { state: 'USED', shownDiscountSatang: 1000 } } : {}),
      heldView: discounted ? heldEventDiscount() : undefined,
      status: status => { status.renewalMode = mode; status.attemptId = null; },
      history: async () => ({ items: [{ ...invoice, amountSatang }], nextCursor: null }),
    });
  });
}

test('PAY-4 a later visit never offers a used event ticket as held', async () => {
  await withBuyer(async ({ render }) => {
    assert.doesNotMatch(render(), /คุณมีส่วนลดจากงาน|ใช้ส่วนลดจากงานแล้ว|ผลการจ่ายเงินล่าสุด|>ตรวจผลการจ่ายเงิน</);
  }, false, { scenario: 'success', startWithPlans: false, heldView: heldEventDiscount('USED') });
});

for (const applyState of ['PENDING', 'HELD'] as const) test(`D5 refresh of paid ${applyState} never retracts the received money`, async () => {
  await withBuyer(async ({ render, button }) => {
    render(); button('ตรวจผลการจ่ายเงิน').onClick(); await new Promise(resolve => setImmediate(resolve));
    const html = render(); assert.match(html, /ส่งคำขอตรวจสอบแล้ว กดอัปเดตข้อมูลเพื่อดูผลล่าสุด/);
    assert.doesNotMatch(html, /ยังไม่ใช่ผลยืนยันการจ่ายเงิน/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paymentState: 'PAID', applyState, attemptId: 'original', allowedActions: [] }) });
});

test('PAY-2 failed purchase offers method change and a fresh review without resuming the old attempt', async () => {
  await withBuyer(async ({ render, button, calls, next, pay }) => {
    const html = render(), overview = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('<section id="billing-history"'));
    assert.doesNotMatch(overview, /<dl[^>]*rounded|ยังไม่มีแพ็กเกจ|>ตรวจผลการจ่ายเงิน</);
    assert.match(overview, /การจ่ายเงินรายการนี้ไม่เสร็จ/);
    assert.ok(overview.indexOf('>เปลี่ยนวิธีจ่าย</button>') < overview.indexOf('>จ่ายอีกครั้ง</button>'));
    assert.doesNotMatch(overview, /mangmee-actions !flex-col/);
    assert.match(button('จ่ายอีกครั้ง').className, /mangmee-btn-primary/);
    button('เปลี่ยนวิธีจ่าย').onClick();
    assert.match(render(), /aria-label="วิธีจ่าย"/);
    await next(); assert.match(render(), /aria-label="ตรวจก่อนจ่าย"/);
    assert.equal(calls.length, 0); await pay().onClick(); assert.equal(calls.length, 1);
  }, false, { startWithPlans: false, returning: true, retrySelection: { offer: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_ONCE' },
    attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { paymentState: 'NONE', attemptId: null, canCancelCheckout: false, allowedActions: ['new_sales'] }) });
});


test('DQ3 a failed return with no new-sales permission keeps the original check and cannot start another purchase', async () => {
  await withBuyer(async ({ render, button, calls }) => {
    const html = render();
    assert.match(html, /<h2[^>]*>ยังไม่ได้รับเงิน<\/h2>/);
    assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
    assert.doesNotMatch(html, /เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้|ยังไม่เปิดรับการจ่ายเงินใหม่ ลองอีกครั้งภายหลัง/);
    assert.doesNotMatch(html, />เลือกแพ็กเกจ<|>เปลี่ยนแพ็กเกจ<|>ต่ออายุ [^<]*บาท<|>จ่ายต่อ<|>ยกเลิกรายการนี้</);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, returning: true,
    attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { paymentState: 'FAILED', attemptId: 'return-attempt', canCancelCheckout: false, allowedActions: [] }) });
});


for (const purchaseBlockCode of ['BILLING_SALES_CLOSED', 'BILLING_COMPANY_SALES_CLOSED']) test(`DQ4b ${purchaseBlockCode} explains the failed purchase without inviting another payment`, async () => {
  await withBuyer(async ({ render, button, calls }) => {
    const html = render();
    assert.match(html, /aria-label="ยังไม่ได้รับเงิน"[^]*ยังไม่เปิดรับการจ่ายเงินใหม่ ลองอีกครั้งภายหลัง/);
    assert.equal(html.split("ยังไม่เปิดรับการจ่ายเงินใหม่ ลองอีกครั้งภายหลัง").length - 1, 1);
    assert.match(html, /href="tel:/); assert.match(html, /href="mailto:/);
    assert.doesNotMatch(html, /role="alert"/);
    assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
    assert.doesNotMatch(html, /เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้|>เลือกแพ็กเกจ<|>เปลี่ยนแพ็กเกจ</);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, returning: true,
    attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { purchaseBlockCode, paymentState: 'NONE', attemptId: null, canCancelCheckout: false, allowedActions: [] }) });
});

for (const mismatch of [false, true]) test(`PAY-1 free-two-month wording comes from every annual price: mismatch ${mismatch}`, async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render(); assert.equal(html.includes('รายปี · ฟรี 2 เดือน'), !mismatch);
    assert.equal(button(mismatch ? 'รายปี' : 'รายปี · ฟรี 2 เดือน')['aria-pressed'], false);
  }, false, { annualMismatch: mismatch });
});

test('PAY-1 first package starts monthly and both payment questions are unanswered', async () => {
  await withBuyer(async ({ render, button, input, next, calls }) => {
    render(); button('เลือกแพ็กเกจ').onClick(); render(); assert.equal(button('รายเดือน')['aria-pressed'], true);
    input('offer', 'STARTER_249').onChange(); render(); await next();
    for (const value of ['auto', 'once']) assert.equal(input('renewalChoice', value).checked, false);
    for (const value of ['qr', 'card']) assert.equal(input('paymentChoice', value).checked, false);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false });
});

for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW', 'CARD_ONCE', 'PROMPTPAY_ONCE'] as const) test(`PAY-1 deal ${mode} uses its own modes through all three steps`, async () => {
  await withBuyer(async ({ render, button, input, method, next, calls, pay }) => {
    render(); button('เลือกข้อเสนอนี้').onClick(); render(); method(mode); await next();
    if (!mode.endsWith('_ONCE')) { input('checkbox').onChange({ target: { checked: true } }); render(); await next(); }
    const html = render(); assert.match(html, /aria-label="ตรวจก่อนจ่าย"/); assert.match(html, /ข้อเสนอพิเศษ/); assert.equal(calls.length, 0);
    await pay().onClick(); assert.equal(calls.length, 1); assert.equal(calls[0].body.quoteId, 'preview-deal-quote');
  }, false, { scenario: mode.endsWith('_ONCE') ? 'deal' : 'deal-auto' });
});

test('PAY-1 a one-time upgrade retains both difference and full-package quotes', async () => {
  await withBuyer(async ({ render, button, input, method, next, pay, calls }) => {
    render(); input('offer', 'PRO_999').onChange(); render(); method('CARD_ONCE'); await next();
    assert.match(render(), /จ่ายส่วนต่างและเริ่ม มืออาชีพ/);
    assert.ok(button('ดูทางเลือกซื้อ มืออาชีพ เต็มแพ็ก 999.00 บาท'));
    await button('ดูทางเลือกซื้อ มืออาชีพ เต็มแพ็ก 999.00 บาท').onClick();
    assert.match(render(), /เพิ่มจำนวนใบเสร็จเต็ม 100 ใบ/); assert.ok(button('จ่าย 999.00 บาท'));
    await button('กลับไปดูราคาอัปเกรดจ่ายส่วนต่าง').onClick();
    assert.match(render(), /จ่ายส่วนต่างและเริ่ม มืออาชีพ/); assert.ok(button('จ่าย 500.00 บาท')); assert.equal(calls.length, 0);
  }, false, { scenario: 'one-time' });
});

test('PAY-1 an advance deal uses its known first-cycle end in the payment facts', async () => {
  await withBuyer(async ({ render, button, input, next, method }) => {
    render(); button('เลือกข้อเสนอนี้').onClick(); render(); method('CARD_AUTO'); await next();
    input('checkbox').onChange({ target: { checked: true } }); render(); await next();
    const html = render(), facts = html.slice(html.indexOf('aria-label="รายละเอียดแพ็กเกจที่จ่าย"'), html.indexOf('ข้อเสนอพิเศษ ·'));
    assert.match(facts, /ใช้ได้ถึง[^]*5 เม.ย. 2573/); assert.doesNotMatch(facts, /ใช้ได้ถึง[^]*>—</);
  }, false, { scenario: 'deal-auto', quote: quote => ({ ...quote, purchase: undefined, advanceDeal: { startsAt: '2030-03-05T00:00:00Z', firstCycleEndsAt: '2030-04-05T00:00:00Z', nextChargeAt: '2030-04-05T00:00:00Z' } }) });
});

const returnView = (paymentState: BillingAttemptView['paymentState'], applyState: BillingAttemptView['applyState'], over: Partial<BillingAttemptView> = {}): BillingAttemptView => ({ attemptId: 'return-attempt', state: paymentState === 'FAILED' ? 'FAILED' : 'COMPLETED', errorCode: null, observedAt: '2026-10-18T00:00:00Z', invoiceReference: 'preview-invoice', paymentState, applyState, ...over });

test('PAY-2 paid return uses its invoice amount and package, with receipt and home actions', async () => {
  await withBuyer(async ({ render, button, documentsOpened }) => {
    const html = render();
    assert.match(html.replace(/<[^>]+>/g, ''), /จ่าย 499.00 บาทแล้ว/); assert.match(html, /เติบโต ใช้ได้ถึง/);
    assert.match(html, /href="\/companies\/shop\/dashboard"[^>]*>กลับหน้าแรก</);
    assert.match(button('ดูใบเสร็จรับเงิน').className, /mangmee-btn-primary/);
    button('ดูใบเสร็จรับเงิน').onClick(); assert.equal(documentsOpened(), 1);
    assert.doesNotMatch(html, /จ่ายแล้ว เปิดแพ็กเกจแล้ว|>เลือกแพ็กเกจ<|>ต่ออายุ [^<]*บาท</);
  }, false, { scenario: 'success', startWithPlans: false, returning: true, attempt: returnView('PAID', 'APPLIED') });
});

test('PAY-4 an applied payment stays settled after its package expires and a new purchase stays available', async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render();
    assert.match(html, /แพ็กเกจหมดอายุแล้ว/);
    assert.doesNotMatch(html, /ผลการจ่ายเงินล่าสุด|>ตรวจผลการจ่ายเงิน</);
    assert.ok(button('เลือกแพ็กเกจ'));
  }, false, { scenario: 'success', startWithPlans: false, status: status => {
    status.accessState = 'EXPIRED'; status.lockReason = 'trial_ended';
    status.termEndsAt = status.paidThrough = new Date(Date.now() - 86_400_000).toISOString();
    status.subscriptionState = 'canceled'; status.nextChargeAt = null; status.allowedActions = ['new_sales'];
  } });
});

for (const applyState of ['PENDING', 'HELD'] as const) test(`PAY-2 received ${applyState} hides email editing and retry; held reference is disclosed`, async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render();
    assert.match(html, new RegExp(applyState === 'HELD' ? 'ได้รับเงินแล้ว ต้องตรวจสอบแพ็กเกจ' : 'ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ'));
    assert.match(html, /ไม่ต้องจ่ายซ้ำ/); assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
    assert.doesNotMatch(html, />แก้อีเมลรับเอกสาร<|>แก้<|>จ่ายอีกครั้ง<|>เปลี่ยนวิธีจ่าย<|ร้านนี้ถูกพักใช้งาน/);
    if (applyState === 'HELD') { assert.match(html, /ติดต่อทีมงานมั่งมี/); assert.match(html, /<details[^]*เลขอ้างอิงสำหรับแจ้งทีมงาน<\/summary>/); }
  }, false, { scenario: applyState === 'HELD' ? 'held' : 'activating', startWithPlans: false, returning: true, attempt: returnView('PAID', applyState) });
});

for (const state of ['FAILED', 'EXPIRED'] as const) test(`PAY-2 ${state} never promises no debit without the not-started evidence`, async () => {
  await withBuyer(async ({ render, button, pay, calls }) => {
    assert.match(render(), /ยังไม่ได้รับเงิน/); assert.doesNotMatch(render(), /ยังไม่มีการตัดเงิน/);
    await button('จ่ายอีกครั้ง').onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.match(render(), /aria-label="ตรวจก่อนจ่าย"/); assert.equal(calls.length, 0);
    const press = pay().onClick; await Promise.all([press(), press()]); assert.equal(calls.length, 1);
  }, false, { scenario: 'failed', startWithPlans: false, returning: true, retrySelection: { offer: 'BASIC_499', interval: 'month', purchaseMode: 'CARD_ONCE' }, attempt: returnView('FAILED', 'NONE', { state }) });
});

test('PAY-2 retry of automatic renewal obtains fresh unchecked consent before a new attempt', async () => {
  await withBuyer(async ({ render, button, input, calls, pay }) => {
    render(); await button('จ่ายอีกครั้ง').onClick(); await new Promise(resolve => setImmediate(resolve)); render();
    assert.equal(input('checkbox').checked, false); await pay().onClick(); assert.equal(calls.length, 0);
    assert.match(render(), /ติ๊กยอมรับการต่ออายุก่อน/);
    input('checkbox').onChange({ target: { checked: true } }); render(); await pay().onClick(); assert.equal(calls.length, 1);
  }, false, { scenario: 'failed', startWithPlans: false, returning: true, retrySelection: { offer: 'BASIC_499', interval: 'month', purchaseMode: 'CARD_AUTO' }, attempt: returnView('FAILED', 'NONE') });
});

test('PAY-2 return without an invoice routes its receipt action to history and invents no amount', async () => {
  await withBuyer(async ({ render, button, documentsOpened }) => {
    const html = render(); assert.match(html, /<h2[^>]*>จ่ายแล้ว<\/h2>/);
    assert.doesNotMatch(html, /จ่าย 499.00 บาทแล้ว/);
    button('ดูใบเสร็จรับเงิน').onClick(); assert.equal(documentsOpened(), 0);
  }, false, { scenario: 'success', startWithPlans: false, returning: true, attempt: returnView('PAID', 'APPLIED', { invoiceReference: null }) });
});

test('PAY-2 history shows ten facts per page, supports previous cursors and keeps the latest document recipient invoice', async () => {
  const source = createBillingPreview('shop', 'success', null, () => {});
  const base = (await source.history()).items[0]; const reads: { cursor?: string; limit?: number }[] = [];
  const items = Array.from({ length: 20 }, (_, index) => ({ ...base, id: `invoice-${index}`, number: `BILL-${index}` }));
  await withBuyer(async ({ render, button, row, latestRecipientInvoice, documentsOpened }) => {
    let html = render(); assert.equal((html.match(/<tr role="link"/g) ?? []).length, 10);
    assert.match(html, /<th[^>]*>ยอด \(บาท\)<\/th>/); assert.doesNotMatch(html, />ดูเอกสาร<|BILL-10/);
    await button('ถัดไป').onClick(); html = render(); assert.match(html, /BILL-10/); assert.doesNotMatch(html, /BILL-0"/);
    await button('ถัดไป').onClick(); html = render(); assert.match(html, /BILL-20/);
    assert.equal(latestRecipientInvoice()?.id, 'invoice-0');
    const name = `เปิดรายการจ่ายเงิน BILL-20 · เติบโต · รายเดือน · 499.00 บาท · ${formatThaiDate(base.paidAt ?? base.createdAt)} · จ่ายแล้ว`;
    row(name).onKeyDown({ key: 'Escape' }); assert.equal(documentsOpened(), 0);
    row(name).onKeyDown({ key: 'Enter', preventDefault: () => {} }); assert.equal(documentsOpened(), 1);
    await button('ก่อนหน้า').onClick(); html = render(); assert.match(html, /BILL-10/);
    await button('ก่อนหน้า').onClick(); html = render(); assert.match(html, /BILL-0/);
    assert.deepEqual(reads, [{ cursor: undefined, limit: 10 }, { cursor: 'invoice-9', limit: 10 }, { cursor: 'invoice-19', limit: 10 }, { cursor: 'invoice-9', limit: 10 }, { cursor: undefined, limit: 10 }]);
  }, false, { scenario: 'success', startWithPlans: false, history: async (cursor, limit) => { reads.push({ cursor, limit }); const start = cursor ? Number(cursor.replace('invoice-', '')) + 1 : 0; const all = [...items, { ...base, id: 'invoice-20', number: 'BILL-20' }]; return { items: all.slice(start, start + (limit ?? 20)), nextCursor: start + (limit ?? 20) < all.length ? all[start + (limit ?? 20) - 1].id : null }; } });
});

test('PAY-2 a refused retry keeps the same package and an editable method with a way back', async () => {
  await withBuyer(async ({ render, button, calls }) => {
    render(); await button('จ่ายอีกครั้ง').onClick(); await new Promise(resolve => setImmediate(resolve));
    const html = render(); assert.match(html, /aria-label="วิธีจ่าย"/); assert.match(html, /role="alert"/);
    assert.ok(button('กลับ')); assert.ok(button('ถัดไป')); assert.equal(calls.length, 0);
  }, false, { scenario: 'failed', startWithPlans: false, returning: true,
    retrySelection: { offer: 'BASIC_499', interval: 'month', purchaseMode: 'CARD_ONCE' }, attempt: returnView('FAILED', 'NONE'),
    quote: () => { throw { code: 'BILLING_MODE_NOT_READY' }; } });
});

test('PAY-2 only a verified not-started attempt says no debit; missing selection has a visible chooser', async () => {
  await withBuyer(async ({ render, button, calls }) => {
    assert.match(render(), /ยังไม่มีการตัดเงิน/);
    button('จ่ายอีกครั้ง').onClick(); const html = render();
    assert.match(html, /ไม่พบแพ็กเกจในรายการเดิม เลือกแพ็กเกจแล้วลองอีกครั้ง/);
    assert.match(html, /aria-label="เลือกแพ็กเกจ"/); assert.equal(calls.length, 0);
  }, false, { scenario: 'failed', startWithPlans: false, returning: true,
    attempt: returnView('FAILED', 'NONE', { state: 'EXPIRED', errorCode: 'BILLING_CHECKOUT_NOT_STARTED' }) });
});

test('PAY-2 follow-up unknown package facts never become overflowing metric sentences or an active badge', async () => {
  await withBuyer(async ({ render }) => {
    const html = render();
    const overview = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('id="billing-history"'));
    assert.match(overview, /<h2[^>]*>ยังไม่มีแพ็กเกจ<\/h2>/);
    assert.doesNotMatch(overview, /mangmee-unit|ยังไม่มีข้อมูลแพ็กเกจ|ยังไม่ระบุ|ยังไม่ได้กำหนดจำนวนใบเสร็จแพ็กเกจ|ใช้งานได้<|ไม่จำกัด/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { tierKey: null, interval: null, termEndsAt: null, paidThrough: null, purchaseSource: 'NO_TERM', usage: { ...status.usage, limit: null, remaining: null } }) });
});

test('PAY-2 follow-up partial facts show only known metrics and keep a zero allowance', async () => {
  await withBuyer(async ({ render }) => {
    const html = render(); const overview = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('id="billing-history"'));
    assert.match(overview, /อ่านใบเสร็จได้อีก/); assert.match(overview, /0/);
    assert.equal((overview.match(/mangmee-unit /g) ?? []).length, 1);
    assert.doesNotMatch(overview, /ยังไม่มีข้อมูลแพ็กเกจ|ยังไม่ระบุ|ไม่จำกัด|mangmee-metric-label[^>]*>แพ็กเกจ/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { tierKey: null, interval: null, termEndsAt: null, paidThrough: null, purchaseSource: 'NO_TERM', usage: { ...status.usage, limit: 0, remaining: 0 } }) });
});

for (const code of ['BILLING_SALES_CLOSED', 'BILLING_COMPANY_SALES_CLOSED']) test(`PAY-2 follow-up ${code} offers phone and email inside the refusal`, async () => {
  await withBuyer(async ({ render }) => {
    const html = render(); const alert = html.slice(html.indexOf('role="alert"'), html.indexOf('aria-label="สถานะแพ็กเกจ"'));
    assert.ok(alert.includes(code === 'BILLING_COMPANY_SALES_CLOSED' ? 'ร้านนี้ยังซื้อหรือเปลี่ยนแพ็กเกจผ่านเว็บไม่ได้ ติดต่อทีมงาน' : 'ยังไม่เปิดรับเงินใหม่ ติดต่อทีมงาน'));
    assert.match(alert, /href="tel:/); assert.match(alert, /href="mailto:/); assert.doesNotMatch(alert, /กรุณา/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { purchaseBlockCode: code, allowedActions: [] }) });
});

test('PAY-2 follow-up automatic charge date precedes the change-package button and email appears only below', async () => {
  await withBuyer(async ({ render }) => {
    const html = render(); const overview = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('id="billing-history"'));
    assert.ok(overview.indexOf('ตัดบัตรอัตโนมัติ') < overview.indexOf('>เปลี่ยนแพ็กเกจ<'));
    assert.doesNotMatch(overview, /ส่งเอกสารไปที่|แก้อีเมลรับเอกสาร/);
  }, false, { startWithPlans: false, scenario: 'success' });
});

test('PAY-2 follow-up review describes receipt reading and preserves package, trial and existing grants', async () => {
  await withBuyer(async ({ render, input, method, next }) => {
    render(); input('offer', 'BASIC_499').onChange(); render(); method('CARD_ONCE'); const html = await next();
    assert.match(html, /อ่านใบเสร็จได้<[^]*50 ใบต่อเดือน/);
    assert.match(html, /อ่านใบเสร็จได้ประมาณ 66 ใบ \(50 ใบของแพ็กเกจ \+ 9 ใบที่เหลือจากช่วงทดลอง \+ 7 ใบที่เพิ่มไว้และยังใช้ได้\)/);
    assert.doesNotMatch(html, /จำนวนใบเสร็จแพ็กเกจ|ยกยอดจากทดลองใช้|รวมหลังจ่ายสำเร็จโดยประมาณ|>ได้รับ</);
  }, false, { quote: quote => ({ ...quote, purchase: { ...quote.purchase!, projectedRemainingReceipts: quote.offer.receiptAllowance + 9 + 7 } }) });
});

test('PAY-2 follow-up cancelling the recipient detour keeps one quote; saving a different recipient asks again once', async () => {
  await withBuyer(async ui => {
    ui.render(); await ui.flushRecipient();
    ui.input('offer', 'STARTER_249').onChange(); ui.render(); ui.method('CARD_ONCE'); await ui.next(); await ui.flushRecipient();
    assert.equal(ui.quoteCalls, 1);
    ui.button('แก้อีเมลรับเอกสาร').onClick(); ui.render(); await ui.flushRecipient();
    ui.button('กลับไปจ่าย').onClick(); ui.render(); await ui.flushRecipient();
    assert.equal(ui.quoteCalls, 1); assert.equal(ui.calls.length, 0);
    ui.changeRecipient('buyer@example.com'); ui.render(); await ui.flushRecipient(); assert.equal(ui.quoteCalls, 1);
    ui.changeRecipient('changed@example.com'); ui.render(); await ui.flushRecipient();
    assert.equal(ui.quoteCalls, 2); assert.equal(ui.calls.length, 0);
    ui.render(); await ui.flushRecipient(); assert.equal(ui.quoteCalls, 2);
  }, false, { status: status => { status.recipient = { email: 'buyer@example.com', source: 'STRIPE_CHECKOUT', bouncedAt: null, canChange: true }; } });
});

test('PAY-2 follow-up back to methods and forward keeps the unchanged quote and consent', async () => {
  await withBuyer(async ui => {
    ui.render(); ui.input('offer', 'STARTER_249').onChange(); ui.render(); ui.method('CARD_AUTO');
    await ui.next(); ui.input('checkbox').onChange({ target: { checked: true } }); ui.render(); await ui.next();
    ui.button('กลับ').onClick(); ui.render(); assert.equal(ui.input('checkbox').checked, true);
    const html = await ui.next(); assert.match(html, /aria-label="ตรวจก่อนจ่าย"/); assert.equal(ui.quoteCalls, 1); assert.equal(ui.calls.length, 0);
  });
});

test('PAY-2 follow-up a partial upgrade says receipts added without claiming a monthly allowance', async () => {
  await withBuyer(async ({ render, input, method, next }) => {
    render(); input('offer', 'PRO_999').onChange(); render(); method('CARD_ONCE'); const html = await next();
    const facts = html.slice(html.indexOf('aria-label="รายละเอียดแพ็กเกจที่จ่าย"'), html.indexOf('</dl>', html.indexOf('aria-label="รายละเอียดแพ็กเกจที่จ่าย"')));
    assert.match(facts, /อ่านใบเสร็จได้เพิ่ม<[^]*7 ใบ/); assert.doesNotMatch(facts, /ใบต่อเดือน|ใบต่อปี/);
  }, false, { scenario: 'one-time', quote: quote => ({ ...quote, purchase: { ...quote.purchase!, receiptUnitsAdded: 7 } }) });
});

test('PAY-2 follow-up the preview pins a saved document recipient into subsequent quotes', async () => {
  const api = createBillingPreview('shop', 'success', null, () => {});
  const original = await api.quote('BASIC_499', 'month', '', undefined, 'CARD_AUTO');
  await api.recipientOtpRequest('changed@example.com', 'request');
  const proof = await api.recipientOtpConfirm('preview-challenge', '123456');
  const operation = await api.recipientPreview(proof.recipientProofId); await api.recipientSubmit(operation);
  const status = await api.status(), next = await api.quote('BASIC_499', 'month', '', undefined, 'CARD_AUTO');
  assert.equal(original.billingEmail, 'preview@example.com'); assert.equal(status.recipient?.email, 'changed@example.com');
  assert.equal(next.billingEmail, status.recipient?.email); assert.equal(status.recipient?.source, 'CUSTOMER_OTP');
});


test('PAY-2b effect replay reads the first history page once, then the next cursor once', async () => {
  const source = createBillingPreview('shop', 'success', null, () => {}), invoice = (await source.history()).items[0];
  const reads: (string | undefined)[] = [];
  await withBuyer(async ({ render, replayInitialLoad, button }) => {
    reads.length = 0; render(); await replayInitialLoad(); render(); assert.deepEqual(reads, [undefined]);
    await button('ถัดไป').onClick(); render(); assert.deepEqual(reads, [undefined, 'older']);
  }, false, { scenario: 'success', startWithPlans: false, history: async cursor => { reads.push(cursor); return { items: [invoice], nextCursor: cursor ? null : 'older' }; } });
});

test('PAY-2b review back restores the capacity selection instead of the payment-method step', async () => {
  await withBuyer(async ({ render, input, method, next, button, capacityPicker, calls }) => {
    render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_AUTO'); await next();
    const picker = capacityPicker(); assert.ok(picker);
    const selection = { sourceHash: picker.options.sourceHash, branchIds: ['ho'], memberships: [{ id: 'owner', defaultBranchId: 'ho' }, { id: 'member-1', defaultBranchId: 'ho' }] };
    await picker.onConfirm(selection); render(); input('checkbox').onChange({ target: { checked: true } }); render();
    assert.match(await next(), /aria-label="ตรวจก่อนจ่าย"/);
    button('กลับ').onClick(); const html = render();
    assert.match(html, /aria-label="เลือกสาขาและผู้ใช้"/); assert.doesNotMatch(html, /aria-label="วิธีจ่าย"|aria-label="ตรวจก่อนจ่าย"/);
    assert.deepEqual(capacityPicker().initialSelection, selection); assert.equal(calls.length, 0);
    capacityPicker().onCancel(selection); render(); input('offer', 'STARTER_249').onChange(); render(); method('CARD_AUTO'); await next();
    assert.deepEqual(capacityPicker().initialSelection, selection);
  }, false, { scenario: 'capacity', captureCapacity: true });
});
for (const code of ['BILLING_NOT_READY', 'BILLING_NOT_CONFIGURED', 'BILLING_PACKAGE_STATE_INVALID', 'BILLING_SOURCE_REVIEW_REQUIRED', 'BILLING_ENTITLEMENT_REVIEW_REQUIRED',
  'BILLING_COLLECTION_CLOSED', 'BILLING_COLLECTION_REVIEW', 'BILLING_RESTART_REVIEW', 'BILLING_REPEAT_REVIEW', 'BILLING_UPGRADE_REVIEW',
  'BILLING_MAPPING_MISMATCH', 'BILLING_DOCUMENT_BINDING', 'BILLING_PRICE_MISMATCH', 'BILLING_TAX_MISMATCH', 'BILLING_PORTAL_CONFIG_MISMATCH',
  'BILLING_MODE_NOT_READY', 'BILLING_REPEAT_NOT_READY', 'BILLING_REFUND_PENDING', 'BILLING_UPGRADE_BOUNDARY',
  'BILLING_CHECKOUT_INVOICE_MISMATCH', 'BILLING_INVOICE_MISMATCH', 'BILLING_DEAL_EXPIRED', 'BILLING_DEAL_NOT_FOUND', 'BILLING_COMPANY_HELD']) test(`PAY-3 ${code} gives phone and email beside the refusal`, async () => {
  await withBuyer(async ({ render }) => {
    const html = render(), alert = html.slice(html.indexOf('role="alert"'), html.indexOf('aria-label="สถานะแพ็กเกจ"'));
    assert.match(alert, /ติดต่อทีมงาน/);
    assert.match(alert, /href="tel:/); assert.match(alert, /href="mailto:/);
    assert.doesNotMatch(alert, /กรุณา|ดำเนินการ|ลองใหม่/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { purchaseBlockCode: code, allowedActions: [] }) });
});

test('PAY-3 company sales refusal appears once with contacts even when the status has no block code', async () => {
  await withBuyer(async ({ render }) => {
    const html = render();
    assert.equal((html.match(/ร้านนี้ยังซื้อหรือเปลี่ยนแพ็กเกจผ่านเว็บไม่ได้ ติดต่อทีมงาน/g) ?? []).length, 1);
    const alert = html.slice(html.indexOf('role="alert"'), html.indexOf('aria-label="สถานะแพ็กเกจ"'));
    assert.match(alert, /href="tel:/); assert.match(alert, /href="mailto:/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { purchaseEligibility: 'COMPANY_SALES_CLOSED', purchaseBlockCode: null, allowedActions: [] }) });
});

test('PAY-3 a quiet package refusal keeps its note and offers contacts in the same card', async () => {
  await withBuyer(async ({ render }) => {
    const html = render(), card = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('id="billing-history"'));
    assert.doesNotMatch(html, /role="alert"/);
    assert.match(card, /role="note"[^]*ติดต่อทีมงาน/);
    assert.match(card, /href="tel:/); assert.match(card, /href="mailto:/);
  }, false, { scenario: 'success', startWithPlans: false, status: status => Object.assign(status, {
    purchaseBlockCode: 'BILLING_REPEAT_NOT_READY', attemptId: null, allowedActions: [], packageChangesEnabled: false }) });
});

test('PAY-3 a refused request offers contact links beside its error', async () => {
  await withBuyer(async ({ render, button }) => {
    render(); await button('จ่ายอีกครั้ง').onClick(); await new Promise(resolve => setImmediate(resolve));
    const html = render(), error = html.slice(html.indexOf('role="alert"'), html.indexOf('aria-label="วิธีจ่าย"'));
    assert.match(error, /วิธีจ่ายที่เลือกยังใช้ไม่ได้ เลือกวิธีอื่นหรือติดต่อทีมงาน/);
    assert.match(error, /href="tel:/); assert.match(error, /href="mailto:/);
  }, false, { scenario: 'failed', startWithPlans: false, returning: true,
    retrySelection: { offer: 'BASIC_499', interval: 'month', purchaseMode: 'CARD_ONCE' }, attempt: returnView('FAILED', 'NONE'),
    quote: () => { throw { code: 'BILLING_MODE_NOT_READY' }; } });
});

test('PAY-3 a returned payment refusal puts contact exits beside its reason', async () => {
  await withBuyer(async ({ render }) => {
    const html = render(), payment = html.slice(html.indexOf('aria-label="ยังไม่ได้รับเงิน"'), html.indexOf('id="billing-history"'));
    assert.match(payment, /ข้อมูลการจ่ายเงินเดิมยังตรวจยืนยันไม่ได้ ติดต่อทีมงาน/);
    assert.match(payment, /href="tel:/); assert.match(payment, /href="mailto:/);
  }, false, { scenario: 'failed', startWithPlans: false, returning: true,
    attempt: { ...returnView('FAILED', 'NONE'), errorCode: 'BILLING_SOURCE_REVIEW_REQUIRED' } });
});


for (const state of [
  { name: 'open payment', paymentState: 'PENDING', applyState: 'NONE' },
  { name: 'unknown payment', paymentState: 'UNKNOWN', applyState: 'NONE' },
  { name: 'waiting return', paymentState: 'PENDING', applyState: 'NONE', returning: true, attempt: returnView('PENDING', 'NONE', { state: 'OPEN' }) },
  { name: 'unconfirmed return', paymentState: 'UNKNOWN', applyState: 'NONE', returning: true, timedOut: true, attempt: returnView('PENDING', 'NONE', { state: 'UNKNOWN' }) },
  { name: 'failed return', paymentState: 'FAILED', applyState: 'NONE', returning: true, attempt: returnView('FAILED', 'NONE') },
  { name: 'received return', paymentState: 'PAID', applyState: 'PENDING', returning: true, attempt: returnView('PAID', 'PENDING') },
  { name: 'held application return', paymentState: 'PAID', applyState: 'HELD', returning: true, attempt: returnView('PAID', 'HELD') },
  { name: 'applied return', paymentState: 'PAID', applyState: 'APPLIED', returning: true, attempt: returnView('PAID', 'APPLIED') },
] as const) test(`PAY-3 ${state.name} keeps the running package facts with a readable receipt unit`, async () => {
  await withBuyer(async ({ render, calls }) => {
    const html = render(), card = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('id="billing-history"'));
    const text = card.replace(/<[^>]+>/g, '');
    assert.match(text, /เติบโต · รายเดือน/); assert.match(text, /อ่านใบเสร็จได้อีก20 ใบ/); assert.match(text, /ใช้ได้ถึง/);
    assert.doesNotMatch(card, />เปลี่ยนแพ็กเกจ<|>ต่ออายุ [^<]*บาท<|>เลือกแพ็กเกจ</); assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, ...state, status: status => Object.assign(status, {
    paymentState: state.paymentState, applyState: state.applyState, accessState: 'ACTIVE', tierKey: 'BASIC_499', interval: 'month',
    paidThrough: '2099-11-18T00:00:00Z', termEndsAt: '2099-11-18T00:00:00Z', purchaseSource: 'PAID_CURRENT_MODE', renewalMode: 'CARD_ONCE',
    attemptId: 'return-attempt', canCancelCheckout: false, allowedActions: [], usage: { ...status.usage, remaining: 20 },
  }) });
});

for (const discounted of [false, true]) test(`FIX-Q1 full-package review states the payable amount, discount=${discounted}`, async () => {
  await withBuyer(async ({ render, input, method, next, pay, calls }) => {
    render(); input('offer', 'PRO_999').onChange(); render(); method('CARD_ONCE');
    const html = await next();
    assert.match(html, /ยอดที่จ่ายวันนี้[^]*899\.00[^]*บาท/);
    assert.match(html, /เต็มแพ็กเพิ่มจากแพ็กเดิม จ่าย 899\.00 บาท ไม่หักค่าแพ็กเดิม/);
    assert.doesNotMatch(html, /จ่ายราคาเต็ม/);
    await pay().onClick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.quoteId, 'preview-quote');
  }, false, { scenario: 'one-time', quote: quote => ({ ...quote, totalSatang: discounted ? 99900 : 89900,
    purchase: { ...quote.purchase!, kind: 'FULL_PACKAGE_UPGRADE' },
    ...(discounted ? { eventDiscount: { choice: 'USE', ticketSerial: 'ticket', eventName: 'ส่วนลด', expiresAt: quote.expiresAt,
      discountSatang: 10000, shownDiscountSatang: 10000,
      applied: { unitAmountSatang: 89900, subtotalSatang: 89900, taxSatang: 0, totalSatang: 89900 } } } : {}),
  }) });
});

for (const scenario of ['deal', 'deal-auto'] as const) test(`FIX-Q1 ${scenario} review names the purchased term`, async () => {
  await withBuyer(async ({ render, button, input, next }) => {
    render(); button('เลือกข้อเสนอนี้').onClick(); render(); await next();
    if (scenario === 'deal-auto') { input('checkbox').onChange({ target: { checked: true } }); render(); await next(); }
    const html = render();
    assert.match(html, scenario === 'deal' ? /มืออาชีพ · 12 เดือน/ : /มืออาชีพ · รายเดือน/);
    if (scenario === 'deal') assert.doesNotMatch(html, /มืออาชีพ · รายเดือน/);
  }, false, { scenario });
});

test('FIX-Q2 billing overview has one bounce warning and one control for the current QR bill', async () => {
  await withBuyer(async ({ render }) => {
    const html = render();
    assert.equal((html.match(/อีเมลรับเอกสารส่งไม่ถึง แก้ไขได้ที่นี่/g) ?? []).length, 1);
    assert.equal((html.match(/>เปิดบิลพร้อมเพย์<|>จ่ายบิลงวดนี้</g) ?? []).length, 1);
    assert.match(html, />เปิดบิลพร้อมเพย์</);
  }, false, { startWithPlans: false, scenario: 'success', status: status => {
    status.renewalMode = 'PROMPTPAY_RENEW'; status.renewalInvoiceUrl = 'https://invoice.stripe.com/test';
    status.recipient = { email: 'owner@example.com', bouncedAt: '2026-10-18T00:00:00.000Z', source: 'STRIPE_CHECKOUT', canChange: true };
  } });
});

test('FIX-Q2 paid result keeps its receipt as primary and the QR bill secondary', async () => {
  await withBuyer(async ({ render, button }) => {
    render();
    assert.match(button('ดูใบเสร็จรับเงิน').className, /primary/);
    assert.match(button('เปิดบิลพร้อมเพย์').className, /secondary/);
  }, false, { returning: true, attempt: returnView('PAID', 'APPLIED'), startWithPlans: false, scenario: 'success', status: status => {
    status.renewalMode = 'PROMPTPAY_RENEW'; status.renewalInvoiceUrl = 'https://invoice.stripe.com/test';
  } });
});

test('MONEY-Q1 below-minimum upgrade keeps contact links beside its specific refusal', async () => {
  await withBuyer(async ({ render, input, method, next, calls }) => {
    render(); input('offer', 'BASIC_499').onChange(); render(); method('CARD_ONCE');
    const html = await next(), alert = html.match(/role="alert"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    assert.match(alert, /ส่วนต่างต่ำกว่า 10\.00 บาท/);
    assert.match(alert, /href="tel:/); assert.match(alert, /href="mailto:/);
    assert.equal(calls.length, 0);
  }, false, { quote: () => { throw { code: 'BILLING_UPGRADE_BELOW_MINIMUM', status: 409 }; } });
});
