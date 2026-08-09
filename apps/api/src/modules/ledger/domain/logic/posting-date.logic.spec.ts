import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivePeriodKey } from './posting-engine.logic';

describe('derivePeriodKey', () => {
  it('uses the Bangkok civil month for an instant near midnight', () => {
    assert.equal(derivePeriodKey('2026-08-31T19:00:00.000Z'), '2026-09');
  });

  it('preserves an explicit civil date', () => {
    assert.equal(derivePeriodKey('2026-08-31'), '2026-08');
  });
});
