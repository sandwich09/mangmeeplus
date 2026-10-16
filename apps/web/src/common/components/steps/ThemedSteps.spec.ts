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
  // every node shows its number; current also carries the halo ring
  assert.match(html, />1</);
  assert.match(html, />2</);
  assert.match(html, />3</);
  assert.match(html, /ring-brand-100/);
});

test('passed and current are brand circles, upcoming is a gray-numbered outline', async () => {
  const { ThemedSteps } = await import('./ThemedSteps');
  const html = renderToStaticMarkup(React.createElement(ThemedSteps, { steps: STEPS }));

  assert.equal(html.match(/bg-brand-500/g)!.filter(Boolean).length >= 2, true);
  assert.match(html, /border-gray-200[^"]*text-gray-400/);
  // no completion icons in the สรรพากร-style design — numbers only
  assert.doesNotMatch(html, /<svg/);
});

test('connector is brand only behind a passed step — the current step\'s outbound segment is gray', async () => {
  const { ThemedSteps } = await import('./ThemedSteps');
  const html = renderToStaticMarkup(React.createElement(ThemedSteps, { steps: STEPS }));

  const segments = html.match(/aria-hidden="true" class="[^"]*(bg-brand-500|bg-gray-200)/g)!;
  // 3 nodes → 4 half-segments: after(done)=brand, before(current)=gray? no — before keys off previous
  // node: after node1(done)=brand, before node2(prev done)=brand, after node2(current)=gray, before node3(prev current)=gray
  const tones = segments.map((s) => (s.includes('bg-brand-500') ? 'brand' : 'gray'));
  assert.deepEqual(tones, ['brand', 'brand', 'gray', 'gray']);
  assert.doesNotMatch(html, /from-brand-500/);
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

test('with onStepPress only the finished steps are buttons; without it nothing is pressable', async () => {
  const { ThemedSteps } = await import('./ThemedSteps');
  const plain = renderToStaticMarkup(React.createElement(ThemedSteps, { steps: STEPS }));
  assert.doesNotMatch(plain, /<button|<a /);
  const pressed: number[] = [];
  const html = renderToStaticMarkup(React.createElement(ThemedSteps, { steps: STEPS, onStepPress: (index: number) => { pressed.push(index); } }));
  // One button, holding the circle and the name of the finished step; 44 px target and a visible focus ring.
  assert.equal(html.match(/<button/g)?.length, 1);
  assert.match(html, /<button type="button" data-step-back="true"[^>]*class="[^"]*min-h-11 min-w-11[^"]*focus-visible:outline-2[^"]*">.*?>1<\/span>.*?ข้อมูลส่วนตัว.*?<\/button>/);
  // The current and the coming step stay plain text, and the current one is still the only aria-current.
  assert.match(html, /<span aria-current="step"[^>]*>.*?ช่องทางติดต่อ/);
  assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>).)*เข้าใช้งาน/);
  assert.equal(html.match(/aria-current="step"/g)?.length, 1);
  // A step that brings its own link keeps it.
  const own = renderToStaticMarkup(React.createElement(ThemedSteps, { steps: [{ ...STEPS[0]!, href: '/x' }, STEPS[1]!], onStepPress: () => {} }));
  assert.match(own, /<a[^>]*href="\/x"/); assert.doesNotMatch(own, /data-step-back/);
});
