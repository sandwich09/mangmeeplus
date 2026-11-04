import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPeriodDateRange } from './tax.logic';

describe('monthlyPeriodDateRange', () => {
  it('returns the first and last civil day of the month', () => {
    assert.deepEqual(monthlyPeriodDateRange('2026-09'), { fromDate: '2026-09-01', toDate: '2026-09-30' });
  });

  it('handles a 31-day month and both sides of a leap February', () => {
    assert.deepEqual(monthlyPeriodDateRange('2026-07'), { fromDate: '2026-07-01', toDate: '2026-07-31' });
    assert.deepEqual(monthlyPeriodDateRange('2026-02'), { fromDate: '2026-02-01', toDate: '2026-02-28' });
    assert.deepEqual(monthlyPeriodDateRange('2028-02'), { fromDate: '2028-02-01', toDate: '2028-02-29' });
  });

  it('returns null for a non-monthly period key (annual or half-year CIT)', () => {
    assert.equal(monthlyPeriodDateRange('2026'), null);
    assert.equal(monthlyPeriodDateRange('2026-H1'), null);
  });

  it('returns null for a malformed or out-of-range key rather than throwing', () => {
    assert.equal(monthlyPeriodDateRange(''), null);
    assert.equal(monthlyPeriodDateRange('2026-13'), null);
    assert.equal(monthlyPeriodDateRange('2026-00'), null);
  });
});


it('labels the conditional e-WHT rate warning as ตรวจอัตรา', async () => {
  const { taxReviewIssueLabel } = await import('./tax.logic');
  assert.equal(taxReviewIssueLabel('WHT_RATE_MISMATCH'), 'ตรวจอัตรา');
});
