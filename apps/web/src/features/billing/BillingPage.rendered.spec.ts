import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createBillingPreview } from './billing-preview.fixture';
import type { BillingAttemptView, BillingPurchaseMode, BillingQuote, BillingStatus } from '@watchdog-bms/contracts';

(globalThis as any).React = React;
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const BillingPage = require('./BillingPage').default;
const { BillingWorkspaceContext } = require('./BillingCustomerFrame');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const runtime = require('react') as typeof React;
const words = (node: any): string => Array.isArray(node) ? node.map(words).join('') : React.isValidElement(node) ? words((node.props as any).children) : node == null || typeof node === 'boolean' ? '' : String(node);

async function withBuyer(run: (ui: { render: () => string; button: (name: string) => any; input: (name: string, value?: string) => any; calls: any[] }) => Promise<void>, unavailable = false, customize?: { returning?: boolean; attempt?: BillingAttemptView; timedOut?: boolean; checkoutCanceled?: boolean; startWithPlans?: boolean; quote?: (quote: BillingQuote) => BillingQuote; status?: (status: BillingStatus) => void }) {
  const api = createBillingPreview('shop', 'start', null, () => {});
  const originalQuote = api.quote;
  if (customize?.quote) api.quote = async (...args) => customize.quote!(await originalQuote(...args));
  const status = await api.status(); customize?.status?.(status);
  if (unavailable) { status.enabledPurchaseModes = ['CARD_ONCE']; status.availablePurchaseModes = ['CARD_ONCE']; }
  if (customize?.status) api.status = async () => status;
  const data = { status, catalog: await api.catalog(), history: await api.history() };
  const calls: any[] = [];
  api.checkout = async (body, key) => { calls.push({ body, key }); return { attemptId: 'attempt', state: 'OPEN', checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }; };
  const originalState = runtime.useState, originalRef = runtime.useRef, originalCreate = runtime.createElement;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' } } });
  const states: any[] = [], refs: any[] = [];
  let cursor = 0, refCursor = 0, elements: { type: string; props: any; children: any[] }[] = [];
  Reflect.set(runtime, 'useState', (initial: any) => {
    const index = cursor++; const [value] = (originalState as any)(initial);
    if (!(index in states)) states[index] = index === 2 ? data : index === 29 && customize?.timedOut ? true : index === 31 && customize?.attempt ? customize.attempt : index === 35 && customize?.checkoutCanceled ? true : value;
    return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  });
  Reflect.set(runtime, 'useRef', (initial: any) => { const index = refCursor++; const ref = originalRef(initial); return refs[index] ?? (refs[index] = ref); });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (typeof type === 'string') elements.push({ type, props, children });
    return (originalCreate as any)(type, props, ...children);
  });
  const noop = () => undefined;
  const render = () => {
    cursor = 0; refCursor = 0; elements = [];
    return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push: noop, replace: noop, prefetch: noop } as any },
      React.createElement(BillingWorkspaceContext.Provider, { value: true }, React.createElement(BillingPage, { companyId: 'shop', returning: customize?.returning, returnAttemptId: customize?.returning ? 'return-attempt' : null, preview: { api, navigate: noop, openDocumentHistory: noop, startWithPlans: customize?.startWithPlans ?? true } }))));
  };
  const button = (name: string) => { const el = elements.find(el => el.type === 'button' && words(el.children) === name); assert.ok(el, name); return el.props; };
  const input = (name: string, value?: string) => { const el = elements.find(el => el.type === 'input' && (name === 'checkbox' ? el.props.type === name : el.props.name === name && (value === undefined || el.props.value === value))); assert.ok(el, `${name} ${value}`); return el.props; };
  try { await run({ render, button, input, calls }); }
  finally { Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'useRef', originalRef); Reflect.set(runtime, 'createElement', originalCreate); if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window'); }
}

