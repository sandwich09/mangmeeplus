import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultSubstituteReceiptReason,
  evaluateDetailsReadiness,
  evaluateEvidenceReadiness,
  evaluateManualLinesReadiness,
  evaluateSigningReadiness,
  isSubstituteReceiptCandidateEligible,
  isSubstituteReceiptCandidateOtherwiseEligible,
  isManualLineDecimal,
  mayApproveSubstituteReceipt,
  manualLineAmount,
  manualLinesTotal,
  payeeTaxIdDigits,
  resolveWizardEntryMode,
  resolveWizardStep,
  substituteReceiptEvidenceRenderabilityIssue,
  substituteReceiptRenderabilityIssue,
  validatePayeeIdentity,
  wizardJourneyStage,
} from './substitute-receipt-wizard.model';

const eligibleCandidate = {
  currency: 'THB',
  grandTotalAmount: '250.00',
  sourceDocumentType: 'EXPENSE_NOTE_TEXT' as const,
  taxEvidenceStatus: 'SUPPORTING_ONLY',
  expenseCategoryId: 'category-1',
  accountHintKey: null,
  aiVerificationSummaryJson: null,
  lines: [{ description: 'ค่าเดินทาง', expenseCategoryId: 'category-1', accountHintKey: null }],
};

test('chooses the entry mode without hiding a preselected expense', () => {
  assert.equal(resolveWizardEntryMode({ candidateCount: 2 }), 'existing');
  assert.equal(resolveWizardEntryMode({ candidateCount: 0 }), 'new');
  assert.equal(resolveWizardEntryMode({ initialExpenseId: 'expense-1', candidateCount: 0 }), 'existing');
});

test('groups the six wizard steps into four journey stages', () => {
  assert.deepEqual(
    ['expense', 'details', 'evidence', 'certify', 'approve', 'done'].map((step) =>
      wizardJourneyStage(step as Parameters<typeof wizardJourneyStage>[0])),
    ['expense', 'prepare', 'prepare', 'sign', 'sign', 'done'],
  );
});

test('validates and totals multi-line manual expenses deterministically', () => {
  const lines = [
    { description: 'ค่าวัตถุดิบ', expenseCategoryId: 'materials', quantity: '2', unitPrice: '125.50' },
    { description: 'ค่าจัดส่ง', expenseCategoryId: 'delivery', quantity: '1', unitPrice: '50' },
  ];
  assert.equal(manualLineAmount(lines[0]!), 251);
  assert.equal(manualLinesTotal(lines), 301);
  assert.deepEqual(evaluateManualLinesReadiness(lines), {
    ready: true, missingCount: 0, invalidLineIndexes: [],
  });
  assert.deepEqual(evaluateManualLinesReadiness([
    { description: '', expenseCategoryId: '', quantity: '0', unitPrice: '' },
    lines[1]!,
  ]), {
    ready: false, missingCount: 4, invalidLineIndexes: [0],
  });
  assert.deepEqual(evaluateManualLinesReadiness([]), {
    ready: false, missingCount: 1, invalidLineIndexes: [],
  });
  assert.deepEqual(evaluateManualLinesReadiness(Array.from({ length: 9 }, () => lines[0]!)), {
    ready: false, missingCount: 1, invalidLineIndexes: [],
  });
  assert.equal(evaluateManualLinesReadiness(Array.from({ length: 8 }, () => lines[0]!)).ready, true);
  assert.equal(isManualLineDecimal('99999999999999.9999'), true);
  assert.equal(isManualLineDecimal('100000000000000'), false);
  assert.equal(isManualLineDecimal('1.00001'), false);
  assert.equal(isManualLineDecimal('1e2'), false);
  assert.equal(evaluateManualLinesReadiness([{ ...lines[0]!, quantity: '0.0001', unitPrice: '0.01' }]).ready, false);
  assert.equal(evaluateManualLinesReadiness([{ ...lines[0]!, quantity: '99999999999999', unitPrice: '2' }]).ready, false);
  assert.equal(evaluateManualLinesReadiness([{ ...lines[0]!, description: 'x'.repeat(201) }]).ready, false);
});

