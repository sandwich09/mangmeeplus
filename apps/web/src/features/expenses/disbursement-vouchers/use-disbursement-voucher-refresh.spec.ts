import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
const api = { ...require('./disbursement-vouchers.api') };
require.cache[require.resolve('./disbursement-vouchers.api')]!.exports = api;
const { useDisbursementVoucherRefresh } = require('./use-disbursement-voucher-refresh');
const tick = () => new Promise(resolve => setImmediate(resolve));
function mount(enabled: boolean, blocked: boolean, reload: (guard: () => boolean) => Promise<void>) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const win = Object.assign(new EventTarget(), { location: new URL('https://shop.test/companies/shop/expenses/disbursement-vouchers/doc') });
  let busy = false, command = false, now = 10000;
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => busy ? {} : null });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const runtime = require('react'); let effect: (() => () => void) | undefined;
  const mockedEffect = mock.method(runtime, 'useEffect', (callback: () => () => void) => { effect = callback; });
  const clock = mock.method(Date, 'now', () => now);
  const inFlight = mock.method(api, 'isDisbursementCommandInFlight', () => command);
  function Screen() { useDisbursementVoucherRefresh(enabled, blocked, reload); return React.createElement('span'); }
  renderToStaticMarkup(React.createElement(Screen)); mockedEffect.mock.restore();
  const cleanup = effect!();
  return { win, doc, advance: () => { now += 5000; }, busy: (value: boolean) => { busy = value; }, command: (value: boolean) => { command = value; }, cleanup,
    click: (href: string, modified = false) => {
      const event = new Event('click'); Object.defineProperty(event, 'target', { value: { closest: () => ({ href }) } });
      Object.defineProperty(event, 'ctrlKey', { value: modified }); doc.dispatchEvent(event);
    }, restore: () => { cleanup(); clock.mock.restore(); inFlight.mock.restore();
      if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete (globalThis as any).window;
      if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete (globalThis as any).document;
    } };
}
test('visible/focused and same-route links reread at most once per five seconds without changing the bell', async () => {
  let reads = 0;
  const screen = mount(true, false, async () => { reads++; });
  try {
    screen.win.dispatchEvent(new Event('focus')); await tick(); assert.equal(reads, 1);
    screen.doc.dispatchEvent(new Event('visibilitychange')); await tick(); assert.equal(reads, 1);
    screen.advance(); screen.doc.visibilityState = 'hidden'; screen.win.dispatchEvent(new Event('focus')); assert.equal(reads, 1);
    screen.doc.visibilityState = 'visible'; screen.doc.dispatchEvent(new Event('visibilitychange')); await tick(); assert.equal(reads, 2);
    screen.advance(); screen.click(screen.win.location.href); await tick(); assert.equal(reads, 3);
    screen.advance(); screen.click('https://shop.test/companies/shop/expenses/another'); screen.click(screen.win.location.href, true); await tick(); assert.equal(reads, 3);
    screen.cleanup(); screen.win.dispatchEvent(new Event('focus')); screen.click(screen.win.location.href); await tick(); assert.equal(reads, 3);
  } finally { screen.restore(); }
});
test('open dialogs, absent read access and in-flight commands block refresh and protect late responses', async () => {
  for (const [enabled, blocked] of [[false, false], [true, true]]) {
    let reads = 0; const screen = mount(enabled!, blocked!, async () => { reads++; });
    try { screen.win.dispatchEvent(new Event('focus')); await tick(); assert.equal(reads, 0); } finally { screen.restore(); }
  }
  let reads = 0, applied = 0; let finish!: () => void;
  const screen = mount(true, false, async guard => { reads++; await new Promise<void>(resolve => { finish = resolve; }); if (guard()) applied++; });
  try {
    screen.busy(true); screen.win.dispatchEvent(new Event('focus')); assert.equal(reads, 0);
    screen.busy(false); screen.command(true); screen.win.dispatchEvent(new Event('focus')); assert.equal(reads, 0);
    screen.command(false); screen.win.dispatchEvent(new Event('focus')); assert.equal(reads, 1);
    screen.advance(); screen.win.dispatchEvent(new Event('focus')); assert.equal(reads, 1);
    screen.command(true); finish(); await tick(); assert.equal(applied, 0);
    screen.command(false); screen.win.dispatchEvent(new Event('focus')); assert.equal(reads, 2);
    screen.cleanup(); finish(); await tick(); assert.equal(applied, 0);
    const page = readFileSync(new URL('./DisbursementVoucherDocumentPage.tsx', import.meta.url), 'utf8');
    assert.match(page, /Boolean\(dialog\) \|\| historyOpen, reloadDocument/);
    assert.match(page, /if \(!canApply \|\| canApply\(\)\) setDetail\(data\)/);
  } finally { screen.restore(); }
});