test('D1 mounted chooser shows all four unchecked methods, monthly first, and missing-method feedback', async () => {
  await withBuyer(async ({ render, button, input, calls }) => {
    const html = render(); assert.equal((html.match(/name="purchaseMode"/g) ?? []).length, 4);
    for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW']) assert.equal(input('purchaseMode', mode).checked, false);
    assert.equal(button('รายเดือน')['aria-pressed'], true);
    await button('ดูยอดที่ต้องจ่าย').onClick(); assert.match(render(), /เลือกแพ็กเกจก่อน/);
    input('offer', 'STARTER_249').onChange(); render(); await button('ดูยอดที่ต้องจ่าย').onClick();
    assert.match(render(), /เลือกวิธีจ่ายก่อน/); assert.equal(calls.length, 0);
  });
});

test('D1 unavailable methods stay visible, disabled, with a reason and contact link', async () => {
  await withBuyer(async ({ render, input }) => {
    assert.match(render(), /ยังไม่เปิดใช้วิธีนี้/); assert.equal(input('purchaseMode', 'PROMPTPAY_ONCE').disabled, true);
    assert.equal(input('purchaseMode', 'CARD_ONCE').disabled, false); assert.match(render(), /ติดต่อทีมงานมั่งมี/);
  }, true);
});

for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE', 'CARD_AUTO', 'PROMPTPAY_RENEW'] as BillingPurchaseMode[]) {
  test(`D1 ${mode}: only an explicit accepted purchase press sends the quote and revision`, async () => {
    await withBuyer(async ({ render, button, input, calls }) => {
      render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', mode).onChange(); render();
      await button('ดูยอดที่ต้องจ่าย').onClick(); const review = render(); assert.equal(calls.length, 0);
      const once = mode.endsWith('_ONCE');
      assert.equal(review.includes('type="checkbox"'), !once);
      assert.equal(Boolean(button('ยืนยันซื้อและไปจ่ายเงิน')['aria-disabled']), !once);
      if (once) { assert.match(review, /กดยืนยันซื้อ คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง/); assert.equal((review.match(/฿249\.00/g) ?? []).length, 1); }
      else { assert.equal(input('checkbox').checked, false); input('checkbox').onChange({ target: { checked: true } }); render(); }
      await button('ยืนยันซื้อและไปจ่ายเงิน').onClick();
      assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { quoteId: 'preview-quote', consentRevision: 'preview-consent', accepted: true, channel: 'web' }); assert.ok(calls[0].key);
    });
  });
}

test('D1 changing cadence or payment method requires a fresh review before checkout', async () => {
  await withBuyer(async ({ render, button, input, calls }) => {
    render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', 'CARD_ONCE').onChange(); render(); await button('ดูยอดที่ต้องจ่าย').onClick(); render();
    button('กลับ').onClick(); render(); button('รายปี').onClick(); input('purchaseMode', 'PROMPTPAY_ONCE').onChange();
    assert.doesNotMatch(render(), /กดยืนยันซื้อ คือยอมรับ/); assert.equal(calls.length, 0);
    await button('ดูยอดที่ต้องจ่าย').onClick(); assert.match(render(), /ตรวจก่อนจ่าย/); assert.equal(calls.length, 0);
  });
});

test('D1 an expired quote cannot submit even before its expiry timer paints the refresh control', async () => {
  const now = Date.now;
  try {
    await withBuyer(async ({ render, button, input, calls }) => {
      render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', 'CARD_ONCE').onChange(); render();
      await button('ดูยอดที่ต้องจ่าย').onClick(); render();
      const afterExpiry = now() + 3 * 86_400_000;
      Date.now = () => afterExpiry;
      await button('ยืนยันซื้อและไปจ่ายเงิน').onClick(); assert.equal(calls.length, 0);
    });
  } finally { Date.now = now; }
});

