import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSubmitSupplierPayment, isVendorBillTaxEvidenceBlocked, isVendorBillTaxEvidenceCompleteForReview } from './accounts-payable.model.js';

describe('accounts payable VAT evidence model', () => {
  it('blocks claimable domestic VAT until review is verified with no remaining issue', () => {
    assert.equal(isVendorBillTaxEvidenceBlocked({ taxEvidenceRequired: true, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', reviewIssues: ['tax_evidence_review_required'] }), true);
    assert.equal(isVendorBillTaxEvidenceBlocked({ taxEvidenceRequired: true, taxEvidenceReviewStatus: 'VERIFIED', reviewIssues: [] }), false);
    assert.equal(isVendorBillTaxEvidenceBlocked({ taxEvidenceRequired: false, taxEvidenceReviewStatus: 'DRAFT', reviewIssues: [] }), false);
  });

  it('enables reviewer action only after factual evidence blockers are cleared', () => {
    assert.equal(isVendorBillTaxEvidenceCompleteForReview({ taxEvidenceRequired: true, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', reviewIssues: ['tax_evidence_review_required'] }), true);
    assert.equal(isVendorBillTaxEvidenceCompleteForReview({ taxEvidenceRequired: true, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', reviewIssues: ['missing_tax_invoice_number', 'tax_evidence_review_required'] }), false);
    assert.equal(isVendorBillTaxEvidenceCompleteForReview({ taxEvidenceRequired: true, taxEvidenceReviewStatus: 'REJECTED', reviewIssues: ['tax_evidence_rejected'] }), false);
  });

  it('allows partial supplier payments but requires exact PP36 payment evidence', () => {
    assert.equal(canSubmitSupplierPayment({ amount: '40', outstandingAmount: '100', pp36Candidate: false, pp36PaymentEvidenceIds: [] }), true);
    assert.equal(canSubmitSupplierPayment({ amount: '40', outstandingAmount: '100', pp36Candidate: true, pp36PaymentEvidenceIds: [] }), false);
    assert.equal(canSubmitSupplierPayment({ amount: '40', outstandingAmount: '100', pp36Candidate: true, pp36PaymentEvidenceIds: ['evidence-1'] }), true);
    assert.equal(canSubmitSupplierPayment({ amount: '101', outstandingAmount: '100', pp36Candidate: false, pp36PaymentEvidenceIds: [] }), false);
  });
});

describe('canSubmitSupplierPayment withholding', () => {
  const base = { amount: '1070', outstandingAmount: '1070', pp36Candidate: false, pp36PaymentEvidenceIds: [] };
  const wht = (overrides: Partial<{ whtAmount: string; whtCategoryCode: string; whtRate: string; billWhtAmount: string }> = {}) =>
    ({ whtAmount: '30', whtCategoryCode: 'WHT_SERVICE_5', whtRate: '3', billWhtAmount: '0', ...overrides });

  it('accepts a withheld payment and one that withholds nothing', () => {
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht() }), true);
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht({ whtAmount: '' }) }), true);
    // Callers that never touch withholding keep working unchanged.
    assert.equal(canSubmitSupplierPayment(base), true);
  });

  it('blocks withholding without a category or a usable rate', () => {
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht({ whtCategoryCode: '' }) }), false);
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht({ whtRate: '0' }) }), false);
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht({ whtRate: '101' }) }), false);
  });

  it('blocks withholding the whole payment, a negative amount, or tax the bill already took', () => {
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht({ whtAmount: '1070' }) }), false);
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht({ whtAmount: '-5' }) }), false);
    assert.equal(canSubmitSupplierPayment({ ...base, wht: wht({ billWhtAmount: '30' }) }), false);
  });
});
