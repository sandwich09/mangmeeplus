import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { requestInAppNavigation, UNSAVED_NAVIGATION_EVENT } from './request-navigation';
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as Record<string, unknown>)['window'];
});
test('direct navigation proceeds when no dirty form guards it and can be held for the three-outcome dialog', () => {
  const target = new EventTarget();
  (globalThis as Record<string, unknown>)['window'] = target;
  let navigations = 0;
  requestInAppNavigation(() => { navigations++; });
  assert.equal(navigations, 1);
  let pending: (() => void) | undefined;
  target.addEventListener(UNSAVED_NAVIGATION_EVENT, event => { event.preventDefault(); pending = (event as CustomEvent<() => void>).detail; });
  requestInAppNavigation(() => { navigations++; });
  assert.equal(navigations, 1);
  pending!();
  assert.equal(navigations, 2);
});