for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) for (const interval of ['month', 'year'] as const) {
  test(`D2 ${mode} ${interval}: flat review, explicit cadence consent, early press cannot buy`, async () => {
    await withBuyer(async ({ render, button, input, calls }) => {
      render(); if (interval === 'year') { button('รายปี').onClick(); render(); }
      input('offer', 'STARTER_249').onChange(); input('purchaseMode', mode).onChange(); render();
      await button('ดูยอดที่ต้องจ่าย').onClick(); const html = render();
      const cadence = interval === 'year' ? 'ปี' : 'เดือน';
      assert.match(html, /aria-label="ตรวจก่อนจ่าย"/);
      assert.ok(html.includes(mode === 'CARD_AUTO' ? `เลือกบัตรที่หน้าจ่ายเงิน บัตรใบนั้นจะใช้ต่ออายุอัตโนมัติทุก${cadence}` : `ระบบออกบิลทุก${cadence} ต้องสแกนจ่ายเอง ไม่มีการหักเงินอัตโนมัติ`));
      assert.ok(html.includes(mode === 'CARD_AUTO' ? `ยอมรับการตัดบัตรอัตโนมัติทุก${cadence}` : `ยอมรับการออกบิลพร้อมเพย์ทุก${cadence}`));
      assert.equal((html.match(/จ่ายวันนี้/g) ?? []).length, 1);
      assert.equal((html.match(interval === 'year' ? /฿2,490\.00/g : /฿249\.00/g) ?? []).length, 1);
      assert.ok(html.includes(mode === 'CARD_AUTO' ? 'ตัดบัตรครั้งถัดไปโดยประมาณ' : 'ออกบิลครั้งถัดไปโดยประมาณ'));
      assert.equal(input('checkbox').checked, false);
      assert.equal(button('ยืนยันซื้อและไปจ่ายเงิน')['aria-disabled'], true);
      let focused = false; input('checkbox').ref.current = { focus: () => { focused = true; } };
      await button('ยืนยันซื้อและไปจ่ายเงิน').onClick();
      assert.match(render(), /ติ๊กยอมรับการต่ออายุก่อน/); assert.equal(focused, true); assert.equal(calls.length, 0);
      input('checkbox').onChange({ target: { checked: true } });
      assert.doesNotMatch(render(), /ติ๊กยอมรับการต่ออายุก่อน/);
      assert.equal(button('ยืนยันซื้อและไปจ่ายเงิน')['aria-disabled'], false);
      await button('ยืนยันซื้อและไปจ่ายเงิน').onClick();
      assert.deepEqual(calls[0].body, { quoteId: 'preview-quote', consentRevision: 'preview-consent', accepted: true, channel: 'web' });
    });
  });
}
for (const change of ['package', 'cadence', 'method'] as const) {
  test(`D2 ${change} change requires a new unchecked renewal review`, async () => {
    await withBuyer(async ({ render, button, input, calls }) => {
      render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', 'CARD_AUTO').onChange(); render();
      await button('ดูยอดที่ต้องจ่าย').onClick(); render(); input('checkbox').onChange({ target: { checked: true } }); render();
        button('กลับ').onClick(); render();
        if (change === 'package') input('offer', 'BASIC_499').onChange();
        if (change === 'cadence') button('รายปี').onClick();
        if (change === 'method') input('purchaseMode', 'PROMPTPAY_RENEW').onChange();
        render(); await button('ดูยอดที่ต้องจ่าย').onClick();
      render(); assert.equal(input('checkbox').checked, false); assert.equal(calls.length, 0);
      await button('ยืนยันซื้อและไปจ่ายเงิน').onClick(); assert.equal(calls.length, 0);
    });
  });
}

for (const canManageCard of [false, true]) test(`D2 provider card management is offered only when the read allows it: ${canManageCard}`, async () => {
  await withBuyer(async ({ render, button, input }) => {
    render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', 'CARD_AUTO').onChange(); render();
    await button('ดูยอดที่ต้องจ่าย').onClick();
    assert.equal(render().includes('จัดการบัตรที่ใช้ต่ออายุ'), canManageCard);
  }, false, { status: status => { status.allowedActions = canManageCard ? ['new_sales', 'portal_payment_method'] : ['new_sales']; } });
});

