import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpenseCertificateSection } from './ExpenseCertificateSection';
(globalThis as any).React = React;
test('the certificate section waits for mounting then scrolls once for the hash or durable query target', () => {
  const runtime = require('react'), oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  for (const location of [{ hash: '#wht-certificate', search: '' }, { hash: '', search: '?section=wht-certificate' }, { hash: '', search: '' }]) {
    let effect!: () => (() => void) | undefined; let frame: (() => void) | undefined; let scrolls = 0, focuses = 0, cancelled = 0;
    const ref = mock.method(runtime, 'useRef', () => ({ current: { scrollIntoView: () => { scrolls++; }, focus: () => { focuses++; } } }));
    const effects = mock.method(runtime, 'useEffect', (callback: typeof effect, deps: unknown[]) => { effect = callback; assert.deepEqual(deps, []); });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location, requestAnimationFrame: (callback: () => void) => { frame = callback; return 1; }, cancelAnimationFrame: () => { cancelled++; } } });
    try {
      const html = renderToStaticMarkup(React.createElement(ExpenseCertificateSection, { children: 'existing issue and view actions' }));
      assert.match(html, /id="wht-certificate"/); assert.match(html, /หนังสือรับรอง 50 ทวิ/);
      const cleanup = effect(); assert.equal(scrolls, 0);
      frame?.(); assert.equal(scrolls, location.hash || location.search ? 1 : 0); assert.equal(focuses, scrolls);
      cleanup?.(); assert.equal(cancelled, scrolls);
    } finally { ref.mock.restore(); effects.mock.restore(); }
  }
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete (globalThis as any).window;
});
