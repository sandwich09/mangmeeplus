import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTaxReviewerRole, taxReviewerViolation } from './tax-reviewer.logic';

describe('effectiveTaxReviewerRole', () => {
  it('returns ACCOUNTANT when unset (null/undefined/empty)', () => {
    assert.equal(effectiveTaxReviewerRole(null), 'ACCOUNTANT');
    assert.equal(effectiveTaxReviewerRole(undefined), 'ACCOUNTANT');
    assert.equal(effectiveTaxReviewerRole(''), 'ACCOUNTANT');
    assert.equal(effectiveTaxReviewerRole('   '), 'ACCOUNTANT');
  });
  it('returns the configured role when set', () => {
    assert.equal(effectiveTaxReviewerRole('FINANCE'), 'FINANCE');
    assert.equal(effectiveTaxReviewerRole('  FINANCE  '), 'FINANCE');
  });
});

describe('taxReviewerViolation', () => {
  it('allows a caller holding the default ACCOUNTANT role when profile is unset', () => {
    assert.equal(taxReviewerViolation(['ACCOUNTANT'], null), undefined);
    assert.equal(taxReviewerViolation(['ACCOUNTANT'], undefined), undefined);
  });

  it('OWNER overrides regardless of reviewer role', () => {
    assert.equal(taxReviewerViolation(['OWNER'], null), undefined);
    assert.equal(taxReviewerViolation(['OWNER'], 'FINANCE'), undefined);
    assert.equal(taxReviewerViolation(['OWNER', 'ACCOUNTANT'], 'FINANCE'), undefined);
  });

  it('allows a caller holding the configured custom reviewer role', () => {
    assert.equal(taxReviewerViolation(['FINANCE'], 'FINANCE'), undefined);
    assert.equal(taxReviewerViolation(['ACCOUNTANT', 'FINANCE'], 'FINANCE'), undefined);
  });

  it('rejects a caller lacking the effective reviewer role', () => {
    assert.match(taxReviewerViolation(['ACCOUNTANT'], 'FINANCE')!, /Tax reviewer role 'FINANCE' is required/);
    assert.match(taxReviewerViolation(['MANAGER'], null)!, /Tax reviewer role 'ACCOUNTANT' is required/);
  });

  it('rejects empty roles', () => {
    assert.match(taxReviewerViolation([], null)!, /Tax reviewer role 'ACCOUNTANT' is required/);
    assert.match(taxReviewerViolation([], 'FINANCE')!, /Tax reviewer role 'FINANCE' is required/);
  });
});