test('D2 next date is omitted when the quote supplies none', async () => {
  await withBuyer(async ({ render, button, input }) => {
    render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', 'CARD_AUTO').onChange(); render();
    await button('ดูยอดที่ต้องจ่าย').onClick(); assert.doesNotMatch(render(), /ตัดบัตรครั้งถัดไปโดยประมาณ/);
  }, false, { quote: quote => ({ ...quote, purchase: undefined }) });
});

test('D2 repeat keeps its own facts and consent follows the pending renewal cadence', async () => {
  await withBuyer(async ({ render, button, input }) => {
    render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', 'CARD_AUTO').onChange(); render();
    await button('ดูยอดที่ต้องจ่าย').onClick(); const html = render();
    assert.match(html, /ตรวจก่อนจ่าย/); assert.match(html, /ยอมรับการตัดบัตรอัตโนมัติทุกปี/);
    assert.match(html, /ใบเสร็จที่เพิ่ม/); assert.doesNotMatch(html, /เลือกบัตรที่หน้าจ่ายเงิน/);
  }, false, { quote: quote => ({ ...quote, purchase: { ...quote.purchase!, kind: 'REPEAT' },
    pendingPlanChange: { operationId: 'change', oldEffectiveAt: '2027-01-01T00:00:00Z', newEffectiveAt: '2027-02-01T00:00:00Z', offer: { ...quote.offer, interval: 'year' }, totalSatang: 249000, capacity: { retainedBranches: [], retainedMembers: [], suspendedBranches: [], suspendedMembers: [], defaults: [] } } }) });
});

test('D2b missing choices are red field errors before options, and cadence has a visible selected style', async () => {
  await withBuyer(async ({ render, button, input }) => {
    render(); assert.notEqual(button('รายเดือน').className, button('รายปี').className);
    await button('ดูยอดที่ต้องจ่าย').onClick(); const offers = render();
    assert.match(offers, /text-red-600[^>]*>เลือกแพ็กเกจก่อน/);
    assert.ok(offers.indexOf('เลือกแพ็กเกจก่อน') < offers.indexOf('name="offer"'));
    input('offer', 'STARTER_249').onChange(); render(); await button('ดูยอดที่ต้องจ่าย').onClick(); const modes = render();
    assert.match(modes, /text-red-600[^>]*>เลือกวิธีจ่ายก่อน/);
    assert.ok(modes.indexOf('เลือกวิธีจ่ายก่อน') < modes.indexOf('name="purchaseMode"'));
  });
});

for (const [tierKey, label] of [['STARTER_249', 'เริ่มต้น'], ['BASIC_499', 'เติบโต'], ['PRO_999', 'มืออาชีพ'], ['ENTERPRISE_1999', 'ธุรกิจ']] as const) {
  test(`D2b paid ${tierKey} keeps its Thai shop name`, async () => {
    await withBuyer(async ({ render }) => {
      const html = render();
      assert.ok(html.includes(`>${label}</dd>`));
      assert.doesNotMatch(html, /\((STARTER|BASIC|PRO|ENTERPRISE)\)/);
    }, false, { startWithPlans: false, status: status => {
      status.accessState = 'ACTIVE'; status.paymentState = 'PAID'; status.applyState = 'APPLIED'; status.tierKey = tierKey;
    } });
  });
}

