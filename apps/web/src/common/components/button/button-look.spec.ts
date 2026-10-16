import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// docs/guidelines/thai-ux-standard.md §2 and §5: one look of button, and Thai text that sits right.
const css = readFileSync(new URL('../../../../app/globals.css', import.meta.url), 'utf8');

test('the Button component draws the same four looks as the .mangmee-btn classes', async () => {
  const { Button } = await import('./Button');
  const { primaryButtonClass, secondaryButtonClass, quietButtonClass, dangerButtonClass } = await import('./button-classes');
  const html = (props: object) => renderToStaticMarkup(React.createElement(Button, props, 'บันทึก'));
  assert.match(html({}), new RegExp(`data-variant="primary" class="${primaryButtonClass}"`));
  assert.match(html({ variant: 'secondary' }), new RegExp(`data-variant="secondary" class="${secondaryButtonClass}"`));
  assert.match(html({ variant: 'quiet' }), new RegExp(`data-variant="quiet" class="${quietButtonClass}"`));
  assert.match(html({ variant: 'ghost' }), new RegExp(`data-variant="quiet" class="${quietButtonClass}"`), 'ghost is the old name of quiet');
  // Destructive is the pale-red look, in dialogs too: never a solid red block.
  assert.match(html({ variant: 'danger' }), new RegExp(`data-variant="danger" class="${dangerButtonClass}"`));
  assert.doesNotMatch(html({ variant: 'danger' }), /bg-red-|text-white/);
  // The caller's own classes follow the look; no size utilities of the component's own are left to fight it.
  assert.match(html({ className: 'w-full' }), /class="mangmee-btn mangmee-btn-primary w-full"/);
  assert.doesNotMatch(html({ size: 'sm' }), /\bh-\d|rounded-lg|font-medium/);
  assert.match(html({ size: 'lg' }), /data-size="lg"/);
  assert.doesNotMatch(html({}), /data-size/);
});

test('every look has hover, focus, disabled and busy states, alike on a button and on a link', () => {
  for (const look of ['primary', 'secondary', 'quiet', 'danger']) {
    assert.match(css, new RegExp(`\\.mangmee-btn-${look} \\{`), look);
    assert.match(css, new RegExp(`\\.mangmee-btn-${look}:hover:not\\(:disabled, \\[aria-disabled='true'\\]\\) \\{`), `${look} hover`);
  }
  assert.match(css, /\.mangmee-btn:focus-visible \{\s*outline: 2px solid/);
  assert.match(css, /\.mangmee-btn:disabled,\s*\.mangmee-btn\[aria-disabled='true'\] \{/);
  assert.match(css, /a\.mangmee-btn\[aria-busy='true'\]:not\(\[data-loading-indicator\]\)::before/);
  // 44 px on a phone, 40 px from 640 px; the line-height is stated so an inherited one cannot change the height.
  const base = css.slice(css.indexOf('\n.mangmee-btn {'), css.indexOf('}', css.indexOf('\n.mangmee-btn {')));
  assert.match(base, /min-height: 2\.75rem/); assert.match(base, /line-height: 1\.5/); assert.match(base, /font-weight: 700/);
  assert.match(css, /@media \(min-width: 40rem\) \{\s*\.mangmee-btn \{\s*min-height: 2\.5rem/);
});

test('hidden and the responsive display utilities work on a shared button: only its display sits below the utilities', () => {
  // The display is declared once, inside the components layer (Tailwind's utilities layer comes after it) …
  assert.match(css, /@layer components \{\s*\.mangmee-btn \{\s*display: inline-flex;\s*\}\s*\}/);
  // … and nowhere in the plain rule, which would outrank `hidden` / `sm:hidden` again.
  const plain = css.slice(css.indexOf('\n.mangmee-btn {'), css.indexOf('}', css.indexOf('\n.mangmee-btn {')));
  assert.doesNotMatch(plain, /display:/);
  assert.match(plain, /min-height: 2\.75rem/, 'the rest of the look stays plain CSS and keeps winning');
});

test('a tab is 44 px on a phone and 40 px from 640 px: its wide-screen rule comes after its own rule', () => {
  const own = css.indexOf('\n.mangmee-tab {');
  const wide = css.search(/@media \(min-width: 40rem\) \{\s*\.mangmee-tab \{\s*min-height: 2\.5rem;/);
  assert.match(css.slice(own, css.indexOf('}', own)), /min-height: 2\.75rem/);
  assert.ok(wide > own, 'declared before the tab rule it lost by order, and tabs stayed 44 px on wide screens');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /display: revert/);
});

test('the names the expense workspace uses are the shared looks', async () => {
  const ui = readFileSync(new URL('../../../features/expenses/ExpensesUi.tsx', import.meta.url), 'utf8');
  assert.match(ui, /export const btnClass = primaryButtonClass;/);
  assert.match(ui, /export const ghostClass = secondaryButtonClass;/);
  assert.match(ui, /export const dangerClass = dangerButtonClass;/);
  assert.match(ui, /export const successBtn = primaryButtonClass;/, 'the hand-made copy of primary is primary');
  assert.match(ui, /export const successBtnStyle = \{\} as const;/);
});

test('Thai text: no fake 800 weight, and the text sizes that wrap have room for the marks', () => {
  assert.doesNotMatch(css, /font-weight: (800|900)/);
  assert.match(css, /--font-weight-extrabold: 700;/);
  const lineHeight = (size: string) => Number(css.match(new RegExp(`--text-${size}--line-height: ([\\d.]+);`))?.[1]);
  for (const size of ['xs', 'sm', 'base', 'lg', 'xl', '2xl']) assert.ok(lineHeight(size) >= 1.5, `text-${size} ${lineHeight(size)}`);
  for (const size of ['sm', 'base', 'lg']) assert.ok(lineHeight(size) >= 1.6, `text-${size}, the sizes set in bold and wrapped`);
  // No rule on the whole page that breaks Thai words or splits amounts; one small class keeps a unit whole.
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /(?:^|\})\s*(?:html|body|:root|\*)[^{}]*\{[^}]*(?:word-break|overflow-wrap|line-break)/);
  assert.match(css, /\.mangmee-unit \{\s*white-space: nowrap;\s*font-variant-numeric: tabular-nums;/);
});
