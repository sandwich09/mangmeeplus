import assert from 'node:assert/strict';
import { test, it } from 'node:test';
import {
  defaultCertifierId,
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
  resolveWizardSignatureSource,
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
  assert.deepEqual(evaluateManualLinesReadiness(Array.from({ length: 201 }, () => lines[0]!)), {
    ready: false, missingCount: 1, invalidLineIndexes: [],
  });
  assert.equal(evaluateManualLinesReadiness(Array.from({ length: 200 }, () => lines[0]!)).ready, true);
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
  assert.equal(isSubstituteReceiptCandidateEligible({ ...eligibleCandidate, lines: Array.from({ length: 200 }, () => eligibleCandidate.lines[0]!) }), true);
  const tooManyLines = { ...eligibleCandidate, lines: Array.from({ length: 201 }, () => eligibleCandidate.lines[0]!) };
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

test('names the one reason an expense cannot get a certificate, in the order the checks run', async () => {
  const { substituteReceiptIneligibleCause } = await import('./substitute-receipt-wizard.model');
  assert.equal(substituteReceiptIneligibleCause(eligibleCandidate), null);
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, status: 'CONFIRMED' }), 'status');
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, sourceDocumentType: 'SUBSTITUTE_RECEIPT' }), 'documentType');
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, currency: 'USD' }), 'currency');
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, grandTotalAmount: '0' }), 'amount');
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, taxEvidenceStatus: 'USABLE_FOR_TAX' }), 'taxEvidence');
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, lines: [] }), 'lines');
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, expenseCategoryId: null, lines: [{ ...eligibleCandidate.lines[0]!, expenseCategoryId: null }] }), 'category');
  assert.equal(substituteReceiptIneligibleCause({ ...eligibleCandidate, aiVerificationSummaryJson: { classification: { documentKind: 'QUOTATION' } } }), 'classification');
  // The yes/no the list and the prepare guard use is the same check.
  assert.equal(isSubstituteReceiptCandidateOtherwiseEligible({ ...eligibleCandidate, sourceDocumentType: 'SUBSTITUTE_RECEIPT' }), false);
});

test('keeps an expense in the list of step 1 while the wizard can still finish it', async () => {
  const { isSubstituteReceiptWizardResumable } = await import('./substitute-receipt-wizard.model');
  // The answer "make a certificate" was saved and nothing was issued yet.
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, substituteReceiptEvidence: null }, 'SUBSTITUTE_RECEIPT'), true);
  // Its certificate was cancelled: a new one can be made.
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, substituteReceiptEvidence: { status: 'SUPERSEDED' } }, 'SUBSTITUTE_RECEIPT'), true);
  // The document type chosen on step 1 is the only obstacle: step 1 is where it is put right.
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, sourceDocumentType: 'SUBSTITUTE_RECEIPT', substituteReceiptEvidence: null }, 'SUBSTITUTE_RECEIPT'), true);
  // A live certificate, another answer, or another obstacle: not this list's business.
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, substituteReceiptEvidence: { status: 'PREPARED' } }, 'SUBSTITUTE_RECEIPT'), false);
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, substituteReceiptEvidence: { status: 'ISSUED' } }, 'SUBSTITUTE_RECEIPT'), false);
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, substituteReceiptEvidence: null }, 'ALTERNATIVE_EVIDENCE'), false);
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, substituteReceiptEvidence: null }, null), false);
  assert.equal(isSubstituteReceiptWizardResumable({ ...eligibleCandidate, currency: 'USD', substituteReceiptEvidence: null }, 'SUBSTITUTE_RECEIPT'), false);
});

test('starts receipt-classified expenses with a compatible missing-receipt reason', () => {
  assert.equal(defaultSubstituteReceiptReason('RECEIPT'), 'RECEIPT_UNAVAILABLE');
  assert.equal(defaultSubstituteReceiptReason('TAX_INVOICE'), 'RECEIPT_UNAVAILABLE');
  assert.equal(defaultSubstituteReceiptReason('EXPENSE_NOTE_TEXT'), 'PAYEE_CANNOT_ISSUE');
});

