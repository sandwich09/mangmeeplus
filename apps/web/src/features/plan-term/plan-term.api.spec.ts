import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { notifyPlanTermChanged, PLAN_TERM_CHANGED_EVENT } from './plan-term.api';

describe('PLAN_TERM_CHANGED_EVENT / notifyPlanTermChanged', () => {
  it('names the event watchdog:plan-term-changed', () => {
    assert.equal(PLAN_TERM_CHANGED_EVENT, 'watchdog:plan-term-changed');
  });

  it('dispatches the event on window when one exists (RV30: BillingPage tells WorkspaceLayoutClient a purchase confirmed)', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const target = new EventTarget();
    let fired = 0;
    target.addEventListener(PLAN_TERM_CHANGED_EVENT, () => fired++);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    try {
      notifyPlanTermChanged();
      assert.equal(fired, 1);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('is a no-op with no window (server-rendered call site), never throws', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'window');
    try {
      assert.doesNotThrow(() => notifyPlanTermChanged());
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    }
  });
});
