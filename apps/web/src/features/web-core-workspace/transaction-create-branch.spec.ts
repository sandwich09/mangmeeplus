import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transactionCreateBranchId } from './TransactionBranchField';

// Owner report 2026-08-28: "หากมีสาขาเดียวก็ดีฟอลได้เลย" — and with several branches the all-branches
// filter must not silently become the source branch of a new record, because "ทุกสาขา (รวม)" is a way
// of reading, not a place a receipt was issued.
describe('which branch a new record is created under', () => {
  const HO = { id: 'branch-ho' };
  const BR2 = { id: 'branch-2' };

  it('defaults to the only branch, so a single-branch company is never asked', () => {
    assert.equal(transactionCreateBranchId([HO], undefined), 'branch-ho');
    assert.equal(transactionCreateBranchId([HO], ''), 'branch-ho');
  });

  it('refuses to guess when several branches exist and none is chosen', () => {
    assert.equal(transactionCreateBranchId([HO, BR2], undefined), '');
    assert.equal(transactionCreateBranchId([HO, BR2], ''), '', 'the all-branches filter is not a source branch');
  });

  it('uses the chosen branch once the person picks one', () => {
    assert.equal(transactionCreateBranchId([HO, BR2], 'branch-2'), 'branch-2');
  });

  it('ignores a filter pointing at a branch this company does not have', () => {
    assert.equal(transactionCreateBranchId([HO, BR2], 'branch-from-another-company'), '');
  });

  it('has no answer when the company has no branches at all', () => {
    assert.equal(transactionCreateBranchId([], 'anything'), '');
  });

  // 2026-10-13: with the top bar on "all branches" the field asked again on every visit. The person's own last
  // choice on this device is offered first; it never outranks a branch chosen now, and it is dropped once the
  // person can no longer use that branch.
  it('offers the branch this person chose last when the filter says all branches', () => {
    assert.equal(transactionCreateBranchId([HO, BR2], '', 'branch-2'), 'branch-2');
    assert.equal(transactionCreateBranchId([HO, BR2], undefined, 'branch-2'), 'branch-2');
    assert.equal(transactionCreateBranchId([HO, BR2], 'branch-ho', 'branch-2'), 'branch-ho', 'the branch chosen now wins');
    assert.equal(transactionCreateBranchId([HO, BR2], '', 'branch-closed'), '', 'a branch no longer usable is not offered');
    assert.equal(transactionCreateBranchId([HO, BR2], '', ''), '');
  });
});
