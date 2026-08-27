import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickLineDefaultBranchId } from './line-receipt-branch.logic';

describe('pickLineDefaultBranchId', () => {
  const multi = [
    { id: 'hq', type: 'HEAD_OFFICE' },
    { id: 'b2', type: 'BRANCH' },
    { id: 'b3', type: 'WAREHOUSE' },
  ];
  it("the user's own branch wins over everything (Owner: สาขาที่ user นั้นอยู่)", () => {
    assert.equal(pickLineDefaultBranchId(multi, 'b2'), 'b2');
    assert.equal(pickLineDefaultBranchId([{ id: 'b1', type: 'BRANCH' }, { id: 'b2', type: 'BRANCH' }], 'b1'), 'b1');
  });
  it('a stale or out-of-scope member branch never wins — the chain continues', () => {
    assert.equal(pickLineDefaultBranchId(multi, 'deactivated-branch'), 'hq');
    assert.equal(pickLineDefaultBranchId([{ id: 'b1', type: 'BRANCH' }], 'other'), 'b1');
  });
  it('a single in-scope branch is the default', () => {
    assert.equal(pickLineDefaultBranchId([{ id: 'b1', type: 'BRANCH' }]), 'b1');
  });
  it('multi-branch with no member branch defaults to the sole head office', () => {
    assert.equal(pickLineDefaultBranchId(multi), 'hq');
    assert.equal(pickLineDefaultBranchId(multi, null), 'hq');
  });
  it('never guesses: no head office, several head offices, or no branches at all', () => {
    assert.equal(pickLineDefaultBranchId([{ id: 'b2', type: 'BRANCH' }, { id: 'b3', type: 'BRANCH' }]), undefined);
    assert.equal(pickLineDefaultBranchId([{ id: 'h1', type: 'HEAD_OFFICE' }, { id: 'h2', type: 'HEAD_OFFICE' }]), undefined);
    assert.equal(pickLineDefaultBranchId([]), undefined);
  });
});
