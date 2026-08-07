import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBranchCode, validateTaxBranchCode, canArchiveBranch, resolveBranchIds,
  isBranchInScope, branchScopeWhere, resolveCreateBranchId,
} from './branch.logic';
import type { BranchRecord } from '../models/branch.model';

const stubBranch = (overrides: Partial<BranchRecord> = {}): BranchRecord => ({
  id: 'b1', companyId: 'c1', code: 'HO', name: 'Head Office',
  type: 'HEAD_OFFICE', isVatEstablishment: false, status: 'ACTIVE',
  createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

describe('branch.logic', () => {
  describe('validateBranchCode', () => {
    it('accepts valid uppercase code', () => assert.equal(validateBranchCode('HO'), null));
    it('accepts codes with digits and hyphens', () => assert.equal(validateBranchCode('BR-01'), null));
    it('rejects lowercase', () => assert.notEqual(validateBranchCode('ho'), null));
    it('rejects empty', () => assert.notEqual(validateBranchCode(''), null));
    it('rejects >20 chars', () => assert.notEqual(validateBranchCode('A'.repeat(21)), null));
  });

  describe('validateTaxBranchCode', () => {
    it('accepts 5-digit code', () => assert.equal(validateTaxBranchCode('00000'), null));
    it('rejects non-numeric', () => assert.notEqual(validateTaxBranchCode('ABCDE'), null));
    it('rejects <5 digits', () => assert.notEqual(validateTaxBranchCode('1234'), null));
  });

  describe('canArchiveBranch', () => {
    it('allows archiving a non-head-office branch', () => {
      assert.equal(canArchiveBranch(stubBranch({ type: 'BRANCH' }), 1), null);
    });
    it('blocks archiving the only head office', () => {
      assert.notEqual(canArchiveBranch(stubBranch({ type: 'HEAD_OFFICE' }), 1), null);
    });
    it('allows archiving one of multiple head offices', () => {
      assert.equal(canArchiveBranch(stubBranch({ type: 'HEAD_OFFICE' }), 2), null);
    });
  });

  describe('resolveBranchIds', () => {
    it('returns undefined for ALL_BRANCHES', () => {
      assert.equal(resolveBranchIds('ALL_BRANCHES', [], undefined), undefined);
    });
    it('returns selected ids for SELECTED_BRANCHES', () => {
      assert.deepEqual(resolveBranchIds('SELECTED_BRANCHES', ['b1', 'b2'], undefined), ['b1', 'b2']);
    });
    it('returns default branch id for DEFAULT_BRANCH_ONLY', () => {
      assert.deepEqual(resolveBranchIds('DEFAULT_BRANCH_ONLY', [], 'b1'), ['b1']);
    });
    it('returns empty array when no default branch', () => {
      assert.deepEqual(resolveBranchIds('DEFAULT_BRANCH_ONLY', [], undefined), []);
    });
  });

  // 10D enforcement helpers: undefined scope = unrestricted; null branchId = company-central seen by all.
  describe('isBranchInScope', () => {
    it('unrestricted scope allows any branch', () => {
      assert.equal(isBranchInScope({}, 'b9'), true);
    });
    it('company-central (null) is visible to a restricted scope', () => {
      assert.equal(isBranchInScope({ branchIds: ['b1'] }, null), true);
      assert.equal(isBranchInScope({ branchIds: ['b1'] }, undefined), true);
    });
    it('allows a branch inside the scope', () => {
      assert.equal(isBranchInScope({ branchIds: ['b1', 'b2'] }, 'b2'), true);
    });
    it('rejects a branch outside the scope', () => {
      assert.equal(isBranchInScope({ branchIds: ['b1'] }, 'b2'), false);
    });
  });

  describe('branchScopeWhere', () => {
    it('is empty for unrestricted scope', () => {
      assert.deepEqual(branchScopeWhere({}), {});
    });
    it('matches scoped branches plus company-central rows', () => {
      assert.deepEqual(branchScopeWhere({ branchIds: ['b1'] }), {
        OR: [{ branchId: { in: ['b1'] } }, { branchId: null }],
      });
    });
  });

  describe('resolveCreateBranchId', () => {
    it('explicit input wins', () => {
      assert.equal(resolveCreateBranchId({ branchIds: ['b1'] }, 'b1'), 'b1');
    });
    it('unrestricted creator defaults to company-central (null)', () => {
      assert.equal(resolveCreateBranchId({}, undefined), null);
    });
    it('restricted creator defaults to first scoped branch (resolver puts default branch first)', () => {
      assert.equal(resolveCreateBranchId({ branchIds: ['b2', 'b1'] }, undefined), 'b2');
    });
  });
});
