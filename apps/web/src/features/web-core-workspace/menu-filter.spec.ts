import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptySlot, readSlot, slotFor } from './menu-filter.logic';

describe('slotFor', () => {
  // The list → detail → back trip: the detail route resolves to the same menu, so the slot
  // (and the user's กันยายน) is the very same object on the way back.
  it('keeps the slot while the menu is unchanged', () => {
    const slot = emptySlot('expenses');
    slot.values.set('expenses.list.month', '2026-09');
    assert.equal(slotFor(slot, 'expenses'), slot);
    assert.equal(slotFor(slot, 'expenses').values.get('expenses.list.month'), '2026-09');
  });

  it('drops everything when the menu changes', () => {
    const slot = emptySlot('expenses');
    slot.values.set('expenses.list.month', '2026-09');
    const next = slotFor(slot, 'dashboard');
    assert.notEqual(next, slot);
    assert.equal(next.menuKey, 'dashboard');
    assert.equal(next.values.size, 0);
  });

  it('treats an unrecognised route as its own menu', () => {
    const slot = emptySlot('expenses');
    slot.values.set('k', 'v');
    assert.equal(slotFor(slot, null).values.size, 0);
    // ...and stays cleared rather than thrashing while the route stays unrecognised.
    const cleared = slotFor(slot, null);
    assert.equal(slotFor(cleared, null), cleared);
  });
});

describe('readSlot', () => {
  it('falls back to the default when nothing is stored', () => {
    assert.equal(readSlot(emptySlot('expenses'), 'month', () => '2026-08'), '2026-08');
  });

  it('returns a stored value in place of the default', () => {
    const slot = emptySlot('expenses');
    slot.values.set('month', '2026-09');
    assert.equal(readSlot(slot, 'month', () => '2026-08'), '2026-09');
  });

  // The evidence panel stores '' for "all months". A ?? would have thrown that away and
  // silently snapped the folder back to its default.
  it('round-trips falsy values instead of treating them as absent', () => {
    const slot = emptySlot('expenses.evidence');
    slot.values.set('yearMonth', '');
    assert.equal(readSlot(slot, 'yearMonth', () => '2026-08'), '');
  });

  it('only evaluates the default when it is needed', () => {
    const slot = emptySlot('expenses');
    slot.values.set('month', '2026-09');
    let calls = 0;
    readSlot(slot, 'month', () => { calls += 1; return 'x'; });
    assert.equal(calls, 0);
  });
});
