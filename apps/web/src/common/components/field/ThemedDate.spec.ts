import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('a required report month can hide clearing while existing date fields remain clearable', () => {
  const source = readFileSync(new URL('./ThemedDate.tsx', import.meta.url), 'utf8');
  assert.match(source, /allowClear = true/);
  assert.match(source, /\{allowClear && <button[^\n]*emit\(''\)/);
});

test('name prop renders an sr-only form input carrying the value and required flag', async () => {
  const { ThemedDate } = await import('./ThemedDate');
  const html = renderToStaticMarkup(React.createElement(ThemedDate, {
    name: 'evidenceDate',
    required: true,
    defaultValue: '2026-01-15',
  }));

  assert.match(html, /<input[^>]*name="evidenceDate"/);
  assert.match(html, /<input[^>]*required/);
  assert.match(html, /<input[^>]*value="2026-01-15"/);
  assert.match(html, /<input[^>]*class="sr-only"/);
  assert.match(html, /<button[^>]*aria-required="true"/, 'the visible picker exposes its required state to assistive technology');
  assert.match(html, /<button[^>]*role="combobox"/);
  assert.match(html, /<button[^>]*aria-haspopup="dialog"/);
  // Uncontrolled defaultValue drives the visible label (Thai Buddhist year).
  assert.match(html, /15 ม\.ค\. 2569/);
});

test('without name no form input is rendered and the placeholder shows', async () => {
  const { ThemedDate } = await import('./ThemedDate');
  const html = renderToStaticMarkup(React.createElement(ThemedDate, {}));

  assert.doesNotMatch(html, /<input/);
  assert.match(html, /เลือกวันที่/);
});

test('month mode labels the value as month + Buddhist year', async () => {
  const { ThemedDate } = await import('./ThemedDate');
  const html = renderToStaticMarkup(React.createElement(ThemedDate, {
    mode: 'month',
    value: '2026-08',
  }));

  assert.match(html, /ส\.ค\. 2569/);
});

test('validation state and description are exposed by the visible picker', async () => {
  const { ThemedDate } = await import('./ThemedDate');
  const html = renderToStaticMarkup(React.createElement(ThemedDate, {
    'aria-label': 'Expense date',
    'aria-describedby': 'expense-date-error',
    'aria-invalid': true,
    required: true,
  }));

  assert.match(html, /<button[^>]*aria-describedby="expense-date-error"/);
  assert.match(html, /<button[^>]*aria-invalid="true"/);
  assert.match(html, /<button[^>]*aria-required="true"/);
});

test('a list of selectable values disables the rest inside min and max (report months that are not built yet)', async () => {
  const { outOfRange } = await import('./ThemedDate');
  const built = ['2026-06', '2026-10'];
  assert.equal(outOfRange('2026-11', '2026-06', '2026-11', 7, built), true, 'in range but not in the list');
  assert.equal(outOfRange('2026-10', '2026-06', '2026-11', 7, built), false);
  assert.equal(outOfRange('2026-05', '2026-06', '2026-11', 7, ['2026-05']), true, 'the range still applies to a listed value');
  assert.equal(outOfRange('2026-11', '2026-06', '2026-11', 7), false, 'without a list only the range applies');
  // The same check guards the pick itself, the month grid, the day grid and the "this month"/"today" button.
  const source = readFileSync(new URL('./ThemedDate.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/outOfRange\(.*, selectable\)/g) ?? []).length, 4);
});
