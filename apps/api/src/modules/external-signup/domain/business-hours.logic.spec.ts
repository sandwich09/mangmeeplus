import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBusinessHours, nextBusinessStart, parseBusinessHours } from './business-hours.logic';

const CONFIG = { days: 'MON-SAT', hours: '09:00-18:00' } as const;

/** Bangkok wall-clock time as a UTC instant. Asia/Bangkok is UTC+7 with no DST. */
function bkk(iso: string): Date {
  return new Date(`${iso}+07:00`);
}

describe('isBusinessHours (Asia/Bangkok)', () => {
  it('opens at 09:00 sharp and is shut at 18:00 sharp', () => {
    // Thursday.
    assert.equal(isBusinessHours(bkk('2026-09-03T08:59:59'), CONFIG), false);
    assert.equal(isBusinessHours(bkk('2026-09-03T09:00:00'), CONFIG), true);
    assert.equal(isBusinessHours(bkk('2026-09-03T17:59:59'), CONFIG), true);
    assert.equal(isBusinessHours(bkk('2026-09-03T18:00:00'), CONFIG), false);
  });

  it('is closed all Sunday and open all Saturday', () => {
    assert.equal(isBusinessHours(bkk('2026-09-06T12:00:00'), CONFIG), false, 'Sunday');
    assert.equal(isBusinessHours(bkk('2026-09-05T12:00:00'), CONFIG), true, 'Saturday');
  });

  it('reads the Bangkok clock, not the server clock', () => {
    // 03:00 UTC is 10:00 in Bangkok — open — and 23:00 UTC is 06:00 the NEXT Bangkok day.
    assert.equal(isBusinessHours(new Date('2026-09-03T03:00:00.000Z'), CONFIG), true);
    assert.equal(isBusinessHours(new Date('2026-09-03T23:00:00.000Z'), CONFIG), false);
    // Sunday 18:00 UTC is already Monday 01:00 in Bangkok: a closed day by Bangkok, not by UTC.
    assert.equal(isBusinessHours(new Date('2026-09-06T18:00:00.000Z'), CONFIG), false);
  });
});

describe('nextBusinessStart', () => {
  it('returns the same instant while the office is open', () => {
    const now = bkk('2026-09-03T10:00:00');
    assert.equal(nextBusinessStart(now, CONFIG).getTime(), now.getTime());
  });

  it('waits for this morning when the application arrives before opening', () => {
    assert.equal(
      nextBusinessStart(bkk('2026-09-03T06:30:00'), CONFIG).getTime(),
      bkk('2026-09-03T09:00:00').getTime(),
    );
  });

  it('rolls an evening application to the next morning', () => {
    assert.equal(
      nextBusinessStart(bkk('2026-09-03T21:00:00'), CONFIG).getTime(),
      bkk('2026-09-04T09:00:00').getTime(),
    );
  });

  it('carries a Sunday application to Monday 09:00 — the §3.3 promise', () => {
    assert.equal(
      nextBusinessStart(bkk('2026-09-06T11:00:00'), CONFIG).getTime(),
      bkk('2026-09-07T09:00:00').getTime(),
    );
    // Saturday evening skips Sunday entirely.
    assert.equal(
      nextBusinessStart(bkk('2026-09-05T19:00:00'), CONFIG).getTime(),
      bkk('2026-09-07T09:00:00').getTime(),
    );
  });
});

describe('parseBusinessHours', () => {
  it('walks a range that wraps the weekend', () => {
    assert.deepEqual([...parseBusinessHours({ days: 'SAT-TUE', hours: '09:00-18:00' }).openDays],
      ['SAT', 'SUN', 'MON', 'TUE']);
  });

  it('refuses a window it cannot honour rather than guessing one', () => {
    assert.throws(() => parseBusinessHours({ days: 'MON-FUN', hours: '09:00-18:00' }), /invalid_business_days/);
    assert.throws(() => parseBusinessHours({ days: 'MON-SAT', hours: '18:00-09:00' }), /invalid_business_hours/);
  });
});
