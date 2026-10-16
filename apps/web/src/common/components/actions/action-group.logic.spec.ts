import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { decideActionLayout } from './action-group.logic';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const css = readFileSync(new URL('../../../../app/globals.css', import.meta.url), 'utf8');

test('two buttons share a row only when both can be as wide as the longer name', () => {
  // A phone dialog: 358 px between the paddings, 8 px between the buttons.
  assert.equal(decideActionLayout({ available: 358, naturals: [73, 112], gap: 8 }), 'row');
  assert.equal(decideActionLayout({ available: 358, naturals: [73, 175], gap: 8 }), 'row', 'exactly fits: 175 + 8 + 175');
  assert.equal(decideActionLayout({ available: 358, naturals: [73, 176], gap: 8 }), 'stack', 'one pixel short: the short button may not sit beside a squeezed long one');
});

test('from 640 px a column is never narrower than 8rem, so short names still make even buttons', () => {
  assert.equal(decideActionLayout({ available: 408, naturals: [56, 60], gap: 8, minColumn: 128 }), 'row');
  assert.equal(decideActionLayout({ available: 250, naturals: [56, 60], gap: 8, minColumn: 128 }), 'stack');
  assert.equal(decideActionLayout({ available: 408, naturals: [90, 230], gap: 8, minColumn: 128 }), 'stack', 'the long name sets the width of both');
});

test('a phone puts at most three buttons on a row; a lone button is never a stack', () => {
  assert.equal(decideActionLayout({ available: 358, naturals: [60, 60, 60], gap: 8, maxColumns: 3 }), 'row');
  assert.equal(decideActionLayout({ available: 358, naturals: [40, 40, 40, 40], gap: 8, maxColumns: 3 }), 'stack');
  assert.equal(decideActionLayout({ available: 900, naturals: [40, 40, 40, 40], gap: 8, minColumn: 128 }), 'row');
  assert.equal(decideActionLayout({ available: 100, naturals: [400] }), 'row');
  assert.equal(decideActionLayout({ available: 100, naturals: [] }), 'row');
});

test('before it is measured the group renders in DOM order with the CSS default', async () => {
  const { ActionGroup } = await import('./ActionGroup');
  const html = renderToStaticMarkup(React.createElement(ActionGroup, { align: 'start' },
    React.createElement('button', { type: 'button' }, 'ไม่ลบ'),
    React.createElement('button', { type: 'button' }, 'ลบไฟล์')));
  assert.match(html, /^<div data-align="start" class="mangmee-actions"><button type="button">ไม่ลบ<\/button><button type="button">ลบไฟล์<\/button><\/div>$/);
  assert.doesNotMatch(html, /data-layout/);
});

test('the stylesheet keeps the order rule: a stack is drawn in reverse, a row keeps DOM order', () => {
  const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
  assert.match(rule('\n.mangmee-actions'), /flex-direction: column-reverse/);
  assert.match(rule(".mangmee-actions[data-layout='row']"), /grid-auto-flow: column/);
  assert.match(rule(".mangmee-actions[data-layout='row']"), /grid-auto-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.mangmee-actions:not\(\[data-layout='stack'\]\) \{[^}]*grid-auto-columns: minmax\(8rem, 1fr\)/);
});

test('a compact group can sit at the right (default), at the left or in the middle', async () => {
  const { ActionGroup } = await import('./ActionGroup');
  const centred = renderToStaticMarkup(React.createElement(ActionGroup, { align: 'center' }, React.createElement('button', { type: 'button' }, 'ลองอีกครั้ง')));
  assert.match(centred, /^<div data-align="center" class="mangmee-actions">/);
  assert.match(css, /\.mangmee-actions\[data-align='start'\] \{\s*margin-inline-start: 0;/);
  assert.match(css, /\.mangmee-actions\[data-align='center'\] \{\s*margin-inline: auto;/);
});

test('the pinned form bar reserves its height, so a field brought into view never sits under the bar', () => {
  // 2026-10-16: the substitute wizard's "จ่ายครบ" tick sat under the bar with one pixel showing; a press landed on the bar.
  assert.match(css, /html \{\n  scroll-padding-bottom: calc\(var\(--mangmee-form-bar-height, 0px\) \+ 0\.5rem\);\n\}/);
  const bar = readFileSync(new URL('./FormActionBar.tsx', import.meta.url), 'utf8');
  assert.match(bar, /root\.style\.setProperty\('--mangmee-form-bar-height', getComputedStyle\(element\)\.position === 'sticky' \? `\$\{element\.offsetHeight\}px` : '0px'\)/);
  assert.match(bar, /root\.style\.removeProperty\('--mangmee-form-bar-height'\)/);
});
