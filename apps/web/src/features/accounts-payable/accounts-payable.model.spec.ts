import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSubmitSupplierPayment, isVendorBillTaxEvidenceBlocked, isVendorBillTaxEvidenceCompleteForReview, canIssueSystemWhtCertificate, canCorrectWhtCertificate, canIssueWhtReplacementCopy } from './accounts-payable.model.js';

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

// WHT certificate system issuance plan §4.1 (S9): the "ออกเอกสารในระบบ" button must pass BOTH gate
// axes — route-readiness (systemIssuanceOpen) and the permission axis (which already folds in the
// thai_tax entitlement) — and only for a handoff still open to an action (REQUIRED).
describe('canIssueSystemWhtCertificate (S9)', () => {
  const required = { status: 'REQUIRED', systemIssuanceOpen: true };

  it('shows the button only when both the route gate and the permission are present', () => {
    assert.equal(canIssueSystemWhtCertificate(required, ['wht.certificate.issue']), true);
    // S9: the company is not on ENTERPRISE — no thai_tax entitlement, so the permission never
    // reaches the effective set at all, whatever the route-readiness gate says.
    assert.equal(canIssueSystemWhtCertificate(required, []), false);
    // The route-readiness gate (specialist-approved evidence) is a separate axis from entitlement.
    assert.equal(canIssueSystemWhtCertificate({ ...required, systemIssuanceOpen: false }, ['wht.certificate.issue']), false);
  });

  it('never shows once the handoff has moved past REQUIRED', () => {
    for (const status of ['EXTERNAL_LINKED', 'SYSTEM_ISSUED', 'CANCELLED']) {
      assert.equal(canIssueSystemWhtCertificate({ status, systemIssuanceOpen: true }, ['wht.certificate.issue']), false, status);
    }
  });
});

// Correction & replacement plan §5.1/§5.3: mirrors canIssueSystemWhtCertificate's shape exactly —
// both gate axes, and only past REQUIRED (into SYSTEM_ISSUED with a certificateId), never earlier.
describe('canCorrectWhtCertificate / canIssueWhtReplacementCopy', () => {
  const issued = { status: 'SYSTEM_ISSUED', certificateId: 'cert-1', systemCorrectionOpen: true, systemReplacementOpen: true };

  it('canCorrectWhtCertificate needs SYSTEM_ISSUED + certificateId + systemCorrectionOpen + the permission', () => {
    assert.equal(canCorrectWhtCertificate(issued, ['wht.certificate.correct']), true);
    assert.equal(canCorrectWhtCertificate(issued, []), false, 'no permission');
    assert.equal(canCorrectWhtCertificate({ ...issued, systemCorrectionOpen: false }, ['wht.certificate.correct']), false, 'gate closed');
    assert.equal(canCorrectWhtCertificate({ ...issued, certificateId: null }, ['wht.certificate.correct']), false, 'no certificateId');
  });

  it('canIssueWhtReplacementCopy needs SYSTEM_ISSUED + certificateId + systemReplacementOpen + the permission', () => {
    assert.equal(canIssueWhtReplacementCopy(issued, ['wht.certificate.correct']), true);
    assert.equal(canIssueWhtReplacementCopy(issued, []), false, 'no permission');
    assert.equal(canIssueWhtReplacementCopy({ ...issued, systemReplacementOpen: false }, ['wht.certificate.correct']), false, 'gate closed');
  });

  it('never shows for a status other than SYSTEM_ISSUED, including REQUIRED and EXTERNAL_LINKED', () => {
    for (const status of ['REQUIRED', 'EXTERNAL_LINKED', 'CANCELLED']) {
      assert.equal(canCorrectWhtCertificate({ ...issued, status }, ['wht.certificate.correct']), false, status);
      assert.equal(canIssueWhtReplacementCopy({ ...issued, status }, ['wht.certificate.correct']), false, status);
    }
  });
});
