import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
const previous = require.extensions['.css'];
require.extensions['.css'] = (m) => { m.exports = { menu: 'menu', end: 'end', up: 'up', panel: 'panel', icon: 'icon' }; };
const previousSvg = require.extensions['.svg'];
require.extensions['.svg'] = m => { m.exports = (props: any) => React.createElement('svg', props); };
const { MoreActions } = require('./MoreActions');
if (previousSvg) require.extensions['.svg'] = previousSvg; else delete require.extensions['.svg'];
if (previous) require.extensions['.css'] = previous; else delete require.extensions['.css'];

const css = readFileSync(new URL('./MoreActions.module.css', import.meta.url), 'utf8');
const entry = React.createElement('button', { type: 'button' }, 'ดูประวัติ');

test('with the props it always had the menu renders as before', () => {
  assert.equal(renderToStaticMarkup(React.createElement(MoreActions, { label: 'เพิ่มเติม' }, entry)),
    '<details class="menu"><summary class="mangmee-btn mangmee-btn-secondary">เพิ่มเติม</summary><div class="panel"><button type="button">ดูประวัติ</button></div></details>');
  assert.match(renderToStaticMarkup(React.createElement(MoreActions, { label: 'เพิ่มเติม', align: 'end' }, entry)), /^<details class="menu end">/);
});

test('opens="up" hangs the list above the button, for a menu in a bottom bar; the phone still hangs it from the left', () => {
  assert.match(renderToStaticMarkup(React.createElement(MoreActions, { label: 'เพิ่มเติม', opens: 'up', align: 'end' }, entry)), /^<details class="menu end up">/);
  assert.match(css, /\.up > \.panel \{ top: auto; bottom: calc\(100% \+ \.375rem\);/);
  // The right-edge rule stays inside the 640 px media query, and an outside press still closes the list.
  assert.match(css, /@media \(min-width: 40rem\) \{ \.end > \.panel \{ inset-inline-start: auto; inset-inline-end: 0; \} \}/);
  assert.match(css, /\.menu\[open\] > summary::before \{ content: ''; position: fixed; inset: 0;/);
});

test('Escape closes the open list and returns to its button; closeOnPress is opt-in', () => {
  const source = readFileSync(new URL('./MoreActions.tsx', import.meta.url), 'utf8');
  assert.match(source, /closeOnPress = false/);
  assert.match(source, /if \(!closeOnPress\) return;/);
  assert.match(source, /event\.key !== 'Escape' \|\| !event\.currentTarget\.open/);
  assert.match(source, /querySelector\('summary'\)\?\.focus\(\)/);
});

test('concept menu has one borderless panel, plain rows and a white open trigger', () => {
  assert.match(css, /\.panel \{[^}]*border: 0;/);
  assert.match(css, /\.menu \.panel :is\(a, button\) \{[^}]*min-height: 44px;[^}]*box-shadow: none/);
  assert.match(css, /\.menu\[open\] > summary[^{}]*\{[^}]*background: var\(--color-surface\)/);
  assert.match(css, /mangmee-btn-danger/);
});

test('voucher and substitute-receipt entries retain one menu row each, including a red destructive row', () => {
  const html = renderToStaticMarkup(React.createElement(MoreActions, { label: 'เพิ่มเติม' },
    React.createElement('a', { href: '/history', className: 'mangmee-btn mangmee-btn-secondary' }, 'ดูประวัติ'),
    React.createElement('button', { type: 'button', className: 'mangmee-btn mangmee-btn-danger' }, 'ลบ')));
  assert.equal((html.match(/class="panel"/g) ?? []).length, 1);
  assert.match(html, /<a[^>]*>ดูประวัติ<\/a><button[^>]*>ลบ<\/button>/);
  assert.match(css, /summary:hover:not/);
});

test('icon variant names its 40px trigger, omits the chevron and anchors a phone menu to the right', () => {
  const html = renderToStaticMarkup(React.createElement(MoreActions, { label: 'ตัวเลือก', variant: 'icon', align: 'end', busy: true, closeOnPress: true }, entry));
  assert.match(html, /class="menu icon end"/);
  assert.match(html, /<summary class="mangmee-btn mangmee-btn-quiet" aria-label="ตัวเลือก" aria-busy="true"><svg aria-hidden="true"/);
  assert.doesNotMatch(html, />ตัวเลือก</);
  assert.match(css, /\.icon > summary \{[^}]*width: 40px; height: 40px; min-width: 40px; min-height: 40px;/);
  assert.match(css, /\.icon > summary::after \{ display: none;/);
  assert.match(css, /\.icon.end > \.panel \{ inset-inline-start: auto; inset-inline-end: 0;/);
});

test('closeOnPress closes an action menu before its dialog; ordinary menu keeps its working entry open', () => {
  for (const closeOnPress of [false, true]) {
    const node = MoreActions({ label: 'ตัวเลือก', variant: 'icon', closeOnPress, children: entry });
    let focused = false;
    const currentTarget = { open: true, querySelector: () => ({ focus: () => { focused = true; } }) };
    node.props.onClick({ currentTarget, target: { closest: () => ({ closest: () => true }) } });
    assert.equal(currentTarget.open, !closeOnPress); assert.equal(focused, closeOnPress);
  }
});

test('MOBILE-1 opening a menu clamps either edge on a 375px phone, including up and icon end menus', () => {
  const globals = globalThis as any;
  const previousWindow = globals.window;
  globals.window = { innerWidth: 375 };
  try {
    for (const props of [{}, { opens: 'up' }, { variant: 'icon', align: 'end' }] as const) {
      const node = MoreActions({ label: 'เพิ่มเติม', children: entry, ...props });
      for (const [left, width, expected] of [[260, 208, '-101px'], [-30, 208, '38px'], [16, 208, '0px']]) {
        const values: Record<string, string> = {};
        const panel = { style: { setProperty: (key: string, value: string) => { values[key] = value; } },
          getBoundingClientRect: () => ({ left, width }) };
        node.props.onToggle({ currentTarget: { open: true, querySelector: () => panel } });
        assert.equal(values['--panel-shift-x'], expected);
      }
    }
    assert.match(css, /\.panel \{[^}]*translate: var\(--panel-shift-x, 0px\) 0;/);
  } finally { globals.window = previousWindow; }
});
