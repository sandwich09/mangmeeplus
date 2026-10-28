import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HalloweenGhostGame } from './HalloweenGhostGame';
import { getGhostCard, SECRET_CARD_BACK, STANDARD_CARD_BACK } from './home-halloween-cards';
import { HALLOWEEN_SEEN_STORAGE_KEY } from './home-halloween-draw';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const runtime = require('react') as typeof React;
const words = (value: any): string => Array.isArray(value) ? value.map(words).join('') : React.isValidElement(value) ? words((value.props as any).children) : value == null || typeof value === 'boolean' ? '' : String(value);

// Retained hooks and captured native controls follow BillingPage.rendered.spec.ts.
// State comes exclusively from the component's handlers/effect, not injected phase values.
type GameUi = {
  render: () => string; button: (name: string) => any; unmount: () => void;
  readonly calls: number; readonly signal: AbortSignal | undefined; readonly images: string[];
  readonly stored: string | null;
  reducedMotion: () => void; respond: (cardId: string) => void; fail: () => void;
  fire: (delay: number) => void; readonly timerCount: number;
};
async function withGame(run: (ui: GameUi) => Promise<void>) {
  const hooks = { useState: runtime.useState, useRef: runtime.useRef, useEffect: runtime.useEffect, createElement: runtime.createElement };
  const globals = new Map(['fetch', 'window', 'document', 'Image', 'matchMedia', 'setTimeout', 'clearTimeout'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const states: any[] = [], refs: any[] = [];
  let stateCursor = 0, refCursor = 0, elements: { type: string; props: any; children: any[] }[] = [];
  let effects: (() => void | (() => void))[] = [];
  let cleanups: (() => void)[] = [];
  let calls = 0, signal: AbortSignal | undefined;
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>(yes => { resolve = yes; });
  const timers = new Map<number, { work: () => void; delay: number }>();
  let timerId = 0;
  let motionListener: (() => void) | undefined;
  const stored = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
  const motion = { matches: false, addEventListener: (_name: string, work: () => void) => { motionListener = work; }, removeEventListener: () => { motionListener = undefined; } };
  const setGlobal = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  setGlobal('window', { location: { search: '' }, sessionStorage });
  setGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  setGlobal('Image', class { src = ''; });
  setGlobal('matchMedia', () => motion);
  setGlobal('fetch', (_url: unknown, options: RequestInit) => { calls++; signal = options.signal ?? undefined; return pending; });
  setGlobal('setTimeout', (work: () => void, delay: number) => { const id = ++timerId; timers.set(id, { work, delay }); return id; });
  setGlobal('clearTimeout', (id: number) => timers.delete(id));
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const index = stateCursor++;
    const [value] = hooks.useState(initial);
    if (!(index in states)) states[index] = value;
    return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  });
  Reflect.set(runtime, 'useRef', (initial: unknown) => { const index = refCursor++; const ref = hooks.useRef(initial); return refs[index] ?? (refs[index] = ref); });
  Reflect.set(runtime, 'useEffect', (work: () => void | (() => void)) => { effects.push(work); });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (typeof type === 'string') elements.push({ type, props, children });
    return hooks.createElement(type, props, ...children);
  });
  function render() {
    stateCursor = 0; refCursor = 0; elements = []; effects = [];
    return renderToStaticMarkup(React.createElement(HalloweenGhostGame));
  }
  function button(name: string) {
    const button = elements.find(element => element.type === 'button' && words(element.children) === name);
    assert.ok(button, name);
    return button.props;
  }
  function unmount() { for (const cleanup of cleanups) cleanup(); cleanups = []; }
  function controls() {
    return {
      render, button, unmount,
      get calls() { return calls; }, get signal() { return signal; },
      get images() { return elements.filter(element => element.type === 'img').map(element => element.props.src as string); },
      get stored() { return stored.get(HALLOWEEN_SEEN_STORAGE_KEY) ?? null; },
      reducedMotion() { motion.matches = true; motionListener?.(); },
      respond(cardId: string) {
        resolve(Response.json({ cardId }));
      },
      fail() { resolve(new Response(null, { status: 503 })); },
      fire(delay: number) {
        const entry = [...timers].find(([, timer]) => timer.delay === delay);
        assert.ok(entry, `timer ${delay}`);
        timers.delete(entry[0]); entry[1].work();
      },
      get timerCount() { return timers.size; },
    };
  }
  try {
    render();
    cleanups = effects.map(work => work()).filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
    await run(controls());
  } finally {
    unmount();
    for (const [name, hook] of Object.entries(hooks)) Reflect.set(runtime, name, hook);
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test('loading is immediate, duplicate clicks request once, and ordinary/SECRET spins contain only backs until reveal', async () => {
  for (const [cardId, back, duration] of [['01-krasue', STANDARD_CARD_BACK, 4500], ['23-mangmee-secret', SECRET_CARD_BACK, 7500]] as const) {
    await withGame(async ui => {
      const click = ui.button('เผยร่างของฉัน').onClick;
      const first = click();
      await click();
      assert.equal(ui.calls, 1);
      assert.match(ui.render(), /data-halloween-game="loading"/);
      const busy = ui.button('กำลังเรียกวิญญาณ…');
      assert.equal(busy.disabled, true);
      assert.equal(busy['aria-busy'], true);
      ui.respond(cardId); await first;
      assert.equal(ui.stored, cardId === '23-mangmee-secret' ? null : JSON.stringify([cardId]));
      assert.match(ui.render(), /data-halloween-game="drawing"/);
      assert.deepEqual(ui.images, [back, back]);
      ui.fire(duration);
      assert.match(ui.render(), /data-halloween-game="revealed"/);
      assert.ok(ui.images.some(image => image === getGhostCard(cardId)!.image));
    });
  }
});

test('unmount aborts pending request and a late response cannot schedule a reveal', async () => {
  await withGame(async ui => {
    const pending = ui.button('เผยร่างของฉัน').onClick();
    ui.unmount();
    assert.equal(ui.signal?.aborted, true);
    ui.respond('01-krasue'); await pending;
    assert.equal(ui.timerCount, 0);
    assert.match(ui.render(), /data-halloween-game="loading"/);
    assert.ok(!ui.images.includes(getGhostCard('01-krasue')!.image));
  });
});

test('failed request restores a retry action without revealing a card', async () => {
  await withGame(async ui => {
    const pending = ui.button('เผยร่างของฉัน').onClick();
    ui.fail(); await pending;
    const html = ui.render();
    assert.match(html, /data-halloween-game="ready"/);
    assert.match(html, /เรียกวิญญาณไม่ได้ ลองอีกครั้ง/);
    assert.equal(ui.button('เผยร่างของฉัน').disabled, false);
    assert.equal(ui.timerCount, 0);
  });
});

test('reduced motion during the pending request waits for the server response', async () => {
  await withGame(async ui => {
    const pending = ui.button('เผยร่างของฉัน').onClick();
    ui.reducedMotion();
    assert.match(ui.render(), /data-halloween-game="loading"/);
    assert.equal(ui.calls, 1);
    ui.respond('01-krasue'); await pending;
    assert.match(ui.render(), /data-halloween-game="drawing"/);
    assert.deepEqual(ui.images, [STANDARD_CARD_BACK, STANDARD_CARD_BACK]);
    ui.fire(80);
    assert.match(ui.render(), /data-halloween-game="revealed"/);
  });
});
