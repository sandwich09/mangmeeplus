import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateState, aggregationIncomplete, appliedPeriod } from './business-read-result-semantics';

describe('business read result semantics', () => {
  it('uses the API-applied period instead of the requested proposal', () => {
    assert.deepEqual(appliedPeriod({ queryApplied: { period: { startDate: '2026-02-01', endDate: '2026-02-28' } } }), {
      fromDate: '2026-02-01', toDate: '2026-02-28',
    });
  });

  it('treats bounded rows as compatible with a complete aggregate', () => {
    assert.equal(aggregationIncomplete({
      completeness: {
        aggregate: 'complete',
        rows: { returned: 5, hasMore: true, nextCursor: 'next' },
      },
    }), false);
  });

  it('rejects partial/unknown aggregates and legacy truthy incomplete flags', () => {
    assert.equal(aggregationIncomplete({ completeness: { aggregate: 'partial' } }), true);
    assert.equal(aggregationIncomplete({ completeness: { aggregate: 'unknown' } }), true);
    assert.equal(aggregationIncomplete({ cappedPages: true }), true);
  });

  it('distinguishes mixed-currency conflict from an explicit empty aggregate', () => {
    assert.equal(aggregateState({ mixedCurrency: true, totalAmount: '123.00' }), 'conflict');
    assert.equal(aggregateState({ facts: [{ state: 'empty' }], completeness: { aggregate: 'complete' } }), 'empty');
  });
});

