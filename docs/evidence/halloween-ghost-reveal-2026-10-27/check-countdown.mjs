import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:43841';
const dir = fileURLToPath(new URL('.', import.meta.url));
const initial = Date.parse('2026-10-27T17:00:00Z');
const deadlines = { candy: Date.parse('2026-10-28T17:00:00Z'), escape: Date.parse('2026-10-29T17:00:00Z') };
const report = { status: 'running', base, results: [], method: 'Real browser with test-only Date.now override; intervals use real browser timers. Foreground resync uses a synthetic visibilitychange event. No product clock flags. WebKit/iPhone is desktop engine emulation, not a physical phone.' };
const save = () => writeFileSync(`${dir}countdown-results.json`, JSON.stringify(report, null, 2));
save();

async function instrument(context) {
  await context.addInitScript(time => {
    window.__countdownNow = time;
    Date.now = () => window.__countdownNow;
    const probe = window.__countdownProbe = { intervals: new Map(), listeners: new Set(), writes: [] };
    const interval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      const id = interval(callback, delay, ...args);
      probe.intervals.set(id, { delay, active: true });
      return id;
    };
    const clear = window.clearInterval.bind(window);
    window.clearInterval = id => { if (probe.intervals.has(id)) probe.intervals.get(id).active = false; return clear(id); };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this === document && type === 'visibilitychange') probe.listeners.add(listener);
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (this === document && type === 'visibilitychange') probe.listeners.delete(listener);
      return remove.call(this, type, listener, options);
    };
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) { probe.writes.push(method); return original.apply(this, args); };
    }
  }, initial);
}

