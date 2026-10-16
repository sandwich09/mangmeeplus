import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const h = React.createElement;
const words = { eyebrow: 'ระบบขัดข้องชั่วคราว', title: 'เปิดหน้านี้ไม่ได้', description: 'ลองอีกครั้ง' };

test('actions are one group by the shared rule, in the middle of the card, back-out first', async () => {
  const { BrandedState } = await import('./BrandedState');
  const html = renderToStaticMarkup(h(BrandedState, { ...words, actions: h(React.Fragment, null,
    h('a', { href: '/', className: 'mangmee-btn mangmee-btn-secondary' }, 'กลับไปหน้าแรก'),
    h('button', { type: 'button', className: 'mangmee-btn mangmee-btn-primary' }, 'ลองอีกครั้ง')) }));
  assert.match(html, /<div data-align="center" class="mangmee-actions mt-6 sm:mt-7"><a href="\/" class="mangmee-btn mangmee-btn-secondary">กลับไปหน้าแรก<\/a><button type="button" class="mangmee-btn mangmee-btn-primary">ลองอีกครั้ง<\/button><\/div>/);
  assert.equal(html.match(/<h1/g)?.length, 1);
});

test('what a caller passes as children is laid out as it always was', async () => {
  const { BrandedState } = await import('./BrandedState');
  const html = renderToStaticMarkup(h(BrandedState, { ...words, children: h('a', { href: '/login' }, 'เข้าสู่ระบบ') }));
  assert.match(html, /<div class="mt-6 flex flex-col items-stretch gap-3 sm:mt-7 sm:flex-row sm:flex-wrap sm:justify-center"><a href="\/login">เข้าสู่ระบบ<\/a><\/div>/);
  assert.doesNotMatch(html, /mangmee-actions/);
  assert.doesNotMatch(renderToStaticMarkup(h(BrandedState, words)), /mangmee-actions|flex-col items-stretch/);
});