for (const taxTreatment of ['NOT_VAT_REGISTERED', 'INCLUSIVE_VAT_7', 'EXCLUSIVE_VAT_7'] as const) {
  test(`D2b ${taxTreatment}: review keeps payable tax facts and omits redundant first-purchase copy`, async () => {
    await withBuyer(async ({ render, button, input }) => {
      render(); input('offer', 'STARTER_249').onChange(); input('purchaseMode', 'CARD_ONCE').onChange(); render();
      await button('ดูยอดที่ต้องจ่าย').onClick(); const html = render();
      assert.doesNotMatch(html, /ไม่มีวันแพ็กเกจเดิมให้ทบ|โควตา|ยังไม่ได้จด VAT/);
      if (taxTreatment === 'NOT_VAT_REGISTERED') assert.doesNotMatch(html, /ราคาก่อนภาษี|VAT 7%/);
      else { assert.match(html, /ราคาก่อนภาษี/); assert.match(html, taxTreatment === 'INCLUSIVE_VAT_7' ? /ราคารวม VAT 7% แล้ว/ : /ราคาเพิ่ม VAT 7%/); }
      assert.equal((html.match(/จ่ายวันนี้/g) ?? []).length, 1);
      assert.match(html, /กดยืนยันซื้อ คือยอมรับแพ็กเกจ ยอดเงิน และเงื่อนไขที่แสดง/);
    }, false, { quote: quote => ({ ...quote, previousSource: 'NO_TERM', taxTreatment,
      subtotalSatang: taxTreatment === 'INCLUSIVE_VAT_7' ? 23271 : 24900,
      taxSatang: taxTreatment === 'NOT_VAT_REGISTERED' ? 0 : taxTreatment === 'INCLUSIVE_VAT_7' ? 1629 : 1743,
      totalSatang: taxTreatment === 'EXCLUSIVE_VAT_7' ? 26643 : 24900 }) });
  });
}

for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE', 'CARD_AUTO', 'PROMPTPAY_RENEW'] as const) for (const cadence of ['month', 'year'] as const) {
  test(`D3 explicit repeat ${mode} ${cadence} prefills compatible choices and reviews one extension`, async () => {
    const previous = '2098-01-01T00:00:00.000Z', next = '2099-01-01T00:00:00.000Z';
    await withBuyer(async ({ render, button, input, calls }) => {
      render(); button('ซื้อแพ็กเกจเดิมเพิ่ม').onClick(); render();
      assert.equal(input('offer', 'STARTER_249').checked, true);
      assert.equal(input('purchaseMode', mode).checked, true);
      assert.equal(button(cadence === 'year' ? 'รายปี' : 'รายเดือน')['aria-pressed'], true);
      await button('ดูยอดที่ต้องจ่าย').onClick(); const html = render();
      assert.match(html, /aria-label="ตรวจก่อนจ่าย"/);
      assert.match(html, /ใบเสร็จที่เพิ่ม/); assert.match(html, /ใช้ได้ถึงโดยประมาณ/);
      assert.match(html, /2641/); assert.match(html, /2642/);
      assert.equal((html.match(/จ่ายวันนี้/g) ?? []).length, 1);
      assert.equal(html.includes('ตัดบัตรครั้งถัดไป'), mode === 'CARD_AUTO');
      assert.equal(html.includes('ออกบิลครั้งถัดไป'), mode === 'PROMPTPAY_RENEW');
      assert.equal(html.includes('type="checkbox"'), !mode.endsWith('_ONCE'));
      if (!mode.endsWith('_ONCE')) assert.equal(input('checkbox').checked, false);
      assert.equal(calls.length, 0);
      button('กลับ').onClick(); render(); input('offer', 'BASIC_499').onChange(); render();
      assert.equal(input('offer', 'BASIC_499').checked, true);
    }, false, { startWithPlans: false, status: status => Object.assign(status, { tierKey: 'STARTER_249', interval: cadence, paidThrough: previous, renewalMode: mode, accessState: 'ACTIVE', subscriptionState: mode.endsWith('_ONCE') ? 'NONE' : 'active' }),
      quote: quote => ({ ...quote, purchase: { kind: 'REPEAT', previousPaidThrough: previous, projectedPaidThrough: next, receiptUnitsAdded: cadence === 'year' ? 360 : 30, projectedRemainingReceipts: 400 } }) });
  });
}

