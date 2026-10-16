import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addToast, removeToast, toastDuration, visibleToasts, toastStackStyle } from './toast.logic';
import type { ToastItem } from './toast.model';

test('adds toasts with stable ids from the injected clock', () => {
  const first = addToast([], { tone: 'success', message: 'Saved' }, 100);
  const second = addToast(first, { tone: 'warning', message: 'Check this' }, 200);

  assert.deepEqual(first, [{ id: 100, tone: 'success', message: 'Saved' }]);
  assert.deepEqual(second.map((item) => item.id), [100, 200]);
});

test('deduplicates a visible message even after one second, and permits it after dismissal', () => {
  const first = addToast([], { tone: 'success', message: 'Saved' }, 100);
  assert.equal(addToast(first, { tone: 'success', message: 'Saved' }, 1_099), first);
  assert.equal(addToast(first, { tone: 'warning', message: 'Saved' }, 1_099).length, 2);
  assert.equal(addToast(first, { tone: 'success', message: 'Saved' }, 3_000), first);
  assert.equal(addToast(removeToast(first, 100), { tone: 'success', message: 'Saved' }, 3_000).length, 1);
});

test('caps the queue at three and drops the oldest toast', () => {
  let items = addToast([], { tone: 'success', message: 'One' }, 1);
  items = addToast(items, { tone: 'success', message: 'Two' }, 2);
  items = addToast(items, { tone: 'warning', message: 'Three' }, 3);
  items = addToast(items, { tone: 'error', message: 'Four' }, 4);

  assert.deepEqual(items.map((item) => item.id), [2, 3, 4]);
});

test('shows newest toasts first without mutating the input array', () => {
  const items: ToastItem[] = [
    { id: 1, tone: 'success', message: 'One' },
    { id: 2, tone: 'warning', message: 'Two' },
    { id: 3, tone: 'error', message: 'Three' },
  ];

  assert.deepEqual(visibleToasts(items).map((item) => item.id), [3, 2, 1]);
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3]);
});

test('removes only the requested toast without changing remaining ids', () => {
  const items = [
    { id: 1, tone: 'success' as const, message: 'One' },
    { id: 2, tone: 'warning' as const, message: 'Two' },
  ];
  assert.deepEqual(removeToast(items, 1), [{ id: 2, tone: 'warning', message: 'Two' }]);
  assert.equal(removeToast(items, 3), items);
});

test('uses four-second success and warning durations and six seconds for errors', () => {
  assert.equal(toastDuration('success'), 4_000);
  assert.equal(toastDuration('warning'), 4_000);
  assert.equal(toastDuration('error'), 6_000);
});


test('BEH-Q phones place toasts above bottom actions; wide screens clear the top stack', () => {
  const bounds = { top: 140, bottom: 720, left: 0, right: 390 };
  assert.deepEqual(toastStackStyle(390, 844, bounds), { top: 'auto', bottom: 'calc(124px + 0.75rem + env(safe-area-inset-bottom, 0px))' });
  assert.equal(toastStackStyle(1556, 900, { ...bounds, bottom: 900 }).top, 'calc(140px + 0.75rem + env(safe-area-inset-top, 0px))');
  assert.equal(toastStackStyle(390, 844, { ...bounds, bottom: 844 }).bottom, 'calc(0px + 0.75rem + env(safe-area-inset-bottom, 0px))');
});
