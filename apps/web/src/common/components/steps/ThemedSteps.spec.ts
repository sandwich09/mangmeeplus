import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const STEPS = [
  { key: 'a', label: 'ข้อมูลส่วนตัว', state: 'done' as const },
  { key: 'b', label: 'ช่องทางติดต่อ', description: 'อีเมลและเบอร์โทร', state: 'current' as const },
  { key: 'c', label: 'เข้าใช้งาน', state: 'upcoming' as const },
];

test('marks only the current step with aria-current and shows labels + description', async () => {
  const { ThemedSteps } = await import('./ThemedSteps');
  const html = renderToStaticMarkup(React.createElement(ThemedSteps, { steps: STEPS, 'aria-label': 'ขั้นตอน' }));

  assert.equal(html.match(/aria-current="step"/g)?.length, 1);
  assert.match(html, /aria-label="ขั้นตอน"/);
  assert.match(html, /ข้อมูลส่วนตัว/);
  assert.match(html, /อีเมลและเบอร์โทร/);
  // done = check mark path, current = brand square with halo ring, upcoming = gray square
  assert.match(html, /m5 10\.5 3\.5 3\.5L15 6\.5/);
  assert.match(html, /ring-brand-100/);
  assert.match(html, /bg-gray-300/);
});

test('connector after a done step is brand, after the current step fades to gray', async () => {
  const { ThemedSteps } = await import('./ThemedSteps');
  const html = renderToStaticMarkup(React.createElement(ThemedSteps, { steps: STEPS }));

  assert.match(html, /bg-brand-500(?![^"]*from)/);
  assert.match(html, /from-brand-500 to-gray-200/);
});

test('href renders a link, onSelect renders a button, neither renders a plain node', async () => {
  const { ThemedSteps } = await import('./ThemedSteps');
  const html = renderToStaticMarkup(React.createElement(ThemedSteps, {
    steps: [
      { key: 'a', label: 'A', state: 'done' as const, href: '/x' },
      { key: 'b', label: 'B', state: 'current' as const, onSelect: () => {} },
      { key: 'c', label: 'C', state: 'upcoming' as const },
    ],
  }));

  assert.match(html, /<a[^>]*href="\/x"/);
  assert.match(html, /<button[^>]*type="button"/);
});
