import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addCivilDays,
  civilDate,
  civilDateToUtcDate,
  civilDayRangeToUtc,
  civilInstantDayRangeToUtc,
  civilPeriodKey,
  civilPeriodRange,
  coerceCivilDate,
  exclusiveEndOfDay,
  isCivilDate,
  isCivilPeriodKey,
  isFuturePaymentDate,
  PAYMENT_DATE_IN_FUTURE,
  todayCivilDate,
  utcDateToCivilDate,
} from './civil-date.js';

describe('civil-date', () => {
  it('refuses only payment dates after Bangkok today, including the UTC day boundary', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T16:59:59.999Z') });
    assert.equal(isFuturePaymentDate('2026-10-03'), false);
    assert.equal(isFuturePaymentDate('2026-10-04'), false);
    assert.equal(isFuturePaymentDate('2026-10-05'), true);
    assert.equal(isFuturePaymentDate(new Date('2026-10-04T17:30:00.000Z')), true);
    t.mock.timers.tick(1);
    assert.equal(isFuturePaymentDate('2026-10-05'), false);
    assert.equal(isFuturePaymentDate('2026-10-06'), true);
    assert.equal(isFuturePaymentDate(new Date('2026-10-04T17:30:00.000Z')), false);
    assert.deepEqual(PAYMENT_DATE_IN_FUTURE, { code: 'payment_date_in_future', message: 'วันที่จ่ายเงินจริงต้องไม่เกินวันนี้' });
  });

  it('accepts only real calendar days in YYYY-MM-DD', () => {
    for (const good of ['2026-08-04', '2024-02-29', '1999-12-31', '2100-12-31']) {
      assert.equal(isCivilDate(good), true, good);
    }
    for (const bad of ['2026-02-30', '2026-8-4', '2026-13-01', '2026-08-04T00:00:00Z', '2101-01-01', '2569-03-15', '9999-12-31', '', ' 2026-08-04', null, 20260804]) {
      assert.equal(isCivilDate(bad as unknown), false, JSON.stringify(bad));
    }
  });

  it('writes @db.Date values at UTC midnight, never local midnight', () => {
    assert.equal(civilDateToUtcDate('2026-08-04').toISOString(), '2026-08-04T00:00:00.000Z');
    assert.equal(utcDateToCivilDate(civilDateToUtcDate('2026-08-04')), '2026-08-04');
    assert.throws(() => civilDateToUtcDate('2026-02-30'), TypeError);
  });

  // The bug this guards: at 00:30 Bangkok time the UTC day is still yesterday. A rule that
  // read "today" off toISOString() would reject a same-day effectiveFrom every night.
  it('renders an instant as the company day, not the UTC day', () => {
    const justAfterBangkokMidnight = new Date('2026-08-03T17:30:00.000Z');
    assert.equal(civilDate(justAfterBangkokMidnight, 'Asia/Bangkok'), '2026-08-04');
    assert.equal(civilDate(justAfterBangkokMidnight, 'UTC'), '2026-08-03');
    assert.equal(todayCivilDate('Asia/Bangkok', justAfterBangkokMidnight), '2026-08-04');
  });

  // AC32: a document issued at 23:30 local time belongs to that local day, so the identity
  // fence must not treat it as the next day and block it against a later revision.
  it('keeps a 23:30 local document on its own day', () => {
    assert.equal(civilDate(new Date('2026-08-03T16:30:00.000Z'), 'Asia/Bangkok'), '2026-08-03');
  });

  it('defaults to Asia/Bangkok', () => {
    const instant = new Date('2026-08-03T17:30:00.000Z');
    assert.equal(civilDate(instant), civilDate(instant, 'Asia/Bangkok'));
  });

  it('adds days across month, year and leap boundaries', () => {
    assert.equal(addCivilDays('2026-08-04', 1), '2026-08-05');
    assert.equal(addCivilDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addCivilDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addCivilDays('2026-01-01', -1), '2025-12-31');
    assert.equal(addCivilDays('2026-08-04', 365), '2027-08-04');
    assert.throws(() => addCivilDays('2026-08-04', 1.5), TypeError);
  });

  it('orders chronologically under plain string comparison', () => {
    assert.ok('2026-08-04' > '2026-08-03');
    assert.ok('2026-01-01' > '2025-12-31');
  });

  it('rejects invalid Date inputs instead of emitting "Invalid Date"', () => {
    assert.throws(() => civilDate(new Date('nope')), TypeError);
    assert.throws(() => utcDateToCivilDate(new Date('nope')), TypeError);
  });
});

