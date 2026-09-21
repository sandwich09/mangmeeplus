import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addressMissingListFilter } from './expense-address-missing-view.logic';

describe('addressMissingListFilter', () => {
  it('scopes to the range when both dates are valid and ordered', () => {
    assert.deepEqual(
      addressMissingListFilter('2026-09-01', '2026-09-30'),
      { vendorAddressMissing: true, fromDate: '2026-09-01', toDate: '2026-09-30' },
    );
  });

  it('scopes an exact single-day range (from === to)', () => {
    assert.deepEqual(
      addressMissingListFilter('2026-09-15', '2026-09-15'),
      { vendorAddressMissing: true, fromDate: '2026-09-15', toDate: '2026-09-15' },
    );
  });

  it('stays unscoped when a date is missing (the chip\'s own link)', () => {
    assert.deepEqual(addressMissingListFilter(null, null), { vendorAddressMissing: true });
    assert.deepEqual(addressMissingListFilter('2026-09-01', null), { vendorAddressMissing: true });
    assert.deepEqual(addressMissingListFilter(null, '2026-09-30'), { vendorAddressMissing: true });
  });

  it('stays unscoped when a date is malformed rather than throwing', () => {
    assert.deepEqual(addressMissingListFilter('not-a-date', '2026-09-30'), { vendorAddressMissing: true });
    assert.deepEqual(addressMissingListFilter('2026-09-01', '2026-09-32'), { vendorAddressMissing: true });
  });

  it('stays unscoped when the range is inverted', () => {
    assert.deepEqual(addressMissingListFilter('2026-09-30', '2026-09-01'), { vendorAddressMissing: true });
  });
});
