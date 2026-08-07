import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeFreeStartSlots, isSlotFree } from './crm-booking.logic';

function bangkok(hour: number, minute = 0) {
  return new Date(Date.UTC(2026, 6, 9, hour - 7, minute));
}

function booking(startHour: number, startMinute: number, endHour: number, endMinute: number, status = 'BOOKED') {
  return { startAt: bangkok(startHour, startMinute), endAt: bangkok(endHour, endMinute), status };
}

describe('computeFreeStartSlots', () => {
  const now = new Date('2026-07-08T00:00:00.000Z');

  it('returns the full valid grid for an empty day', () => {
    const slots = computeFreeStartSlots({ date: '2026-07-09', durationMinutes: 60, existingBookings: [], now, bufferMinutes: 0 });
    assert.equal(slots.length, 21);
    assert.equal(slots[0], bangkok(9, 0).toISOString());
    assert.equal(slots.at(-1), bangkok(19, 0).toISOString());
  });

  it('blocks starts that overlap an existing booking', () => {
    const slots = computeFreeStartSlots({
      date: '2026-07-09',
      durationMinutes: 60,
      existingBookings: [booking(10, 0, 11, 0)],
      now,
      bufferMinutes: 0,
    });
    assert.ok(slots.includes(bangkok(9, 0).toISOString()));
    assert.ok(!slots.includes(bangkok(10, 0).toISOString()));
    assert.ok(slots.includes(bangkok(11, 0).toISOString()));
  });

  it('blocks a start whose duration would run into a booking', () => {
    const slots = computeFreeStartSlots({
      date: '2026-07-09',
      durationMinutes: 90,
      existingBookings: [booking(11, 0, 12, 0)],
      now,
      bufferMinutes: 0,
    });
    assert.ok(slots.includes(bangkok(9, 30).toISOString()));
    assert.ok(!slots.includes(bangkok(10, 0).toISOString()));
    assert.ok(!slots.includes(bangkok(10, 30).toISOString()));
  });

  it('excludes starts that do not leave room before 20:00', () => {
    const slots = computeFreeStartSlots({ date: '2026-07-09', durationMinutes: 90, existingBookings: [], now, bufferMinutes: 0 });
    assert.ok(slots.includes(bangkok(18, 30).toISOString()));
    assert.ok(!slots.includes(bangkok(19, 0).toISOString()));
  });

  it('does not let cancelled bookings block starts', () => {
    const slots = computeFreeStartSlots({
      date: '2026-07-09',
      durationMinutes: 60,
      existingBookings: [booking(10, 0, 11, 0, 'CANCELLED')],
      now,
      bufferMinutes: 60,
    });
    assert.ok(slots.includes(bangkok(10, 0).toISOString()));
  });

  it('never returns past starts', () => {
    const currentDay = computeFreeStartSlots({
      date: '2026-07-09', durationMinutes: 60, existingBookings: [], now: bangkok(10, 30), bufferMinutes: 0,
    });
    assert.deepEqual(currentDay.slice(0, 2), [bangkok(10, 30).toISOString(), bangkok(11, 0).toISOString()]);
    assert.deepEqual(computeFreeStartSlots({ date: '2026-07-08', durationMinutes: 60, existingBookings: [], now: bangkok(10, 30), bufferMinutes: 0 }), []);
  });

  it('applies the configured empty buffer after an existing booking', () => {
    const slots = computeFreeStartSlots({
      date: '2026-07-09', durationMinutes: 60, existingBookings: [booking(10, 0, 11, 0)], now, bufferMinutes: 60,
    });
    assert.ok(!slots.includes(bangkok(11, 30).toISOString()));
    assert.ok(slots.includes(bangkok(12, 0).toISOString()));
  });
});

describe('isSlotFree', () => {
  it('returns true when there is no overlap', () => {
    assert.equal(isSlotFree(bangkok(9, 0), bangkok(10, 0), [booking(11, 0, 12, 0)]), true);
  });

  it('returns false when the slot overlaps a booking', () => {
    assert.equal(isSlotFree(bangkok(9, 30), bangkok(10, 30), [booking(10, 0, 11, 0)]), false);
  });

  it('treats adjacent half-open boundaries as free', () => {
    assert.equal(isSlotFree(bangkok(9, 0), bangkok(10, 0), [booking(10, 0, 11, 0)]), true);
    assert.equal(isSlotFree(bangkok(11, 0), bangkok(12, 0), [booking(10, 0, 11, 0)]), true);
  });

  it('blocks adjacent slots until the configured buffer has elapsed', () => {
    assert.equal(isSlotFree(bangkok(11, 30), bangkok(12, 30), [booking(10, 0, 11, 0)], 60), false);
    assert.equal(isSlotFree(bangkok(12, 0), bangkok(13, 0), [booking(10, 0, 11, 0)], 60), true);
  });
});
