import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickLineDefaultBranchId } from './line-receipt-branch.logic';

describe('pickLineDefaultBranchId', () => {
  it('a single in-scope branch is the default', () => {
    assert.equal(pickLineDefaultBranchId([{ id: 'b1', type: 'BRANCH' }]), 'b1');
  });
  it('multi-branch defaults to the sole head office', () => {
    assert.equal(pickLineDefaultBranchId([
      { id: 'hq', type: 'HEAD_OFFICE' },
      { id: 'b2', type: 'BRANCH' },
      { id: 'b3', type: 'WAREHOUSE' },
    ]), 'hq');
  });
  it('never guesses: no head office, several head offices, or no branches at all', () => {
    assert.equal(pickLineDefaultBranchId([{ id: 'b2', type: 'BRANCH' }, { id: 'b3', type: 'BRANCH' }]), undefined);
    assert.equal(pickLineDefaultBranchId([{ id: 'h1', type: 'HEAD_OFFICE' }, { id: 'h2', type: 'HEAD_OFFICE' }]), undefined);
    assert.equal(pickLineDefaultBranchId([]), undefined);
  });
});