const probe = page => page.evaluate(() => ({ intervals: [...window.__countdownProbe.intervals.values()].filter(item => item.active && item.delay === 1000).length, visibilityListeners: [...window.__countdownProbe.listeners].filter(listener => /(?:^|\.)onVisibilityChange$/.test(listener.name)).length, writes: window.__countdownProbe.writes }));
const clock = (page, time, foreground = false) => page.evaluate(({ time, foreground }) => {
  window.__countdownNow = time;
  if (foreground) document.dispatchEvent(new Event('visibilitychange'));
}, { time, foreground });
const timer = (page, id) => page.locator(`[data-halloween-countdown="${id}"] [role="timer"]`);
const values = { 86400: '1 วัน 00:00:00', 172800: '2 วัน 00:00:00', 1: '0 วัน 00:00:01', 86330: '0 วัน 23:58:50' };
const waitRemaining = (page, id, seconds) => page.waitForFunction(({ id, value }) => document.querySelector(`[data-halloween-countdown="${id}"] [role="timer"]`)?.textContent === value, { id, value: values[seconds] });
const open = async page => {
  await page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }).tap();
  await page.locator('.home-halloween-dialog').waitFor({ state: 'visible' });
};
const close = async page => {
  await page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).tap();
  await page.locator('.home-halloween-dialog').waitFor({ state: 'hidden' });
};
async function layout(page, label) {
  const boxes = await page.locator('[data-halloween-countdown] [role="timer"]').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { width: box.width, left: box.left, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, role: element.getAttribute('role'), live: element.getAttribute('aria-live'), tabIndex: element.tabIndex };
  }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: page overflow`);
  assert.ok(boxes.every(box => box.scrollWidth <= box.clientWidth && box.left >= 0 && box.right <= page.viewportSize().width), `${label}: countdown fits`);
  assert.ok(boxes.every(box => box.role === 'timer' && box.live === 'off' && box.tabIndex < 0), `${label}: read-only timer without per-second live announcements`);
  return boxes;
}

try {
  for (const [name, engine, options] of [
    ['chromium-390', chromium, { viewport: { width: 390, height: 844 }, hasTouch: true }],
    ['chromium-1280', chromium, { viewport: { width: 1280, height: 900 }, hasTouch: true }],
    ['webkit-iphone', webkit, devices['iPhone 16']],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ ...options, reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok' });
      await instrument(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/?preview=events&event=halloween`, { waitUntil: 'load' });
      const baseline = await probe(page);
      await open(page);
      await waitRemaining(page, 'candy', 86400);
      await waitRemaining(page, 'escape', 172800);
      assert.match(await page.locator('[data-halloween-countdown="candy"]').innerText(), /29 ต.ค. 2569.*00:00.*กรุงเทพฯ/s);
      assert.match(await page.locator('[data-halloween-countdown="escape"]').innerText(), /30 ต.ค. 2569.*00:00.*กรุงเทพฯ/s);
      assert.notEqual(await timer(page, 'candy').innerText(), await timer(page, 'escape').innerText(), 'doors use distinct absolute deadlines');
      const active = await probe(page);
      assert.equal(active.intervals, baseline.intervals + 1, 'opening starts exactly one countdown interval');
      assert.equal(active.visibilityListeners, baseline.visibilityListeners + 1, 'opening starts exactly one countdown foreground listener');
      const measurements = await layout(page, name);
      await page.screenshot({ path: `${dir}countdown-${name}-chooser.png` });
      const result = { engine: name, version: browser.version(), initialCandy: await timer(page, 'candy').innerText(), initialEscape: await timer(page, 'escape').innerText(), measurements, baseline, active };
      report.results.push(result); save();

      // A frozen wall clock still ticks from absolute time when the browser interval runs.
      await clock(page, deadlines.candy - 1000);
      await waitRemaining(page, 'candy', 1);
      await clock(page, deadlines.candy);
      await timer(page, 'candy').waitFor({ state: 'detached' });
      await waitRemaining(page, 'escape', 86400);
      assert.match(await page.locator('[data-halloween-door="candy"]').innerText(), /กำลังเตรียมเกม/);
      await clock(page, deadlines.candy + 5000);
      await page.waitForTimeout(1100);
      assert.equal(await timer(page, 'candy').count(), 0, 'expired timer stays hidden');
      await close(page);
      assert.deepEqual(await probe(page), baseline, 'close removes interval and visibility listeners');

      await clock(page, deadlines.candy - 1000);
      await open(page);
      await page.locator('[data-halloween-door="candy"]').tap();
      await page.locator('[data-halloween-intro="candy"]').waitFor();
      await waitRemaining(page, 'candy', 1);
      await layout(page, `${name} candy intro`);
      await page.screenshot({ path: `${dir}countdown-${name}-candy-before.png` });
      await clock(page, deadlines.candy);
      await timer(page, 'candy').waitFor({ state: 'detached' });
      assert.match(await page.locator('[data-halloween-intro="candy"]').innerText(), /กำลังเตรียมเกม/);
      assert.equal(await page.locator('[data-halloween-intro="candy"] button').count(), 1, 'waiting intro offers only the back control');
      await page.screenshot({ path: `${dir}countdown-${name}-candy-after.png` });
      await page.getByRole('button', { name: 'เลือกประตูอื่น', exact: true }).tap();

      await clock(page, deadlines.escape - 1000, true);
      await page.locator('[data-halloween-door="escape"]').tap();
      await waitRemaining(page, 'escape', 1);
      await clock(page, deadlines.escape);
      await timer(page, 'escape').waitFor({ state: 'detached' });
      assert.match(await page.locator('[data-halloween-intro="escape"]').innerText(), /กำลังเตรียมเกม/);
      await page.getByRole('button', { name: 'เลือกประตูอื่น', exact: true }).tap();
      assert.equal(await page.locator('[data-halloween-countdown] [role="timer"]').count(), 0, 'both timers hidden after their own deadline');
      await close(page);
      assert.deepEqual(await probe(page), baseline, 'repeated close cleans timers/listeners');

      await clock(page, initial);
      await open(page);
      await waitRemaining(page, 'candy', 86400);
      const foregroundStart = performance.now();
      await clock(page, initial + 70000, true);
      await waitRemaining(page, 'candy', 86330);
      result.foregroundResyncMs = performance.now() - foregroundStart;
      assert.ok(result.foregroundResyncMs < 700, 'foreground resync does not wait for the one-second interval');
      await page.locator('[data-halloween-door="ghost"]').tap();
      await page.locator('[data-halloween-game="ready"]').waitFor();
      assert.equal(await page.getByRole('button', { name: 'เผยร่างของฉัน', exact: true }).isVisible(), true, 'first door remains available');
      await close(page);
      assert.deepEqual(await probe(page), baseline);
      for (const event of ['default', 'unknown']) {
        await page.goto(`${base}/?preview=events&event=${event}`, { waitUntil: 'load' });
        assert.equal(await page.locator('[data-halloween-activity]').count(), 0, `${event}: activity gated off`);
        assert.equal(await page.locator('[data-halloween-countdown]').count(), 0);
      }
      assert.deepEqual(errors, [], 'no browser errors');
      result.errors = errors; result.boundaries = 'Distinct Bangkok deadlines, chooser and selected intro automatic disappearance, no fake play, foreground resync and repeat cleanup pass';
      await context.close(); save();
    } finally { await browser.close(); }
  }
  report.status = 'pass'; save();
  console.log(JSON.stringify({ status: report.status, engines: report.results.map(result => result.engine) }));
} catch (error) { report.status = 'fail'; report.error = error.stack; save(); throw error; }
