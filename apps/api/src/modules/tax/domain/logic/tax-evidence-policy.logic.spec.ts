import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveTaxEvidencePolicy, taxEvidencePolicyAllowedTypes, taxEvidencePolicyComplete } from './tax-evidence-policy.logic.js';

describe('transaction tax evidence policy', () => {
  it('uses safe export defaults but permits an accountant-reviewed replacement policy', () => {
    const defaults = resolveTaxEvidencePolicy('EXPORT_GOODS', null);
    assert.equal(taxEvidencePolicyComplete(defaults.policy, ['EXPORT_DECLARATION']), false);
    assert.equal(taxEvidencePolicyComplete(defaults.policy, ['EXPORT_DECLARATION', 'PAYMENT_EVIDENCE']), true);

    const replacement = resolveTaxEvidencePolicy('EXPORT_GOODS', JSON.stringify({
      mode: 'REPLACE',
      required: ['EXPORT_DECLARATION'],
      oneOf: [['PAYMENT_EVIDENCE', 'SHIPPING_EVIDENCE']],
      optional: ['OTHER'],
    }));
    assert.deepEqual(replacement.errors, []);
    assert.equal(taxEvidencePolicyComplete(replacement.policy, ['EXPORT_DECLARATION', 'SHIPPING_EVIDENCE']), true);
    assert.deepEqual([...taxEvidencePolicyAllowedTypes(replacement.policy)].sort(), ['EXPORT_DECLARATION', 'OTHER', 'PAYMENT_EVIDENCE', 'SHIPPING_EVIDENCE']);
  });

  it('never makes the later PP36 receipt a prerequisite for payment-date liability', () => {
    const resolved = resolveTaxEvidencePolicy('IMPORT_SERVICE', 'PAYMENT_EVIDENCE,PP36_RECEIPT');
    assert.deepEqual(resolved.policy.required, ['PAYMENT_EVIDENCE']);
    assert.ok(resolved.policy.optional.includes('PP36_RECEIPT'));
    assert.equal(taxEvidencePolicyComplete(resolved.policy, ['PAYMENT_EVIDENCE']), true);
  });

  it('fails closed for malformed structured policies', () => {
    assert.deepEqual(resolveTaxEvidencePolicy('EXPORT_SERVICE', '{bad').errors, ['evidence_policy_invalid_json']);
    assert.deepEqual(resolveTaxEvidencePolicy('EXPORT_SERVICE', '{"mode":"REPLACE","required":"bad"}').errors, ['evidence_policy_invalid']);
  });
});
