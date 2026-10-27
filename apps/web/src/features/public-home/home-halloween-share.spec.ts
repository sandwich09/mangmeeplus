import * as ReactRuntime from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { GHOST_CARDS, HALLOWEEN_HOME_URL } from './home-halloween-cards';
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

test('caption uses the public homepage and official LINE link', () => {
  const card = GHOST_CARDS[0];
  assert.ok(halloweenCaption(card).includes(HALLOWEEN_HOME_URL));
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
  const anchor = { href: '', download: '', click() { clicked++; } };
  let clicked = 0, save!: { onClick: () => void; disabled?: boolean };
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
  } finally {
    Reflect.set(runtime, 'createElement', create);
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
