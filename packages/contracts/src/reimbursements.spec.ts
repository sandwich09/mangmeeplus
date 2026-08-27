import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reimbursementIncurredDateError } from './reimbursements.js';

test('incurred dates allow today/past and reject the next calendar day across month/year boundaries', () => {
  for (const [past, today, future] of [
    ['2026-08-26', '2026-08-27', '2026-08-28'],
    ['2026-07-31', '2026-08-01', '2026-08-02'],
    ['2026-12-30', '2026-12-31', '2027-01-01'],
    ['2027-12-31', '2028-01-01', '2028-01-02'],
    ['2028-02-28', '2028-02-29', '2028-03-01'],
  ]) {
    assert.equal(reimbursementIncurredDateError(past!, today), null);
    assert.equal(reimbursementIncurredDateError(today!, today), null);
    assert.equal(reimbursementIncurredDateError(future!, today), 'line_incurred_date_in_future');
  }
});

test('uses Bangkok today at midnight independent of host/browser timezone', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-07-31T16:59:59.999Z') });
  assert.equal(reimbursementIncurredDateError('2026-08-01'), 'line_incurred_date_in_future');
  t.mock.timers.tick(1);
  const originalZone = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Bangkok', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.equal(reimbursementIncurredDateError('2026-08-01'), null, zone);
      assert.equal(reimbursementIncurredDateError('2026-08-02'), 'line_incurred_date_in_future', zone);
      assert.equal(reimbursementIncurredDateError('2026-07-31T17:00:00.000Z'), null, zone);
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

test('retains ISO timestamp and stored Date compatibility and rejects malformed calendar days', () => {
  for (const value of ['2026-08-27T00:00:00.000Z', new Date('2026-08-27T00:00:00.000Z'), '2026-08-27T23:00:00+07:00']) {
    assert.equal(reimbursementIncurredDateError(value, '2026-08-27'), null);
  }
  for (const value of ['2026-08-27T17:00:00.000Z', new Date('2026-08-27T17:00:00.000Z'), '2026-08-28T00:00:00+07:00']) {
    assert.equal(reimbursementIncurredDateError(value, '2026-08-27'), 'line_incurred_date_in_future');
  }
  for (const value of ['', 'not-a-date', '2026-8-4', '2026-02-30', '2026-02-30T00:00:00.000Z', '2026-08-27T25:00:00Z', new Date('invalid')]) {
    assert.equal(reimbursementIncurredDateError(value, '2026-08-27'), 'line_incurred_date_invalid');
  }
});
