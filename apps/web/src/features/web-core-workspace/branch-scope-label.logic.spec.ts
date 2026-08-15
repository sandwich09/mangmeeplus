import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { branchScopeLabel, isBranchScope403 } from './branch-scope-label.logic';
import type { BranchOption } from './workspace-scope.api';

const hq: BranchOption = { id: 'b-hq', code: 'HQ', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE' };
const siam: BranchOption = { id: 'b-siam', code: 'SIAM', name: 'สาขาสยาม', type: 'BRANCH' };

describe('branchScopeLabel', () => {
  it('renders nothing while the context is unresolved or the lookup failed', () => {
    assert.equal(branchScopeLabel(null, 'th'), null);
  });

  it('renders nothing for a company with no visible branch', () => {
    assert.equal(branchScopeLabel({ branches: [], branchId: '', locked: false }, 'th'), null);
  });

  it('names all branches when nothing is selected', () => {
    assert.equal(branchScopeLabel({ branches: [hq, siam], branchId: '', locked: false }, 'th'), 'ทุกสาขา (รวม)');
    assert.equal(branchScopeLabel({ branches: [hq, siam], branchId: '', locked: false }, 'en'), 'All branches (combined)');
  });

  it('names the selected branch', () => {
    assert.equal(branchScopeLabel({ branches: [hq, siam], branchId: siam.id, locked: false }, 'th'), 'สาขาสยาม');
  });

  it('suffixes a selected head office, per locale', () => {
    assert.equal(branchScopeLabel({ branches: [hq, siam], branchId: hq.id, locked: false }, 'th'), 'สำนักงานใหญ่ (สำนักงานใหญ่)');
    assert.equal(branchScopeLabel({ branches: [hq, siam], branchId: hq.id, locked: false }, 'en'), 'สำนักงานใหญ่ (Head Office)');
  });

  it('names the locked branch, never the all-branches string', () => {
    assert.equal(branchScopeLabel({ branches: [siam], branchId: siam.id, locked: true }, 'th'), 'สาขาสยาม');
  });

  it('names the locked branch even when branchId was not pinned to it', () => {
    assert.equal(branchScopeLabel({ branches: [siam], branchId: '', locked: true }, 'th'), 'สาขาสยาม');
  });
});

describe('isBranchScope403', () => {
  it('claims a 403 only while a branch is selected', () => {
    assert.equal(isBranchScope403({ status: 403 }, siam.id), true);
    assert.equal(isBranchScope403({ status: 403 }, ''), false);
    assert.equal(isBranchScope403({ status: 403 }, undefined), false);
  });

  it('reads either thrown error shape', () => {
    // authedApiFetch throws `{ status }`; ApiError carries `statusCode`.
    assert.equal(isBranchScope403({ statusCode: 403 }, siam.id), true);
  });

  it('leaves every other failure to the page', () => {
    for (const error of [{ status: 401 }, { status: 404 }, { status: 500 }, new TypeError('offline'), null]) {
      assert.equal(isBranchScope403(error, siam.id), false);
    }
  });
});