test('D3 an incompatible previous method is not prefilled or silently replaced', async () => {
  await withBuyer(async ({ render, button, input, calls }) => {
    render(); button('ซื้อแพ็กเกจเดิมเพิ่ม').onClick(); render();
    for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW']) assert.equal(input('purchaseMode', mode).checked, false);
    await button('ดูยอดที่ต้องจ่าย').onClick(); assert.match(render(), /เลือกวิธีจ่ายก่อน/); assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'month', renewalMode: 'CARD_AUTO', enabledPurchaseModes: ['PROMPTPAY_ONCE'], availablePurchaseModes: ['PROMPTPAY_ONCE'] }) });
});

test('D3 an issued QR bill keeps the original URL and offers no new purchase on the overview', async () => {
  await withBuyer(async ({ render, button, calls }) => {
    let html = render(); assert.match(html, /มีบิลต่ออายุรอจ่าย/);
    assert.doesNotMatch(html, />ซื้อแพ็กเกจเดิมเพิ่ม<|>เลือกแพ็กเกจ<|>ซื้อหรือเปลี่ยนแพ็กเกจ</);
    button('การต่ออายุและจ่ายเงิน').onClick(); html = render();
    assert.match(html, /เปิดบิลพร้อมเพย์/); assert.match(html, /สแกน QR เพื่อจ่ายบิลเดิม ระบบไม่หักเงินอัตโนมัติ/);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'month', renewalMode: 'PROMPTPAY_RENEW', renewalInvoiceUrl: 'https://invoice.stripe.com/i/original' }) });
});

test('D3 changing cadence cannot quote a prefilled offer that the read now disables', async () => {
  await withBuyer(async ({ render, button, input }) => {
    render(); button('ซื้อแพ็กเกจเดิมเพิ่ม').onClick(); render(); button('รายปี').onClick(); render();
    assert.equal(input('offer', 'STARTER_249').disabled, true);
    await button('ดูยอดที่ต้องจ่าย').onClick();
    const html = render(); assert.match(html, /เลือกแพ็กเกจก่อน/); assert.doesNotMatch(html, /aria-label="ตรวจก่อนจ่าย"/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'month', renewalMode: 'CARD_ONCE', packageChangesEnabled: false }) });
});

for (const fromTopUp of [false, true]) test(`explicit package change prefills yearly card choices (after top-up: ${fromTopUp}) and keeps them changeable`, async () => {
  await withBuyer(async ({ render, button, input, calls }) => {
    render();
    if (fromTopUp) { button('ซื้อแพ็กเกจเดิมเพิ่ม').onClick(); render(); button('กลับ').onClick(); render(); }
    button('ซื้อหรือเปลี่ยนแพ็กเกจ').onClick(); render();
    assert.equal(button('รายปี')['aria-pressed'], true);
    assert.equal(input('purchaseMode', 'CARD_AUTO').checked, true);
    button('รายเดือน').onClick(); input('purchaseMode', 'CARD_ONCE').onChange(); render();
    assert.equal(button('รายเดือน')['aria-pressed'], true);
    assert.equal(input('purchaseMode', 'CARD_ONCE').checked, true);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'year', renewalMode: 'CARD_AUTO', subscriptionState: 'active' }) });
});

test('explicit package change never prefills an incompatible payment method', async () => {
  await withBuyer(async ({ render, button, input }) => {
    render(); button('ซื้อหรือเปลี่ยนแพ็กเกจ').onClick(); render();
    assert.equal(button('รายปี')['aria-pressed'], true);
    for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW']) assert.equal(input('purchaseMode', mode).checked, false);
    assert.equal(input('purchaseMode', 'CARD_AUTO').disabled, true);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paidThrough: '2099-01-01', tierKey: 'STARTER_249', interval: 'year', renewalMode: 'CARD_AUTO', subscriptionState: 'active', enabledPurchaseModes: ['PROMPTPAY_ONCE'], availablePurchaseModes: ['PROMPTPAY_ONCE'] }) });
});

