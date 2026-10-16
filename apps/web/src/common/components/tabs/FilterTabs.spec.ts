import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const css = readFileSync(new URL('../../../../app/globals.css', import.meta.url), 'utf8');
const TABS = [
  { key: 'all', label: 'ทั้งหมด', count: 53 },
  { key: 'draft', label: 'ร่าง', count: 0 },
  { key: 'waiting', label: 'รออนุมัติ/ตรวจสอบ' },
];

test('as buttons: one group, the chosen tab pressed, a count beside a name (zero is shown, none is not)', async () => {
  const { FilterTabs } = await import('./FilterTabs');
  const html = renderToStaticMarkup(React.createElement(FilterTabs, { tabs: TABS, value: 'draft', onChange: () => {}, 'aria-label': 'สถานะใบเตรียมจ่าย' }));
  assert.match(html, /^<div role="group" aria-label="สถานะใบเตรียมจ่าย" class="mangmee-segmented mangmee-filter-tabs">/);
  assert.equal(html.match(/<button type="button"/g)?.length, 3);
  assert.match(html, /<button type="button" aria-pressed="false" data-active="false" class="mangmee-tab">ทั้งหมด<span class="mangmee-tab-count">53<\/span><\/button>/);
  assert.match(html, /<button type="button" aria-pressed="true" data-active="true" class="mangmee-tab mangmee-tab-active">ร่าง<span class="mangmee-tab-count">0<\/span><\/button>/);
  assert.match(html, /class="mangmee-tab">รออนุมัติ\/ตรวจสอบ<\/button>/);
});

test('as links: the filter lives in the URL and the chosen tab is the current one', async () => {
  const { FilterTabs } = await import('./FilterTabs');
  const html = renderToStaticMarkup(React.createElement(FilterTabs, {
    tabs: TABS.map((tab) => ({ ...tab, href: `/list?status=${tab.key}` })), value: 'all', 'aria-label': 'สถานะ',
  }));
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /<a aria-current="true" data-active="true" class="mangmee-tab mangmee-tab-active" href="\/list\?status=all">ทั้งหมด/);
  assert.match(html, /<a data-active="false" class="mangmee-tab" href="\/list\?status=draft">/);
  // A tab that cannot be chosen now is a disabled button, not a dead link.
  const locked = renderToStaticMarkup(React.createElement(FilterTabs, { tabs: [{ key: 'a', label: 'ก', href: '/a', disabled: true }], value: 'b', 'aria-label': 'x' }));
  assert.match(locked, /<button type="button" aria-pressed="false" data-active="false" disabled="" class="mangmee-tab">ก<\/button>/);
});

test('the stylesheet: names stay on one line; a phone scrolls the row inside itself; from 640 px the tabs wrap', () => {
  const tab = css.slice(css.indexOf('.mangmee-filter-tabs > .mangmee-tab {'));
  assert.match(tab.slice(0, tab.indexOf('}')), /flex: none;[\s\S]*white-space: nowrap;/);
  assert.match(css, /\.mangmee-segmented \{[^}]*overflow-x: auto;/, 'the track the piece is built on scrolls sideways');
  assert.match(css, /@media \(min-width: 40rem\) \{\s*\.mangmee-filter-tabs \{\s*flex-wrap: wrap;\s*overflow: visible;/);
  assert.match(css, /\.mangmee-tab-count \{[^}]*font-variant-numeric: tabular-nums;/);
});
