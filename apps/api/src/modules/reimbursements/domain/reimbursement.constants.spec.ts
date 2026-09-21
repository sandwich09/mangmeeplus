import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REIMBURSEMENT_POLICY_DEFAULTS, effectivePolicy } from './reimbursement.constants';

// Step-journey spec §7/§14, owner decision D2 + A1 (2026-09-19): a company with no stored policy
// row (new company, or an old one that never saved one) must get "ตรวจการเงินก่อนจ่าย" OFF, the
// same as a migrated existing row. Claims already submitted are unaffected — they read their own
// frozen approvalPolicySnapshotJson (effectivePolicyForRequest), never this virtual default.
describe('REIMBURSEMENT_POLICY_DEFAULTS', () => {
  it('defaults financeReviewRequired to false', () => {
    assert.equal(REIMBURSEMENT_POLICY_DEFAULTS.financeReviewRequired, false);
  });

  it('effectivePolicy(null) — the virtual policy for a company with no stored row — carries the same default', () => {
    assert.equal(effectivePolicy(null).financeReviewRequired, false);
  });
});
