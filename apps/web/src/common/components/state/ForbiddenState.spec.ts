import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
const previous = require.extensions['.svg'];
require.extensions['.svg'] = (m) => { m.exports = () => null; };
const { ForbiddenState } = require('./ForbiddenState');
if (previous) require.extensions['.svg'] = previous; else delete require.extensions['.svg'];

const h = React.createElement;

test('by default the title is a paragraph inside a page that has its own heading', () => {
  const html = renderToStaticMarkup(h(ForbiddenState, {}));
  assert.doesNotMatch(html, /<h1|<h2/);
  assert.match(html, /<p class="text-sm font-semibold text-gray-700">ไม่มีสิทธิ์เข้าถึง<\/p><p class="text-sm text-gray-500">คุณไม่มีสิทธิ์เข้าถึงหน้านี้<\/p>/);
  // The help line is text people must read: 14 px, not 12.
  assert.match(html, /<p class="text-sm text-gray-500">แจ้ง[^<]+<\/p><\/div>$/);
});

test('when the state is the whole page its title can be the one h1, and the way out follows the text with no empty row', () => {
  const action = h('a', { href: '/dashboard' }, 'กลับไปหน้าแรก');
  const html = renderToStaticMarkup(h(ForbiddenState, { titleAs: 'h1', title: 'เปิดหน้านี้ไม่ได้', description: '', helpText: '', action }));
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /<h1 class="text-lg font-bold text-gray-900">เปิดหน้านี้ไม่ได้<\/h1><\/div><a href="\/dashboard">กลับไปหน้าแรก<\/a><\/div>$/);
  assert.doesNotMatch(html, /<p/);
});

test('unavailable package explains the package and suppresses permission advice for every role', () => {
  for (const isOwner of [true, false]) {
    const html = renderToStaticMarkup(h(ForbiddenState, { packageAvailable: false, isOwner, action: h('a', { href: '/dashboard' }, 'กลับไปหน้าแรก') }));
    assert.match(html, /แพ็กเกจของร้านยังไม่มีหน้านี้/);
    assert.doesNotMatch(html, /เพิ่มสิทธิ์|แจ้ง|เจ้าของกิจการ/);
    assert.match(html, /กลับไปหน้าแรก/);
  }
});
test('an owner with an available package is told where to grant access', () => {
  const html = renderToStaticMarkup(h(ForbiddenState, { packageAvailable: true, isOwner: true }));
  assert.match(html, /เพิ่มสิทธิ์ได้ที่ พนักงานและสิทธิ์/);
  assert.doesNotMatch(html, /แจ้ง/);
});