test('filters candidate blockers before the user reaches prepare', () => {
  assert.equal(isSubstituteReceiptCandidateEligible(eligibleCandidate), true);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...eligibleCandidate, currency: 'USD' }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...eligibleCandidate, taxEvidenceStatus: 'USABLE_FOR_TAX' }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...eligibleCandidate, expenseCategoryId: null, lines: [{ ...eligibleCandidate.lines[0]!, expenseCategoryId: null }] }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({
    ...eligibleCandidate,
    aiVerificationSummaryJson: { status: 'NOT_EXPENSE_DOCUMENT' },
  }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({
    ...eligibleCandidate,
    aiVerificationSummaryJson: { classification: { documentKind: 'QUOTATION' } },
  }), false);
  const tooManyLines = { ...eligibleCandidate, lines: Array.from({ length: 9 }, () => eligibleCandidate.lines[0]!) };
  assert.equal(isSubstituteReceiptCandidateOtherwiseEligible(tooManyLines), true);
  assert.equal(substituteReceiptRenderabilityIssue(tooManyLines), 'too_many_lines');
  assert.equal(isSubstituteReceiptCandidateEligible(tooManyLines), false);
  const longDescription = {
    ...eligibleCandidate,
    lines: [{ ...eligibleCandidate.lines[0]!, description: 'ก'.repeat(201) }],
  };
  assert.equal(substituteReceiptRenderabilityIssue(longDescription), 'line_description_too_long');
  assert.equal(isSubstituteReceiptCandidateEligible(longDescription), false);
});

test('starts receipt-classified expenses with a compatible missing-receipt reason', () => {
  assert.equal(defaultSubstituteReceiptReason('RECEIPT'), 'RECEIPT_UNAVAILABLE');
  assert.equal(defaultSubstituteReceiptReason('TAX_INVOICE'), 'RECEIPT_UNAVAILABLE');
  assert.equal(defaultSubstituteReceiptReason('EXPENSE_NOTE_TEXT'), 'PAYEE_CANNOT_ISSUE');
});

test('validates and normalizes substitute-receipt payee identity fields', () => {
  assert.deepEqual(validatePayeeIdentity({
    payeeName: 'ผู้ขายเดิม', payeeAddress: '', payeeTaxId: '', vendorNameSnapshot: 'ผู้ขายเดิม',
  }), {});
  assert.deepEqual(validatePayeeIdentity({
    payeeName: '', payeeAddress: '', payeeTaxId: '', vendorNameSnapshot: 'ผู้ขายเดิม',
  }), { payeeName: 'payee_name_required' }, 'clearing the visible required name must not use a hidden fallback');
  assert.deepEqual(validatePayeeIdentity({
    payeeName: ' ', payeeAddress: 'ก'.repeat(301), payeeTaxId: '123-456', vendorNameSnapshot: null,
  }), {
    payeeName: 'payee_name_required',
    payeeAddress: 'payee_address_too_long',
    payeeTaxId: 'payee_tax_id_13',
  });
  assert.deepEqual(validatePayeeIdentity({
    payeeName: 'ก'.repeat(201), payeeAddress: '', payeeTaxId: '', vendorNameSnapshot: 'ผู้ขายเดิม',
  }), { payeeName: 'payee_name_too_long' });
  assert.equal(payeeTaxIdDigits('1-2345-67890-12-3'), '1234567890123');
  assert.equal(payeeTaxIdDigits('12345678901234').length, 14, 'do not silently cap an incomplete overlong entry');
});

test('counts unmet detail requirements, including invalid optional identity values', () => {
  assert.deepEqual(evaluateDetailsReadiness({
    payeeName: '', payeeAddress: 'ก'.repeat(301), payeeTaxId: '123', vendorNameSnapshot: null,
    missingReason: '', businessPurpose: '', payerId: 'payer-1', payerEligible: false, paymentDate: '',
  }), {
    ready: false,
    missing: ['payeeName', 'payeeAddress', 'payeeTaxId', 'missingReason', 'businessPurpose', 'payer', 'paymentDate'],
    missingCount: 7,
  });
  assert.deepEqual(evaluateDetailsReadiness({
    payeeName: 'ผู้ขายเดิม', payeeAddress: '', payeeTaxId: '', vendorNameSnapshot: 'ผู้ขายเดิม',
    missingReason: 'ร้านไม่ออกใบเสร็จ', businessPurpose: 'ซื้อวัสดุ', payerId: 'payer-1', payerEligible: true,
    paymentDate: '2026-08-08',
  }), { ready: true, missing: [], missingCount: 0 });
});

test('evaluates policy-driven evidence requirements', () => {
  assert.deepEqual(evaluateEvidenceReadiness({
    policyReady: false, supportingCount: 0, paymentCount: 0, requiresPaymentEvidence: true,
  }), { ready: false, missing: ['policy', 'supportingEvidence', 'paymentEvidence'], missingCount: 3 });
  assert.deepEqual(evaluateEvidenceReadiness({
    policyReady: true, supportingCount: 1, paymentCount: 0, requiresPaymentEvidence: false,
  }), { ready: true, missing: [], missingCount: 0 });
  assert.equal(substituteReceiptEvidenceRenderabilityIssue(
    Array.from({ length: 9 }, (_, index) => ({ id: `att-${index}`, originalFileName: `${index}.pdf` })),
  ), 'too_many_evidence');
  assert.equal(substituteReceiptEvidenceRenderabilityIssue([
    { id: 'att-long', originalFileName: `${'ก'.repeat(252)}.pdf` },
  ]), 'evidence_filename_too_long');
  assert.equal(substituteReceiptEvidenceRenderabilityIssue(
    Array.from({ length: 8 }, (_, index) => ({
      id: `att-${index}`, originalFileName: `${'ก'.repeat(251)}.pdf`,
    })),
  ), null);
  assert.deepEqual(evaluateEvidenceReadiness({
    policyReady: true,
    supportingCount: 8,
    paymentCount: 1,
    requiresPaymentEvidence: true,
    renderabilityIssue: 'too_many_evidence',
  }), { ready: false, missing: ['renderability'], missingCount: 1 });
});

