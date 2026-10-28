import * as ReactRuntime from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { GHOST_CARDS, HALLOWEEN_URL } from './home-halloween-cards';
import { halloweenCaption, supportsFileShare } from './home-halloween-share';

(globalThis as typeof globalThis & { React: typeof ReactRuntime }).React = ReactRuntime;

function withNavigator(value: unknown, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  try { run(); }
  finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator'); }
}

test('file sharing requires a positive canShare result and safely handles unsupported browsers', () => {
  const file = new File(['image'], 'card.jpg', { type: 'image/jpeg' });
  withNavigator({ share() {}, canShare: () => true }, () => assert.equal(supportsFileShare(file), true));
  withNavigator({ share() {}, canShare: () => false }, () => assert.equal(supportsFileShare(file), false));
  withNavigator({ share() {} }, () => assert.equal(supportsFileShare(file), false));
  withNavigator({ share() {}, canShare: () => { throw new Error('unsupported'); } }, () => assert.equal(supportsFileShare(file), false));
  withNavigator({}, () => assert.equal(supportsFileShare(file), false));
});

test('caption uses the campaign popup URL and official LINE link', () => {
  const card = GHOST_CARDS[0];
  assert.ok(halloweenCaption(card).split('\n').includes('https://mangmeeplus.com/halloween'));
  assert.ok(!halloweenCaption(card).includes('/halloween/'));
  assert.ok(halloweenCaption(card).includes('https://line.me/R/ti/p/@mangmeeplus'));
});

test('captions preserve every approved quote line, including one and three line cards', () => {
  for (const id of ['16-the-nun', '21-chonggak-gwishin', '22-cheonyeo-gwishin']) {
    const card = GHOST_CARDS.find(card => card.id === id)!;
    const lines = halloweenCaption(card).split('\n');
    assert.equal(lines[0], `${card.name} · ${card.tag}`);
    assert.deepEqual(lines.slice(1, 1 + card.quote.length), card.quote);
  }
});


test('story preparation retains the plain source label/footer and its component revokes ready and late URLs', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { HalloweenCardShare } = await import('./HalloweenCardShare');
  const { readFileSync } = await import('node:fs');
  const { prepareHalloweenImage } = await import('./home-halloween-share');
  const { readHalloweenProvenance, makeHalloweenImageProvenance } = await import('./home-halloween-provenance');
  const runtime = require('react') as typeof React;
  const effect = runtime.useEffect, useState = runtime.useState, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const globals = new Map(['fetch', 'document', 'Image'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const jpeg = readFileSync(new URL('../../../../../docs/evidence/halloween-ghost-reveal-2026-10-27/mangmee-01-krasue-story-9x16.jpg', import.meta.url));
  let next = 0, canvasFails = false;
  const displayedMessages: unknown[] = [];
  const revoked: string[] = [], drawnText: string[] = [];
  const setGlobal = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  setGlobal('fetch', () => { throw new Error('Original image must not be fetched/re-stamped'); });
  setGlobal('Image', class {
    width = 1122; height = 1402; onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  setGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => ({
    width: 0, height: 0,
    getContext: () => { if (canvasFails) throw new Error('internal canvas diagnostic'); return { fillRect() {}, strokeRect() {}, drawImage() {}, fillText(value: string) { drawnText.push(value); } }; },
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob([jpeg], { type: 'image/jpeg' })),
  }) });
  URL.createObjectURL = () => `blob:test-${++next}`;
  URL.revokeObjectURL = url => { revoked.push(url); };
  let prepareEffect!: () => () => void;
  Reflect.set(runtime, 'useEffect', (work: () => () => void) => { prepareEffect = work; });
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const [value] = useState(initial);
    return [value, (nextValue: unknown) => { displayedMessages.push(nextValue); }];
  });
  try {
    const prepared = await prepareHalloweenImage(GHOST_CARDS[0]);
    assert.deepEqual(readHalloweenProvenance(new Uint8Array(await prepared.file.arrayBuffer())), makeHalloweenImageProvenance(GHOST_CARDS[0].id, 'story'));
    assert.equal(prepared.file.type, 'image/jpeg');
    assert.ok(drawnText.includes('mangmeeplus.com'));
    assert.ok(drawnText.includes('LINE @mangmeeplus'));
    URL.revokeObjectURL(prepared.url);
    renderToStaticMarkup(React.createElement(HalloweenCardShare, { card: GHOST_CARDS[0] }));
    const cleanupReady = prepareEffect();
    await new Promise(resolve => setImmediate(resolve));
    const readyUrl = `blob:test-${next}`;
    assert.ok(!revoked.includes(readyUrl));
    cleanupReady();
    assert.ok(revoked.includes(readyUrl));
    const cleanupPending = prepareEffect();
    cleanupPending();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(revoked.includes(`blob:test-${next}`), 'late completion revokes its URL');
    const beforeFailure = next;
    canvasFails = true;
    await assert.rejects(prepareHalloweenImage(GHOST_CARDS[0]), /internal canvas diagnostic/);
    assert.equal(next, beforeFailure, 'failed preparation creates no URL');
    const cleanupFailed = prepareEffect();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(displayedMessages.includes('เตรียมภาพไม่ได้ ลองอีกครั้ง'));
    assert.ok(!displayedMessages.includes('internal canvas diagnostic'));
    cleanupFailed();
  } finally {
    Reflect.set(runtime, 'useEffect', effect);
    Reflect.set(runtime, 'useState', useState);
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('original save is immediately available and downloads the existing stamped static PNG', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { HalloweenCardShare } = await import('./HalloweenCardShare');
  const runtime = require('react') as typeof React;
  const create = runtime.createElement;
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const anchor = { href: '', download: '', click() { clicked++; } };
  let clicked = 0, copied = 0, save!: { onClick: () => void; disabled?: boolean };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText() { copied++; } } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (type: string) => { assert.equal(type, 'a'); return anchor; } } });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'button' && children.includes('บันทึกภาพ')) save = props;
    return create(type, props, ...children);
  });
  try {
    renderToStaticMarkup(React.createElement(HalloweenCardShare, { card: GHOST_CARDS[0] }));
    assert.ok(save);
    assert.equal(save.disabled, undefined);
    save.onClick();
    assert.equal(clicked, 1);
    assert.equal(anchor.href, GHOST_CARDS[0].image);
    assert.equal(anchor.download, `mangmee-${GHOST_CARDS[0].id}.png`);
    assert.equal(copied, 0, 'original PNG save leaves clipboard untouched');
  } finally {
    Reflect.set(runtime, 'createElement', create);
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore);
    else Reflect.deleteProperty(globalThis, 'document');
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