describe('civilDayRangeToUtc', () => {
  // The bug this exists for: with `lte: <last day at midnight>` a row stamped 11:00 on that day
  // fell outside the range. Measured on seed data, a one-day vendor-bill filter returned 0 of 13.
  it('makes the upper bound the next midnight so the last day is included', () => {
    const range = civilDayRangeToUtc('2026-08-05', '2026-08-05');
    assert.equal(range.gte?.toISOString(), '2026-08-05T00:00:00.000Z');
    assert.equal(range.lt?.toISOString(), '2026-08-06T00:00:00.000Z');

    const stampedThatDay = new Date('2026-08-05T11:00:00.000Z');
    assert.ok(stampedThatDay >= range.gte! && stampedThatDay < range.lt!);
  });

  it('crosses a month boundary correctly', () => {
    assert.equal(civilDayRangeToUtc(undefined, '2026-08-31').lt?.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(civilDayRangeToUtc(undefined, '2026-12-31').lt?.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('omits a bound that was not supplied', () => {
    assert.deepEqual(civilDayRangeToUtc(), {});
    assert.equal(civilDayRangeToUtc('2026-08-05').lt, undefined);
    assert.equal(civilDayRangeToUtc(undefined, '2026-08-05').gte, undefined);
  });

  it('rejects timestamps, incomplete/reversed ranges, and impossible days', () => {
    assert.throws(() => civilDayRangeToUtc('2026-08-05T23:59:00.000Z', '2026-08-05'));
    assert.throws(() => civilDayRangeToUtc('2026-08-06', '2026-08-05'));
    assert.throws(() => civilDayRangeToUtc('2026-02-29', '2026-03-01'));
  });

  it('converts business-local days separately for timestamp columns', () => {
    const bangkok = civilInstantDayRangeToUtc('2026-08-05', '2026-08-05');
    assert.equal(bangkok.gte?.toISOString(), '2026-08-04T17:00:00.000Z');
    assert.equal(bangkok.lt?.toISOString(), '2026-08-05T17:00:00.000Z');
    const utc = civilInstantDayRangeToUtc('2026-08-05', '2026-08-05', 'UTC');
    assert.equal(utc.gte?.toISOString(), '2026-08-05T00:00:00.000Z');
    assert.equal(utc.lt?.toISOString(), '2026-08-06T00:00:00.000Z');
  });
});

describe('exclusiveEndOfDay', () => {
  it('advances a stored @db.Date bound to the next midnight', () => {
    assert.equal(exclusiveEndOfDay(new Date('2026-08-31T00:00:00.000Z')).toISOString(), '2026-09-01T00:00:00.000Z');
  });
});

describe('coerceCivilDate', () => {
  it('passes a civil date through untouched', () => {
    assert.equal(coerceCivilDate('2026-08-05'), '2026-08-05');
  });

  // The case the deleted apps/api helper got wrong: it sliced the ISO string and answered the 5th.
  it('reads an instant in the company zone, not UTC', () => {
    assert.equal(coerceCivilDate('2026-08-05T19:00:00.000Z'), '2026-08-06');
    assert.equal(coerceCivilDate(new Date('2026-08-05T19:00:00.000Z')), '2026-08-06');
    assert.equal(coerceCivilDate('2026-08-05T19:00:00.000Z', 'UTC'), '2026-08-05');
  });

  it('throws on input that is neither a civil date nor a parseable instant', () => {
    assert.throws(() => coerceCivilDate('nope'), TypeError);
    assert.throws(() => coerceCivilDate(new Date('nope')), TypeError);
  });

  it('does not parse rejected date-only values again as instants', () => {
    for (const value of ['2026-02-30', '2026-8-4', '2101-01-01', '2569-03-15', '9999-12-31']) {
      assert.throws(() => coerceCivilDate(value), TypeError, value);
    }
    assert.throws(() => coerceCivilDate('2569-03-15T00:00:00.000Z'), TypeError);
  });
});

describe('civilPeriodKey', () => {
  it('returns the YYYY-MM a civil date falls in', () => {
    assert.equal(civilPeriodKey('2026-08-05'), '2026-08');
    // Composed with todayCivilDate this is the fix for the UTC-month period defaults: an instant
    // at 02:00 Bangkok on the 1st belongs to the new month, where toISOString() said the old one.
    assert.equal(civilPeriodKey(todayCivilDate('Asia/Bangkok', new Date('2026-08-31T19:00:00.000Z'))), '2026-09');
  });
});

describe('civilPeriodRange', () => {
  it('validates months and preserves leap days', () => {
    assert.equal(isCivilPeriodKey('2024-02'), true);
    assert.deepEqual(civilPeriodRange('2024-02'), { startDate: '2024-02-01', endDate: '2024-02-29' });
    assert.deepEqual(civilPeriodRange('2026-02'), { startDate: '2026-02-01', endDate: '2026-02-28' });
    for (const bad of ['2026-00', '2026-13', '2026-2', '2101-01']) {
      assert.equal(isCivilPeriodKey(bad), false);
      assert.throws(() => civilPeriodRange(bad));
    }
  });
});
