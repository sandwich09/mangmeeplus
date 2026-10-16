import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const css = readFileSync(new URL('../../../../app/globals.css', import.meta.url), 'utf8');

test('a choice is a real radio or checkbox inside its label, with the form attributes passed through', async () => {
  const { ChoiceRow } = await import('./ChoiceRow');
  const radio = renderToStaticMarkup(React.createElement(ChoiceRow, { name: 'approver', value: 'u1', label: 'คุณศิริพร', description: 'ผู้จัดการสาขา', checked: true, required: true, onChange: () => {} }));
  const input = radio.match(/^<label class="mangmee-choice">(<input[^>]*\/>)/)?.[1] ?? '';
  for (const attribute of ['type="radio"', 'class="mangmee-choice-input"', 'name="approver"', 'value="u1"', 'checked=""', 'required=""']) assert.ok(input.includes(attribute), attribute);
  assert.match(radio, /<span class="mangmee-choice-text"><span class="mangmee-choice-label">คุณศิริพร<\/span><span class="mangmee-choice-description">ผู้จัดการสาขา<\/span><\/span><\/label>$/);
  const tick = renderToStaticMarkup(React.createElement(ChoiceRow, { type: 'checkbox', label: 'จดจำการเข้าสู่ระบบ', framed: true, disabled: true, className: 'mt-2' }));
  assert.match(tick, /^<label data-framed="true" class="mangmee-choice mt-2"><input[^>]*type="checkbox"[^>]*\/>/);
  assert.match(tick, /<input[^>]*disabled=""/); assert.match(tick, /<input[^>]*class="mangmee-choice-input"/);
  assert.doesNotMatch(tick, /mangmee-choice-description/);
});

test('the stylesheet: a 44 px row, a 20 px brand control, visible focus, and the chosen box marked by more than colour of the dot', () => {
  assert.match(css, /\.mangmee-choice \{[^}]*min-height: 2\.75rem;/);
  assert.match(css, /\.mangmee-choice-input \{[^}]*appearance: none;[^}]*width: 1\.25rem;\s*height: 1\.25rem;/);
  assert.match(css, /\.mangmee-choice-input:checked \{[^}]*background-color: var\(--color-brand-700\);/);
  assert.match(css, /\.mangmee-choice-input:focus-visible \{\s*outline: 2px solid/);
  assert.match(css, /\.mangmee-choice\[data-framed\]:has\(> \.mangmee-choice-input:checked\) \{[^}]*border-color: var\(--color-brand-600\);/);
});