test('evaluates the shared payer and approver signing requirements', () => {
  assert.deepEqual(evaluateSigningReadiness({
    position: '', previewed: false, signatureReady: false, acknowledged: false,
  }), {
    ready: false,
    missing: ['position', 'preview', 'signature', 'acknowledgement'],
    missingCount: 4,
  });
  assert.deepEqual(evaluateSigningReadiness({
    position: 'เจ้าของกิจการ', previewed: true, signatureReady: true, acknowledged: true,
  }), { ready: true, missing: [], missingCount: 0 });
});

test('resolves the wizard step from evidence status', () => {
  assert.equal(resolveWizardStep(null), 'expense');
  assert.equal(resolveWizardStep({ status: 'PREPARED' }), 'certify');
  assert.equal(resolveWizardStep({ status: 'PAYER_CERTIFIED' }), 'approve');
  assert.equal(resolveWizardStep({ status: 'ISSUED' }), 'done');
  assert.equal(resolveWizardStep({ status: 'SUPERSEDED' }), 'done');
});

test('allows approval of another payer with expense.confirm', () => {
  assert.equal(mayApproveSubstituteReceipt({
    userId: 'approver',
    payerUserId: 'payer',
    canConfirm: true,
    canSelfApprove: false,
    approvalMode: 'DESIGNATED_APPROVERS',
  }), true);
});

test('allows self-approval only for an owner in owner-self mode', () => {
  const input = {
    userId: 'payer',
    payerUserId: 'payer',
    canConfirm: true,
    approvalMode: 'OWNER_SELF' as const,
  };
  assert.equal(mayApproveSubstituteReceipt({ ...input, canSelfApprove: true }), true);
  assert.equal(mayApproveSubstituteReceipt({ ...input, canSelfApprove: false }), false);
  assert.equal(mayApproveSubstituteReceipt({
    ...input,
    canSelfApprove: true,
    approvalMode: 'DESIGNATED_APPROVERS',
  }), false);
  assert.equal(mayApproveSubstituteReceipt({ ...input, canConfirm: false, canSelfApprove: true }), false);
});

test('sorts candidates by every key and slices five per page', async () => {
  const { sortAndPageCandidates } = await import('./substitute-receipt-wizard.model');
  const items = [
    { expenseDate: '2026-08-01', grandTotalAmount: '300' },
    { expenseDate: '2026-08-03', grandTotalAmount: '100' },
    { expenseDate: '2026-08-02', grandTotalAmount: '200' },
    { expenseDate: '2026-08-06', grandTotalAmount: '600' },
    { expenseDate: '2026-08-05', grandTotalAmount: '500' },
    { expenseDate: '2026-08-04', grandTotalAmount: '400' },
  ];
  const dateDesc = sortAndPageCandidates(items, 'date_desc', 1);
  assert.deepEqual(dateDesc.rows.map((row) => row.expenseDate), ['2026-08-06', '2026-08-05', '2026-08-04', '2026-08-03', '2026-08-02']);
  assert.equal(dateDesc.totalPages, 2);
  assert.deepEqual(sortAndPageCandidates(items, 'date_desc', 2).rows.map((row) => row.expenseDate), ['2026-08-01']);
  assert.deepEqual(sortAndPageCandidates(items, 'date_asc', 1).rows[0]!.expenseDate, '2026-08-01');
  assert.deepEqual(sortAndPageCandidates(items, 'amount_desc', 1).rows[0]!.grandTotalAmount, '600');
  assert.deepEqual(sortAndPageCandidates(items, 'amount_asc', 1).rows[0]!.grandTotalAmount, '100');
});

test('clamps the page back into range when a search shrinks the list', async () => {
  const { sortAndPageCandidates } = await import('./substitute-receipt-wizard.model');
  const items = [{ expenseDate: '2026-08-01', grandTotalAmount: '10' }];
  const result = sortAndPageCandidates(items, 'date_desc', 9);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(sortAndPageCandidates([], 'date_desc', 1).totalPages, 1);
});
