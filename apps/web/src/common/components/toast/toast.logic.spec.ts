import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addToast, removeToast, toastDuration } from './toast.logic';

test('adds toasts with stable ids from the injected clock', () => {
  const first = addToast([], { tone: 'success', message: 'Saved' }, 100);
  const second = addToast(first, { tone: 'warning', message: 'Check this' }, 200);

  assert.deepEqual(first, [{ id: 100, tone: 'success', message: 'Saved' }]);
  assert.deepEqual(second.map((item) => item.id), [100, 200]);
});

test('deduplicates the same tone and message only within the one-second window', () => {
  const first = addToast([], { tone: 'success', message: 'Saved' }, 100);
  assert.equal(addToast(first, { tone: 'success', message: 'Saved' }, 1_099), first);
  assert.equal(addToast(first, { tone: 'warning', message: 'Saved' }, 1_099).length, 2);
  assert.equal(addToast(first, { tone: 'success', message: 'Saved' }, 1_100).length, 2);
});

test('caps the queue at three and drops the oldest toast', () => {
  let items = addToast([], { tone: 'success', message: 'One' }, 1);
  items = addToast(items, { tone: 'success', message: 'Two' }, 2);
  items = addToast(items, { tone: 'warning', message: 'Three' }, 3);
  items = addToast(items, { tone: 'error', message: 'Four' }, 4);

  assert.deepEqual(items.map((item) => item.id), [2, 3, 4]);
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
