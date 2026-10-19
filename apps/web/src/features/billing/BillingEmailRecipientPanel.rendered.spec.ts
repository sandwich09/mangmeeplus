import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingEmailRecipientPanel } from './BillingEmailRecipientPanel';
import { createBillingPreview } from './billing-preview.fixture';

(globalThis as any).React = React;
const runtime = require('react') as typeof React;

for (const accessState of ['ACTIVE', 'EXPIRED'] as const) test(`FIX-Q1 recipient verification links to the member account when ${accessState}`, async () => {
  const api = createBillingPreview('shop', 'start', null, () => {});
  const status = { ...await api.status(), accessState };
  const original = runtime.useState;
  let cursor = 0;
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const state = (original as any)(initial), index = cursor++;
    if (index === 9) return ['ต้องยืนยันอีเมลบัญชี', state[1]];
    if (index === 10) return ['BILLING_EMAIL_VERIFICATION_REQUIRED', state[1]];
    return state;
  });
  try {
    const html = renderToStaticMarkup(React.createElement(BillingEmailRecipientPanel, { companyId: 'shop', status, apiOverride: api }));
    assert.match(html, /href="\/companies\/shop\/account"[^>]*>ไปที่บัญชีของฉัน/);
    assert.doesNotMatch(html, /settings\/profile|\/account\/email/);
  } finally { Reflect.set(runtime, 'useState', original); }
});

const textOf = (nodes: any): string => Array.isArray(nodes) ? nodes.map(textOf).join('') : React.isValidElement(nodes) ? textOf((nodes.props as any).children) : nodes == null || typeof nodes === 'boolean' ? '' : String(nodes);

async function withRecipient(run: (ui: any) => Promise<void>, seed: Record<number, unknown> = {}) {
  const api = createBillingPreview('shop', 'success', null, () => {}), status = await api.status();
  const originalState = runtime.useState, originalEffect = runtime.useEffect, originalCreate = runtime.createElement;
  const states: any[] = [], effects: Array<() => any> = [];
  let cursor = 0, elements: any[] = [];
  Reflect.set(runtime, 'useState', (initial: any) => {
    const index = cursor++, state = (originalState as any)(initial);
    if (!(index in states)) states[index] = index in seed ? seed[index] : state[0];
    return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  });
  Reflect.set(runtime, 'useEffect', (effect: () => any) => { effects.push(effect); });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (typeof type === 'string') elements.push({ type, props, text: textOf(children) });
    return (originalCreate as any)(type, props, ...children);
  });
  const render = () => {
    cursor = 0; elements = []; effects.length = 0;
    return renderToStaticMarkup(React.createElement(BillingEmailRecipientPanel, { companyId: 'shop', status, apiOverride: api }));
  };
  const button = (name: string | RegExp) => {
    const found = elements.find(el => el.type === 'button' && (typeof name === 'string' ? el.text === name : name.test(el.text)));
    assert.ok(found, String(name)); return found.props;
  };
  try { await run({ api, render, button, effects }); }
  finally { Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'useEffect', originalEffect); Reflect.set(runtime, 'createElement', originalCreate); }
}

test('FIX-Q2 recipient rate-limit countdown runs on the email-choice step and re-enables the request', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalNow = Date.now;
  let now = 100_000, tick: (() => void) | undefined, cleared = false;
  Date.now = () => now;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: () => { cleared = true; },
  } });
  try {
    await withRecipient(async ({ render, button, effects }: any) => {
      render(); assert.equal(button(/ขอรหัสยืนยันได้ใน 2 วินาที/).disabled, true);
      const cleanup = effects[2]();
      assert.ok(tick, 'the clock must run even before a challenge exists');
      now += 1000; tick!(); render(); assert.equal(button(/ขอรหัสยืนยันได้ใน 1 วินาที/).disabled, true);
      now += 1000; tick!(); render(); assert.equal(button('ขอรหัสยืนยัน').disabled, false);
      cleanup(); assert.equal(cleared, true);
    }, { 0: { hasCustomer: true, busy: false }, 2: 'choose', 4: 'owner@example.com', 12: now, 13: now + 2000 });
  } finally {
    Date.now = originalNow;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('FIX-Q2 recipient first-read failure offers an in-place retry and recovers the block', async () => {
  await withRecipient(async ({ api, render, button, effects }: any) => {
    let reads = 0, finish: ((value: any) => void) | undefined;
    api.recipient = async () => { if (++reads === 1) throw Error('unavailable'); return new Promise(resolve => { finish = resolve; }); };
    render(); effects[0](); await new Promise(resolve => setImmediate(resolve));
    assert.match(render(), /role="alert"/);
    button('ลองอีกครั้ง').onClick();
    render(); assert.equal(button('ลองอีกครั้ง').disabled, true); assert.equal(button('ลองอีกครั้ง')['aria-busy'], true);
    finish!({ hasCustomer: true, email: 'owner@example.com', busy: false, operation: null });
    await new Promise(resolve => setImmediate(resolve));
    const html = render(); assert.match(html, /owner@example.com/); assert.doesNotMatch(html, /role="alert"/);
    assert.equal(button('แก้').disabled, undefined); assert.equal(reads, 2);
  });
});