test('keeps check bills selectable after override or reload without relaxing other eligibility', () => {
  const checkBill = { ...eligibleCandidate, sourceDocumentType: 'NEEDS_REVIEW' as const, taxEvidenceStatus: 'NEEDS_REVIEW',
    aiVerificationSummaryJson: { status: 'NOT_EXPENSE_DOCUMENT', classification: { documentKind: 'ORDER_OR_CHECK_BILL' } } };
  for (const outcome of ['FINANCE_OVERRIDDEN_AS_EXPENSE', 'ROUTED_TO_SUBSTITUTE_RECEIPT', undefined]) {
    assert.equal(isSubstituteReceiptCandidateEligible({ ...checkBill, aiVerificationSummaryJson: {
      ...checkBill.aiVerificationSummaryJson, classificationResolution: { outcome },
    } }), true);
  }
  assert.equal(isSubstituteReceiptCandidateEligible({ ...checkBill, status: 'VOIDED' }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...checkBill, status: 'CONFIRMED' }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...checkBill, currency: 'USD' }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...checkBill, grandTotalAmount: '0' }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...checkBill, lines: [] }), false);
  assert.equal(isSubstituteReceiptCandidateEligible({ ...checkBill, taxEvidenceStatus: 'USABLE_FOR_TAX' }), true,
    'the atomic check-bill route downgrades tax status instead of making it claimable');
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
    policyReady: false, paymentCount: 0, requiresPaymentEvidence: true,
  }), { ready: false, missing: ['policy', 'paymentEvidence'], missingCount: 2 });
  // R5: zero attachments is prepare-ready; the wizard asks for files, it does not demand them.
  assert.deepEqual(evaluateEvidenceReadiness({
    policyReady: true, paymentCount: 0, requiresPaymentEvidence: false,
  }), { ready: true, missing: [], missingCount: 0 });
  assert.equal(substituteReceiptEvidenceRenderabilityIssue(
    Array.from({ length: 31 }, (_, index) => ({ id: `att-${index}`, originalFileName: `${index}.pdf` })),
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
    paymentCount: 1,
    requiresPaymentEvidence: true,
    renderabilityIssue: 'too_many_evidence',
  }), { ready: false, missing: ['renderability'], missingCount: 1 });
});

test('evaluates the shared payer and approver signing requirements', () => {
  assert.deepEqual(evaluateSigningReadiness({
    previewed: false, signatureReady: false, acknowledged: false,
  }), {
    ready: false,
    missing: ['preview', 'signature', 'acknowledgement'],
    missingCount: 3,
  });
  assert.deepEqual(evaluateSigningReadiness({
    previewed: true, signatureReady: true, acknowledged: true,
  }), { ready: true, missing: [], missingCount: 0 });
});

test('R9: offers the saved signature by default and lets a fresh one win', () => {
  const source = (hasReusableSignature: boolean, chosenFile: boolean, preparedFile: boolean) => (
    resolveWizardSignatureSource({ hasReusableSignature, chosenFile, preparedFile })
  );
  assert.equal(source(true, false, false), 'signature_library');
  assert.equal(source(true, true, true), 'evidence_upload');
  assert.equal(source(false, true, true), 'evidence_upload');
  // Unchanged for a first-time signer: signing stays blocked until a file is prepared.
  assert.equal(source(false, false, false), 'none');
  assert.equal(source(false, true, false), 'none');
  // A chosen but unprocessed file — or unconfirmed strokes on the pad — blocks even with a saved
  // signature available: signing must never silently fall back to the saved image and discard what
  // the signer just picked or drew.
  assert.equal(source(true, true, false), 'none');
  assert.deepEqual(evaluateSigningReadiness({
    previewed: true, acknowledged: true,
    signatureReady: source(true, false, false) !== 'none',
  }), { ready: true, missing: [], missingCount: 0 });
  assert.deepEqual(evaluateSigningReadiness({
    previewed: true, acknowledged: true,
    signatureReady: source(true, true, false) !== 'none',
  }), { ready: false, missing: ['signature'], missingCount: 1 });
});

