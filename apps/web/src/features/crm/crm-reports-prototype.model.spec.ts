import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONV_STATUS_META,
  contractStatusKey,
  formatLifetimeValueAmount,
} from './crm-reports-prototype.model';

describe('crm reports prototype model', () => {
  it('maps contract statuses to the Mangmee presentation keys', () => {
    assert.equal(contractStatusKey('NEW'), 'new');
    assert.equal(contractStatusKey('OPEN'), 'open');
    assert.equal(contractStatusKey('WAITING_CUSTOMER'), 'waiting_customer');
    assert.equal(contractStatusKey('WAITING_INTERNAL'), 'waiting_internal');
    assert.equal(contractStatusKey('FOLLOW_UP'), 'followup');
    assert.equal(contractStatusKey('RESOLVED'), 'resolved');
    assert.equal(contractStatusKey('SPAM'), null);
    assert.equal(CONV_STATUS_META[contractStatusKey('WAITING_CUSTOMER')!].label, 'รอลูกค้า');
  });

  it('formats decimal money strings for display without numeric math', () => {
    assert.equal(formatLifetimeValueAmount('12345.6700'), '12,345.67');
    assert.equal(formatLifetimeValueAmount('50000.0000'), '50,000');
    assert.equal(formatLifetimeValueAmount('0009876543.2100'), '9,876,543.21');
  });
});