test('first purchase entry still opens monthly with all payment methods unchecked', async () => {
  await withBuyer(async ({ render, button, input, calls }) => {
    render(); button('เลือกแพ็กเกจ').onClick(); render();
    assert.equal(button('รายเดือน')['aria-pressed'], true);
    for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW']) assert.equal(input('purchaseMode', mode).checked, false);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false });
});



for (const [state, apply, heading] of [
  ['UNKNOWN', 'NONE', 'ยังไม่ทราบผลการจ่ายเงิน'],
  ['PAID', 'PENDING', 'ได้รับเงินแล้ว กำลังเปิดแพ็กเกจ'],
  ['PAID', 'HELD', 'ได้รับเงินแล้ว ทีมงานกำลังตรวจสอบ'],
] as const) test(`D5 mounted ${state}/${apply}: one state block without an access badge or a second purchase`, async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render();
    assert.match(html, new RegExp(`<h2[^>]*>${heading}</h2>`));
    assert.match(html, new RegExp(`aria-label="${heading}" class="space-y-4"`));
    const overview = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('<div hidden=""'));
    assert.doesNotMatch(overview, /mangmee-badge/);
    assert.doesNotMatch(overview, />เลือกแพ็กเกจ<|>ซื้อแพ็กเกจเดิมเพิ่ม<|จ่ายเงินไม่สำเร็จ/);
    assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
    if (state === 'PAID') assert.doesNotMatch(overview, />จ่ายต่อ<|>ยกเลิกรายการนี้</);
    if (apply === 'HELD') { assert.match(html, /เลขอ้างอิง/); assert.match(html, /mailto:/); }
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paymentState: state, applyState: apply, attemptId: 'original', reference: 'original', canCancelCheckout: state === 'UNKNOWN', allowedActions: ['new_sales'] }) });
});

for (const paymentState of ['PENDING', 'FAILED', 'PAID'] as const) test(`D5 return attempt ${paymentState} outranks stale subscription failure and timeout`, async () => {
  const attempt: BillingAttemptView = { attemptId: 'return-attempt', state: 'OPEN', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState, applyState: paymentState === 'PAID' ? 'PENDING' : 'NONE' };
  await withBuyer(async ({ render, button }) => {
    const html = render();
    if (paymentState === 'FAILED') assert.match(html, /<h2[^>]*>จ่ายเงินไม่สำเร็จ<\/h2>/);
    else assert.doesNotMatch(html, /<h2[^>]*>จ่ายเงินไม่สำเร็จ/);
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
    assert.doesNotMatch(html, /<h2[^>]*>จ่ายเงินไม่สำเร็จ|>เลือกแพ็กเกจ<|>ซื้อแพ็กเกจเดิมเพิ่ม</);
  }, false, { startWithPlans: false, returning: true, attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { paymentState: 'PENDING', attemptId: 'newer-attempt', canCancelCheckout: true, allowedActions: ['new_sales'] }) });
});