test('resolves the wizard step from evidence status', () => {
  assert.equal(resolveWizardStep(null), 'expense');
  assert.equal(resolveWizardStep({ status: 'PREPARED' }), 'certify');
  assert.equal(resolveWizardStep({ status: 'PAYER_CERTIFIED' }), 'approve');
  assert.equal(resolveWizardStep({ status: 'ISSUED' }), 'done');
  assert.equal(resolveWizardStep({ status: 'SUPERSEDED' }), 'done');
});

test('presets the certifier: an owner making the certificate signs it herself', () => {
  const payers = [{ userId: 'first-owner', isOwner: true }, { userId: 'second-owner', isOwner: true }, { userId: 'staff' }];
  assert.equal(defaultCertifierId(payers, 'second-owner', 'OWNER_SELF'), 'second-owner');
  assert.equal(defaultCertifierId(payers, 'staff', 'OWNER_SELF'), 'first-owner');
  assert.equal(defaultCertifierId(payers, 'outsider', 'OWNER_SELF'), 'first-owner');
  assert.equal(defaultCertifierId(payers, 'staff', 'DESIGNATED_APPROVERS'), 'staff');
  assert.equal(defaultCertifierId(payers, 'outsider', 'DESIGNATED_APPROVERS'), '');
  assert.equal(defaultCertifierId([{ userId: 'staff' }], 'staff', 'OWNER_SELF'), '');
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

const preparableExpense = {
  grandTotalAmount: '350.00',
  expenseCategoryId: null,
  accountHintKey: null,
  lines: [{ description: 'ค่าแท็กซี่', expenseCategoryId: 'category-1', accountHintKey: null }],
};

test('names the expense-level prepare blockers before anything is typed', async () => {
  const { evaluateExpensePrerequisites } = await import('./substitute-receipt-wizard.model');
  assert.deepEqual(evaluateExpensePrerequisites(preparableExpense), { ready: true, missing: [], missingCount: 0 });
  // A ฿0 draft and a category-less draft are exactly what the prepare endpoint refuses, one per click.
  assert.deepEqual(
    evaluateExpensePrerequisites({ ...preparableExpense, grandTotalAmount: '0.0000' }).missing,
    ['reviewedAmount'],
  );
  assert.deepEqual(
    evaluateExpensePrerequisites({
      ...preparableExpense,
      lines: [{ description: 'ค่าแท็กซี่', expenseCategoryId: null, accountHintKey: null }],
    }).missing,
    ['reviewedCategory'],
  );
  // A header category or an account hint on every line answers the same rule.
  assert.equal(evaluateExpensePrerequisites({
    ...preparableExpense,
    expenseCategoryId: 'category-1',
    lines: [{ description: 'ค่าแท็กซี่', expenseCategoryId: null, accountHintKey: null }],
  }).ready, true);
  assert.equal(evaluateExpensePrerequisites({
    ...preparableExpense,
    lines: [{ description: 'ค่าแท็กซี่', expenseCategoryId: null, accountHintKey: 'expense.travel' }],
  }).ready, true);
  // Both at once are reported together, not one per failed attempt.
  assert.deepEqual(
    evaluateExpensePrerequisites({
      ...preparableExpense,
      grandTotalAmount: '0',
      lines: [{ description: 'ค่าแท็กซี่', expenseCategoryId: null, accountHintKey: null }],
    }).missing,
    ['reviewedAmount', 'reviewedCategory'],
  );
  assert.deepEqual(evaluateExpensePrerequisites({ ...preparableExpense, lines: [] }).missing, ['reviewedCategory']);
});

test('separates "not ready yet" from "not your turn" for each signing stage', async () => {
  const { resolveSubstituteTurn } = await import('./substitute-receipt-wizard.model');
  const base = { payerUserId: 'payer-1', userId: 'payer-1', mayApprove: false };
  assert.deepEqual(resolveSubstituteTurn({ ...base, status: 'PREPARED' }), {
    stage: 'certify', mine: true, waitingFor: null,
  });
  assert.deepEqual(resolveSubstituteTurn({ ...base, status: 'PREPARED', userId: 'someone-else' }), {
    stage: 'certify', mine: false, waitingFor: 'payer',
  });
  assert.deepEqual(resolveSubstituteTurn({ ...base, status: 'PAYER_CERTIFIED' }), {
    stage: 'approve', mine: false, waitingFor: 'approver',
  });
  assert.deepEqual(resolveSubstituteTurn({ ...base, status: 'PAYER_CERTIFIED', mayApprove: true }), {
    stage: 'approve', mine: true, waitingFor: null,
  });
  assert.equal(resolveSubstituteTurn({ ...base, status: 'ISSUED' }).stage, 'done');
  assert.equal(resolveSubstituteTurn({ ...base, status: 'SUPERSEDED' }).stage, 'done');
});

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
}

const draft = {
  step: 'details' as const,
  consent: true,
  reasonCode: 'RECEIPT_UNAVAILABLE' as const,
  missingReason: 'คนขับไม่ออกใบเสร็จ',
  businessPurpose: 'ไปพบลูกค้า',
  payeeName: 'วินมอเตอร์ไซค์',
  payeeAddress: 'ปากซอย',
  payeeTaxId: '1234567890123',
  payerId: 'payer-1', fundingSource: '' as const, paidInFullAcknowledged: false,
  paymentMethod: 'CASH' as const,
  paymentDate: '2026-08-19',
  supportingIds: ['attachment-1'],
  paymentIds: [],
};

test('restores the pre-prepare draft only for the expense it was typed on', async () => {
  const model = await import('./substitute-receipt-wizard.model');
  const storage = fakeStorage();
  model.writeSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-a', draft);
  assert.deepEqual(model.readSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-a'), draft);
  // A different expense, or a different company, must never inherit these answers.
  assert.equal(model.readSubstituteWizardDraft(storage, 'company-1', 'expense-2', 'user-a'), null);
  assert.equal(model.readSubstituteWizardDraft(storage, 'company-2', 'expense-1', 'user-a'), null);
  // Even if the payload is moved under another expense's key, the stored scope still decides.
  storage.setItem(
    model.substituteWizardDraftKey('company-1', 'expense-2', 'user-a'),
    storage.getItem(model.substituteWizardDraftKey('company-1', 'expense-1', 'user-a'))!,
  );
  assert.equal(model.readSubstituteWizardDraft(storage, 'company-1', 'expense-2', 'user-a'), null);
  model.clearSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-a');
  assert.equal(model.readSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-a'), null);
});

/**
 * sessionStorage is per TAB, and signing out is a same-tab navigation. Without the signer in the
 * scope, user B signing in on the tab user A just left opened the same expense's wizard onto A's
 * unsent reason, business purpose and payee identity — and could certify a statutory tax document
 * carrying A's wording. Key AND envelope, so neither a shared key nor a copied payload is enough.
 */
test('never hands one person the draft another person typed', async () => {
  const model = await import('./substitute-receipt-wizard.model');
  const storage = fakeStorage();
  model.writeSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-a', draft);

  assert.equal(model.readSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-b'), null);
  assert.notEqual(
    model.substituteWizardDraftKey('company-1', 'expense-1', 'user-a'),
    model.substituteWizardDraftKey('company-1', 'expense-1', 'user-b'),
  );
  // And moving the payload under B's key still fails: the author is stored, not assumed.
  storage.setItem(
    model.substituteWizardDraftKey('company-1', 'expense-1', 'user-b'),
    storage.getItem(model.substituteWizardDraftKey('company-1', 'expense-1', 'user-a'))!,
  );
  assert.equal(model.readSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-b'), null);
  assert.deepEqual(model.readSubstituteWizardDraft(storage, 'company-1', 'expense-1', 'user-a'), draft);
});

test('ignores an unreadable, outdated or post-prepare stored draft', async () => {
  const model = await import('./substitute-receipt-wizard.model');
  const scope = { companyId: 'company-1', expenseId: 'expense-1', userId: 'user-a' };
  assert.equal(model.parseSubstituteWizardDraft(null, scope), null);
  assert.equal(model.parseSubstituteWizardDraft('{not json', scope), null);
  assert.equal(model.parseSubstituteWizardDraft(JSON.stringify({ v: 99, ...scope, draft }), scope), null);
  // certify/approve/done are server-resolved: a stored copy must never re-seed a prepared document.
  assert.equal(model.parseSubstituteWizardDraft(
    JSON.stringify({ v: model.SUBSTITUTE_WIZARD_DRAFT_VERSION, ...scope, draft: { ...draft, step: 'certify' } }),
    scope,
  ), null);
  // Unknown enum values fall back instead of poisoning the form with an unsubmittable value.
  const coerced = model.parseSubstituteWizardDraft(
    JSON.stringify({
      v: model.SUBSTITUTE_WIZARD_DRAFT_VERSION,
      ...scope,
      draft: { ...draft, reasonCode: 'NONSENSE', paymentMethod: 'BITCOIN', supportingIds: ['ok', 7] },
    }),
    scope,
  );
  assert.equal(coerced?.reasonCode, 'PAYEE_CANNOT_ISSUE');
  assert.equal(coerced?.paymentMethod, 'CASH');
  assert.deepEqual(coerced?.supportingIds, ['ok']);
});

test('survives a storage that refuses to read or write', async () => {
  const model = await import('./substitute-receipt-wizard.model');
  const blocked = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };
  assert.equal(model.readSubstituteWizardDraft(blocked, 'company-1', 'expense-1', 'user-a'), null);
  assert.doesNotThrow(() => model.writeSubstituteWizardDraft(blocked, 'company-1', 'expense-1', 'user-a', draft));
  assert.doesNotThrow(() => model.clearSubstituteWizardDraft(blocked, 'company-1', 'expense-1', 'user-a'));
  assert.equal(model.readSubstituteWizardDraft(null, 'company-1', 'expense-1', 'user-a'), null);
});

/**
 * B2: the LINE text-note capture stamps `missingReceiptReason` with a marker so the evidence-gap
 * rules read "no file, reason recorded". The certificate prints that field VERBATIM, so seeding the
 * form with it produces a statutory document whose stated reason is a system note nobody wrote.
 */
test('never seeds the certificate reason with the LINE capture marker', async () => {
  const model = await import('./substitute-receipt-wizard.model');
  for (const marker of [
    'บันทึกค่าใช้จ่ายจากข้อความใน LINE ยังไม่ได้แนบไฟล์หลักฐาน',
    'LINE text-only expense note; evidence file not attached',
    '  บันทึกค่าใช้จ่ายจากข้อความใน LINE ยังไม่ได้แนบไฟล์หลักฐาน  ',
  ]) {
    assert.equal(model.isAutoMissingReceiptReason(marker), true, marker);
    assert.equal(model.payerWrittenMissingReason(marker), '', 'the payer has to write a real reason');
  }
  // A reason a person actually typed is theirs and survives untouched.
  assert.equal(model.isAutoMissingReceiptReason('ผู้ขายรายย่อยไม่ออกใบเสร็จ'), false);
  assert.equal(model.payerWrittenMissingReason('ผู้ขายรายย่อยไม่ออกใบเสร็จ'), 'ผู้ขายรายย่อยไม่ออกใบเสร็จ');
  assert.equal(model.payerWrittenMissingReason(null), '');
  assert.equal(model.payerWrittenMissingReason(undefined), '');
});

test('allows shared expense facts before choosing an account or signing method', () => {
  const result = evaluateDetailsReadiness({ payeeName: 'ร้านทดสอบ', payeeAddress: '', payeeTaxId: '', vendorNameSnapshot: null,
    missingReason: 'ไม่ออกใบเสร็จ', businessPurpose: 'ซื้อของใช้ในบริษัท', payerId: '', payerEligible: false, requirePayer: false, paymentDate: '2026-09-09' });
  assert.equal(result.ready, true);
  assert.equal(wizardJourneyStage('method'), 'sign');
});


test('source edits select the current internal revision of the same document only', async () => {
  const { currentSubstituteRevision } = await import('./substitute-receipt-wizard.model');
  const old = { id: 'old', documentNumber: 'SRC-1', version: 1, status: 'SUPERSEDED' };
  const current = { ...old, id: 'current', version: 2, status: 'PREPARED' };
  const unrelated = { ...current, id: 'different', documentNumber: 'SRC-2', version: 3 };
  assert.equal(currentSubstituteRevision([unrelated, current, old], old), current);
  assert.equal(currentSubstituteRevision([old, unrelated], old), old);
  assert.equal(currentSubstituteRevision([current, old], current), current);
});


test('old links follow automatic month revisions including a return to the original number', async () => {
  const { currentSubstituteRevision } = await import('./substitute-receipt-wizard.model');
  const september = { id: 'sep', documentNumber: 'SRC-202609-00001', version: 1, status: 'SUPERSEDED' };
  const august = { id: 'aug', documentNumber: 'SRC-202608-00001', version: 2, status: 'SUPERSEDED', revisionOfEvidenceId: 'sep' };
  const returned = { id: 'back', documentNumber: september.documentNumber, version: 3, status: 'PREPARED', revisionOfEvidenceId: 'aug' };
  const other = { id: 'other', documentNumber: 'SRC-202609-00002', version: 4, status: 'PREPARED' };
  for (const old of [september, august]) assert.equal(currentSubstituteRevision([other, returned, august, september], old), returned);
  assert.equal(currentSubstituteRevision([other, { ...returned, status: 'SUPERSEDED' }, august, september], september), september);
});

import { canEditSubstituteReceipt, paymentMonthChanged } from './substitute-receipt-wizard.model';
it('payment-date month confirmation treats a year change as a new month and ignores same-month days', () => {
  assert.equal(paymentMonthChanged('2026-09-10', '2026-09-14'), false);
  assert.equal(paymentMonthChanged('2026-09-10', '2026-08-14'), true);
  assert.equal(paymentMonthChanged('2026-09-10', '2027-09-10'), true);
  assert.equal(paymentMonthChanged('', '2026-09-10'), false);
});
it('source and certificate expose edits only before issuance and financial linkage', () => {
  const source = { status: 'NEEDS_REVIEW', paidAmount: '0', journalEntryId: null, postingStatus: 'not_required' };
  for (const status of ['PREPARED', 'PAYER_CERTIFIED']) assert.equal(canEditSubstituteReceipt(source, { status }), true);
  for (const status of ['ISSUED', 'SUPERSEDED']) assert.equal(canEditSubstituteReceipt(source, { status }), false);
  for (const patch of [{ paidAmount: '1' }, { journalEntryId: 'journal' }, { postingStatus: 'posted' }, { status: 'CONFIRMED' }]) {
    assert.equal(canEditSubstituteReceipt({ ...source, ...patch }, { status: 'PREPARED' }), false);
  }
  assert.equal(canEditSubstituteReceipt(source, { status: 'PREPARED', correctionOfEvidenceId: 'issued' }), false);
});

import { canVoidExpenseFinancialState } from '@watchdog-bms/contracts';
it('offers the existing cancellation route for paid incomplete expenses without opening unpaid drafts or claim projections', () => {
  const draft = { status: 'NEEDS_REVIEW', paidAmount: '100' };
  assert.equal(canVoidExpenseFinancialState(draft), true);
  assert.equal(canVoidExpenseFinancialState({ ...draft, paidAmount: '0' }), false);
  assert.equal(canVoidExpenseFinancialState({ ...draft, status: 'VOIDED' }), false);
  assert.equal(canVoidExpenseFinancialState({ ...draft, sourceReimbursementRequestId: 'claim' }), false);
  assert.equal(canVoidExpenseFinancialState({ ...draft, paidAmount: '0', journalEntryId: 'posted' }), true);
});

import { canClaimReimbursementFromSubstituteReceipt } from './substitute-receipt-wizard.model';
it('shows the reimbursement-claim entry point only for an issued personal-advance receipt with a linked payer and create permission (spec §10/AC08/AC09)', () => {
  const issued = { status: 'ISSUED', fundingSource: 'PERSONAL_ADVANCE', payerUserId: 'user-1' } as const;
  assert.equal(canClaimReimbursementFromSubstituteReceipt(issued, true), true);
  // AC09: paper-signed with no linked payer account — no button.
  assert.equal(canClaimReimbursementFromSubstituteReceipt({ ...issued, payerUserId: null }, true), false);
  // AC09: company-paid receipt — no button.
  assert.equal(canClaimReimbursementFromSubstituteReceipt({ ...issued, fundingSource: 'COMPANY' }, true), false);
  assert.equal(canClaimReimbursementFromSubstituteReceipt({ ...issued, fundingSource: undefined }, true), false);
  // Not yet issued — no button at any earlier status.
  for (const status of ['PREPARED', 'PAYER_CERTIFIED', 'SUPERSEDED'] as const) {
    assert.equal(canClaimReimbursementFromSubstituteReceipt({ ...issued, status }, true), false);
  }
  // Viewer without reimbursement.create — no button even though the receipt itself qualifies.
  assert.equal(canClaimReimbursementFromSubstituteReceipt(issued, false), false);
  // Not yet loaded (wizard) — no button.
  assert.equal(canClaimReimbursementFromSubstituteReceipt(null, true), false);
  assert.equal(canClaimReimbursementFromSubstituteReceipt(undefined, true), false);
});

test('restores the selected signing method and method step after session recovery', async () => {
  const model = await import('./substitute-receipt-wizard.model');
  const storage = new Map<string, string>();
  const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const draft = { step: 'method', signingMethod: 'DIGITAL', consent: true, reasonCode: 'PAYEE_CANNOT_ISSUE', missingReason: 'ร้านไม่ออกให้', businessPurpose: 'ซื้อของ', payeeName: 'ร้าน', payeeAddress: '', payeeTaxId: '', payerId: 'owner', paymentMethod: 'BANK_TRANSFER', paymentDate: '2026-10-13', supportingIds: [], paymentIds: [], fundingSource: 'COMPANY', paidInFullAcknowledged: true } as const;
  model.writeSubstituteWizardDraft(adapter, 'co', 'expense', 'user', { ...draft, supportingIds: [], paymentIds: [] });
  assert.equal(model.readSubstituteWizardDraft(adapter, 'co', 'expense', 'user')?.step, 'method');
  assert.equal(model.readSubstituteWizardDraft(adapter, 'co', 'expense', 'user')?.signingMethod, 'DIGITAL');
});


test('SUB-DOC signing identifies the first missing field in display order for every combination', () => {
  for (const previewed of [false, true]) for (const signatureReady of [false, true]) for (const acknowledged of [false, true]) {
    const result = evaluateSigningReadiness({ previewed, signatureReady, acknowledged });
    assert.deepEqual(result.missing, [!previewed && 'preview', !signatureReady && 'signature', !acknowledged && 'acknowledgement'].filter(Boolean));
    assert.equal(result.ready, previewed && signatureReady && acknowledged);
  }
});
