import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusExpenseField } from './expense-focus.logic';

test('field focus measures both sticky bars, keeps the whole field visible and prevents focus scrolling', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const scrolls: any[] = [], focuses: any[] = [];
  const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top });
  const top = { getBoundingClientRect: () => rect(0, 80) };
  const steps = { getBoundingClientRect: () => rect(80, 150) };
  const bar = { getBoundingClientRect: () => rect(700, 800) };
  const field = { closest: () => null, matches: () => true, getBoundingClientRect: () => rect(730, 790), focus: (options: any) => focuses.push(options) };
  (globalThis as any).document = { querySelector: (s: string) => s === '[data-app-top-bar]' ? top : steps, querySelectorAll: () => [bar] };
  (globalThis as any).window = { innerHeight: 800, getComputedStyle: () => ({ position: 'sticky' }), matchMedia: () => ({ matches: true }), scrollBy: (options: any) => scrolls.push(options) };
  try {
    focusExpenseField(field as any);
    assert.deepEqual(scrolls, [{ top: 98, behavior: 'auto' }]);
    assert.deepEqual(focuses, [{ preventScroll: true }]);
    field.getBoundingClientRect = () => rect(100, 140);
    focusExpenseField(field as any);
    assert.equal(scrolls[1].top, -58);
    field.getBoundingClientRect = () => rect(200, 260);
    focusExpenseField(field as any); assert.equal(scrolls.length, 2);
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test('a cancelled row inside a dialog scrolls that body and focuses its history heading without moving the page', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const scrolls: any[] = [], focuses: any[] = [];
  const body = { getBoundingClientRect: () => ({ top: 200, bottom: 600 }), scrollBy: (value: any) => scrolls.push(value) };
  const row = { closest: (selector: string) => selector === '[data-modal-body]' ? body : null, getBoundingClientRect: () => ({ top: 650, bottom: 850, height: 200 }) };
  const heading = { matches: () => true, focus: (value: any) => focuses.push(value) };
  (globalThis as any).document = { querySelector: () => null, querySelectorAll: () => [] };
  (globalThis as any).window = { innerHeight: 800, matchMedia: () => ({ matches: false }), scrollBy: () => assert.fail('must not scroll behind the dialog') };
  try {
    focusExpenseField(row as any, heading as any);
    assert.deepEqual(scrolls, [{ top: 258, behavior: 'smooth' }]);
    assert.deepEqual(focuses, [{ preventScroll: true }]);
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});