test('D5 a cancelled redirect with an ordinary pending attempt still ends in one press', async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render(); assert.match(html, /มีรายการจ่ายเงินที่ยังไม่เสร็จ/);
    assert.doesNotMatch(html, /จ่ายเงินไม่สำเร็จ/);
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

for (const applyState of ['PENDING', 'HELD'] as const) test(`D5 refresh of paid ${applyState} never retracts the received money`, async () => {
  await withBuyer(async ({ render, button }) => {
    render(); button('ตรวจผลการจ่ายเงิน').onClick(); await new Promise(resolve => setImmediate(resolve));
    const html = render(); assert.match(html, /ส่งคำขอตรวจสอบแล้ว กดอัปเดตข้อมูลเพื่อดูผลล่าสุด/);
    assert.doesNotMatch(html, /ยังไม่ใช่ผลยืนยันการจ่ายเงิน/);
  }, false, { startWithPlans: false, status: status => Object.assign(status, { paymentState: 'PAID', applyState, attemptId: 'original', allowedActions: [] }) });
});

test('DQ4b failed purchase offers the existing chooser without a check or nested no-package box', async () => {
  await withBuyer(async ({ render, button }) => {
    const html = render(), overview = html.slice(html.indexOf('aria-label="สถานะแพ็กเกจ"'), html.indexOf('<div hidden=""'));
    assert.doesNotMatch(overview, /<dl[^>]*rounded|ยังไม่มีแพ็กเกจ/);
    assert.match(overview, /เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้/);
    assert.match(overview, /mangmee-actions[^]*เลือกแพ็กเกจ</);
    assert.doesNotMatch(overview, />ตรวจผลการจ่ายเงิน</);
    assert.match(button('เลือกแพ็กเกจ').className, /mangmee-btn-primary/);
    button('เลือกแพ็กเกจ').onClick();
    assert.match(render(), /aria-label="เลือกแพ็กเกจ"/);
    assert.equal(button('รายเดือน')['aria-pressed'], true);
  }, false, { startWithPlans: false, returning: true, attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { paymentState: 'NONE', attemptId: null, canCancelCheckout: false, allowedActions: ['new_sales'] }) });
});


test('DQ3 a failed return with no new-sales permission keeps the original check and cannot start another purchase', async () => {
  await withBuyer(async ({ render, button, calls }) => {
    const html = render();
    assert.match(html, /<h2[^>]*>จ่ายเงินไม่สำเร็จ<\/h2>/);
    assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
    assert.doesNotMatch(html, /เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้|ยังไม่เปิดรับการจ่ายเงินใหม่ ลองอีกครั้งภายหลัง/);
    assert.doesNotMatch(html, />เลือกแพ็กเกจ<|>ซื้อหรือเปลี่ยนแพ็กเกจ<|>ซื้อแพ็กเกจเดิมเพิ่ม<|>จ่ายต่อ<|>ยกเลิกรายการนี้</);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, returning: true,
    attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { paymentState: 'FAILED', attemptId: 'return-attempt', canCancelCheckout: false, allowedActions: [] }) });
});


for (const purchaseBlockCode of ['BILLING_SALES_CLOSED', 'BILLING_COMPANY_SALES_CLOSED']) test(`DQ4b ${purchaseBlockCode} explains the failed purchase without inviting another payment`, async () => {
  await withBuyer(async ({ render, button, calls }) => {
    const html = render();
    assert.match(html, /aria-label="จ่ายเงินไม่สำเร็จ"[^]*ยังไม่เปิดรับการจ่ายเงินใหม่ ลองอีกครั้งภายหลัง/);
    assert.equal(html.split("ยังไม่เปิดรับการจ่ายเงินใหม่ ลองอีกครั้งภายหลัง").length - 1, 1);
    assert.doesNotMatch(html, /role="alert"/);
    assert.equal(button('ตรวจผลการจ่ายเงิน').disabled, false);
    assert.doesNotMatch(html, /เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้|>เลือกแพ็กเกจ<|>ซื้อหรือเปลี่ยนแพ็กเกจ</);
    assert.equal(calls.length, 0);
  }, false, { startWithPlans: false, returning: true,
    attempt: { attemptId: 'return-attempt', state: 'FAILED', observedAt: '2026-10-14T00:00:00Z', errorCode: null, invoiceReference: null, paymentState: 'FAILED', applyState: 'NONE' },
    status: status => Object.assign(status, { purchaseBlockCode, paymentState: 'NONE', attemptId: null, canCancelCheckout: false, allowedActions: [] }) });
});