// Retained hooks exercise real click handlers; this is not a native social-post test.
async function withShareUi(run: (ui: any) => Promise<void>, navigatorValue: any) {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { HalloweenCardShare } = await import('./HalloweenCardShare');
  const runtime = require('react') as typeof ReactRuntime;
  const hooks = { useState: runtime.useState, useRef: runtime.useRef, useEffect: runtime.useEffect, createElement: runtime.createElement };
  const globals = new Map(['navigator', 'document', 'requestAnimationFrame'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const file = new File(['prepared image'], 'story.jpg', { type: 'image/jpeg' });
  const prepared = { cardId: GHOST_CARDS[0].id, file, url: 'blob:story', name: 'story.jpg' };
  const states: any[] = [prepared], refs: any[] = [], downloads: any[] = [];
  let cursor = 0, refCursor = 0, buttons: any[] = [], effect!: () => () => void, focused = 0;
  let card = GHOST_CARDS[0];
  const setGlobal = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, value });
  setGlobal('navigator', navigatorValue);
  setGlobal('document', { fonts: { ready: new Promise(() => {}) }, createElement: () => {
    const anchor = { href: '', download: '', click() { downloads.push({ href: this.href, download: this.download }); } };
    return anchor;
  } });
  setGlobal('requestAnimationFrame', () => { focused++; });
  Reflect.set(runtime, 'useState', (initial: any) => {
    const i = cursor++;
    if (!(i in states)) states[i] = initial;
    return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
  });
  Reflect.set(runtime, 'useRef', (initial: unknown) => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: initial }); });
  Reflect.set(runtime, 'useEffect', (work: () => () => void) => { effect = work; });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'button') buttons.push({ ...props, label: children.join('') });
    return hooks.createElement(type, props, ...children);
  });
  function render() {
    cursor = 0; refCursor = 0; buttons = [];
    return renderToStaticMarkup(ReactRuntime.createElement(HalloweenCardShare, { card }));
  }
  let cleanup: (() => void) | undefined;
  try {
    render(); cleanup = effect(); states[0] = prepared; render();
    await run({ file, downloads, render,
      click(label: string) { render(); const button = buttons.find(button => button.label === label || button['aria-label'] === label); assert.ok(button, label); return button.onClick(); },
      changeCard() { cleanup?.(); card = GHOST_CARDS[1]; render(); cleanup = effect(); render(); },
      unmount() { cleanup?.(); cleanup = undefined; },
      get focused() { return focused; },
    });
  } finally {
    cleanup?.();
    for (const [name, value] of Object.entries(hooks)) Reflect.set(runtime, name, value);
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

const flushShare = () => new Promise(resolve => setImmediate(resolve));

test('all four share clicks start clipboard then native JPEG sharing synchronously while copy is pending', async () => {
  for (const trigger of ['แชร์ภาพ', 'แชร์ภาพด้วย Facebook', 'แชร์ภาพด้วย Instagram', 'แชร์ภาพด้วย TikTok']) {
    const calls: string[] = [], payloads: ShareData[] = [];
    let copyDone!: () => void, shareDone!: () => void;
    await withShareUi(async ui => {
      const pending = ui.click(trigger);
      assert.deepEqual(calls, ['copy', 'share']);
      assert.deepEqual(payloads[0], { files: [ui.file], title: `การ์ดของ${GHOST_CARDS[0].name}`, text: halloweenCaption(GHOST_CARDS[0]), url: HALLOWEEN_URL });
      await ui.click(trigger === 'แชร์ภาพ' ? 'กำลังเปิดเมนูแชร์…' : trigger);
      assert.equal(payloads.length, 1, 'duplicate click does not share or copy twice');
      copyDone(); await flushShare();
      assert.match(ui.render(), /คัดลอกข้อความและลิงก์แล้ว วางในแอปที่เลือกได้/);
      shareDone(); await pending;
      assert.match(ui.render(), /ส่งภาพไปยังแอปที่เลือกแล้ว/);
    }, { canShare: () => true,
      clipboard: { writeText(text: string) { assert.equal(text, halloweenCaption(GHOST_CARDS[0])); calls.push('copy'); return new Promise<void>(resolve => { copyDone = resolve; }); } },
      share(data: ShareData) { calls.push('share'); payloads.push(data); return new Promise<void>(resolve => { shareDone = resolve; }); },
    });
  }
});

test('failed or absent clipboard offers unfocused manual copy without preventing native share', async () => {
  for (const clipboard of [undefined, { writeText: () => Promise.reject(new Error('private diagnostic')) }]) {
    let shares = 0;
    await withShareUi(async ui => {
      await ui.click('แชร์ภาพด้วย Facebook'); await flushShare();
      const html = ui.render();
      assert.equal(shares, 1);
      assert.match(html, /คัดลอกข้อความอัตโนมัติไม่ได้/);
      assert.match(html, /textarea/);
      assert.doesNotMatch(html, /private diagnostic/);
      assert.equal(ui.focused, 0);
    }, { clipboard, canShare: () => true, share: async () => { shares++; } });
  }
});

test('unsupported sharing and failure fallback download prepared JPEG and copy caption; cancel remains retryable', async () => {
  let copied = 0;
  await withShareUi(async ui => {
    await ui.click('แชร์ภาพด้วย Facebook'); await flushShare();
    assert.deepEqual(ui.downloads, [{ href: 'blob:story', download: 'story.jpg' }]);
    assert.equal(copied, 1);
  }, { clipboard: { writeText: async () => { copied++; } } });
  let shares = 0;
  await withShareUi(async ui => {
    await ui.click('แชร์ภาพด้วย Instagram'); await flushShare();
    assert.match(ui.render(), /แชร์ไม่สำเร็จ/);
    await ui.click('บันทึกภาพเพื่อแชร์'); await flushShare();
    assert.deepEqual(ui.downloads, [{ href: 'blob:story', download: 'story.jpg' }]);
    assert.equal(shares, 1);
    assert.equal(copied, 3);
    await ui.click('แชร์ภาพด้วย TikTok');
    assert.match(ui.render(), /ปิดเมนูแชร์แล้ว การ์ดยังอยู่ที่เดิม/);
    await ui.click('แชร์ภาพ');
    assert.equal(shares, 3);
  }, { clipboard: { writeText: async () => { copied++; } }, canShare: () => true,
    share: async () => { if (++shares === 1) throw new Error('internal share diagnostic'); if (shares === 2) throw new DOMException('cancel', 'AbortError'); },
  });
});

test('late clipboard and share completion are ignored after card change or unmount', async () => {
  for (const end of ['changeCard', 'unmount']) {
    let copyDone!: () => void, shareDone!: () => void;
    await withShareUi(async ui => {
      const pending = ui.click('แชร์ภาพ');
      ui[end]();
      const before = ui.render();
      copyDone(); shareDone(); await pending; await flushShare();
      assert.equal(ui.render(), before);
      assert.doesNotMatch(ui.render(), /คัดลอกข้อความและลิงก์แล้ว|ส่งภาพไปยังแอปที่เลือกแล้ว/);
    }, { canShare: () => true, clipboard: { writeText: () => new Promise<void>(resolve => { copyDone = resolve; }) },
      share: () => new Promise<void>(resolve => { shareDone = resolve; }),
    });
  }
});
