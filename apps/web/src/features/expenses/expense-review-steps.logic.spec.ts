import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveExpenseReviewSteps, expenseAiMissingFields, initialExpenseReviewStep } from './expenses.model';

type StepsInput = Parameters<typeof deriveExpenseReviewSteps>[0];

// Editable draft where every step is already satisfied — cases below unset one dimension at a time.
const base: StepsInput = {
  attachments: [{ purpose: 'expense.receipt.primary', status: 'ACTIVE' }],
  aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW' },
  vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด',
  expenseDate: '2026-07-01',
  lines: [{}],
  taxEvidenceStatus: 'USABLE_FOR_TAX',
  missingReceiptReason: null,
  substituteReceiptGeneratedAt: null,
  sourceDocumentType: 'TAX_INVOICE',
  substituteReceiptEvidence: null,
  duplicateStatus: 'NO_MATCH',
};

const stepState = (over: Partial<StepsInput>, key: string) =>
  deriveExpenseReviewSteps({ ...base, ...over }, true).find((step) => step.key === key)?.state;

const initialFor = (over: Partial<StepsInput>) =>
  initialExpenseReviewStep(deriveExpenseReviewSteps({ ...base, ...over }, true));

describe('deriveExpenseReviewSteps', () => {
  it('keeps the data step pending until vendor name, expense date, and one line exist', () => {
    assert.equal(stepState({ vendorNameSnapshot: null }, 'data'), 'pending');
    assert.equal(stepState({ vendorNameSnapshot: '   ' }, 'data'), 'pending');
    assert.equal(stepState({ lines: [] }, 'data'), 'pending');
    assert.equal(stepState({}, 'data'), 'done');
  });

  it('marks complete data done without an AI summary', () => {
    assert.equal(stepState({ aiVerificationSummaryJson: null }, 'data'), 'done');
  });

  it('keeps the data step done while AI-missing flags are outstanding — the filled values are what count', () => {
    assert.equal(stepState({ aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['expenseDate'] } }, 'data'), 'done');
    assert.equal(stepState({ aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['vendorName', 'amount'] } }, 'data'), 'done');
    assert.equal(stepState({ aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['receipt_evidence'] } }, 'data'), 'done');
    assert.equal(stepState({ aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: [] } }, 'data'), 'done');
    // a flag the AI raised for a field the form never filled still leaves the step incomplete
    assert.equal(stepState({ vendorNameSnapshot: null, aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['vendorName'] } }, 'data'), 'pending');
  });

  it('ignores AI missing-field keys the review form has no input for', () => {
    // Two fixes landed on this complaint and both survive, at different layers. The data step no
    // longer consults the AI flags at all — filled values decide it — so an outstanding flag of any
    // kind leaves it done. What the allowlist still governs is which fields the blue
    // "AI อ่านได้ไม่ครบ" banner names: the model emits keys like buyerName/description/
    // categorySuggestion that no form field can clear, and naming those would send the user hunting
    // for an input that does not exist.
    const summary = (missingFields: string[]) => ({ status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields });
    assert.equal(stepState({ aiVerificationSummaryJson: summary(['buyerName', 'vendorTaxId']) }, 'data'), 'done');

    assert.deepEqual(expenseAiMissingFields(summary(['buyerName']), 'data'), []);
    assert.deepEqual(expenseAiMissingFields(summary(['description', 'categorySuggestion']), 'data'), []);
    // a mix keeps only the clearable key
    assert.deepEqual(expenseAiMissingFields(summary(['buyerName', 'vendorTaxId']), 'data'), ['vendorTaxId']);
    // unknown keys never leak into the evidence step, which does still gate on its flags
    assert.deepEqual(expenseAiMissingFields(summary(['buyerName']), 'evidence'), []);
    assert.equal(stepState({ aiVerificationSummaryJson: summary(['buyerName']) }, 'evidence'), 'done');
    assert.equal(stepState({ aiVerificationSummaryJson: summary(['category']) }, 'evidence'), 'pending');
  });

  it('keeps the evidence step pending while tax evidence is still NEEDS_REVIEW', () => {
    assert.equal(stepState({ taxEvidenceStatus: 'NEEDS_REVIEW' }, 'evidence'), 'pending');
    assert.equal(stepState({ taxEvidenceStatus: 'SUPPORTING_ONLY' }, 'evidence'), 'done');
  });

  it('flags the evidence step until a relied-upon substitute receipt is fully issued', () => {
    assert.equal(stepState({ missingReceiptReason: 'ไม่ได้รับใบเสร็จ' }, 'evidence'), 'attention');
    assert.equal(stepState({ missingReceiptReason: 'ไม่ได้รับใบเสร็จ', substituteReceiptEvidence: { status: 'PREPARED', artifactAttachmentId: null } }, 'evidence'), 'attention');
    assert.equal(stepState({ missingReceiptReason: 'ไม่ได้รับใบเสร็จ', substituteReceiptEvidence: { status: 'ISSUED', artifactAttachmentId: 'att-1' } }, 'evidence'), 'done');
  });

  it('flags the evidence step for the no-invoice case: no ACTIVE primary receipt and no substitute path started', () => {
    assert.equal(stepState({ attachments: [] }, 'evidence'), 'attention');
    assert.equal(stepState({ attachments: [{ purpose: 'expense.receipt.supporting', status: 'ACTIVE' }] }, 'evidence'), 'attention');
    assert.equal(stepState({ attachments: [{ purpose: 'expense.receipt.primary', status: 'DELETED' }] }, 'evidence'), 'attention');
    // a fully issued substitute satisfies the rule without any receipt attachment
    assert.equal(stepState({ attachments: [], missingReceiptReason: 'ไม่ได้รับใบเสร็จ', substituteReceiptEvidence: { status: 'ISSUED', artifactAttachmentId: 'att-1' } }, 'evidence'), 'done');
  });

  it('keeps the evidence step from done while the AI category flag is outstanding, and ignores the stale receipt_evidence flag', () => {
    assert.equal(stepState({ aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['category'] } }, 'evidence'), 'pending');
    // receipt_evidence is stamped once at LINE text-note capture; live attachment state is the truth
    assert.equal(stepState({ aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['receipt_evidence'] } }, 'evidence'), 'done');
  });

  it('flags the evidence step while the non-expense classification block is unresolved', () => {
    assert.equal(stepState({ aiVerificationSummaryJson: { status: 'NOT_EXPENSE_DOCUMENT' } }, 'evidence'), 'attention');
  });

  it('flags the review step for unresolved duplicates; done only after NO_MATCH/OVERRIDDEN', () => {
    assert.equal(stepState({ duplicateStatus: 'POSSIBLE_DUPLICATE' }, 'review'), 'attention');
    assert.equal(stepState({ duplicateStatus: 'CONFIRMED_DUPLICATE' }, 'review'), 'attention');
    assert.equal(stepState({ duplicateStatus: 'NOT_CHECKED' }, 'review'), 'pending');
    assert.equal(stepState({ duplicateStatus: 'OVERRIDDEN' }, 'review'), 'done');
  });

  it('never marks the final review step done while an earlier step is not done', () => {
    assert.equal(stepState({ vendorNameSnapshot: null }, 'review'), 'pending');
    assert.equal(stepState({ taxEvidenceStatus: 'NEEDS_REVIEW' }, 'review'), 'pending');
  });

  it('marks a complete draft done on every step, outstanding AI flags included', () => {
    const steps = deriveExpenseReviewSteps({
      ...base,
      aiVerificationSummaryJson: { status: 'OCR_EXTRACTED_NEEDS_REVIEW', missingFields: ['expenseDate', 'amount'] },
    }, true);
    assert.deepEqual(steps.map((step) => step.state), ['done', 'done', 'done']);
  });
});

describe('initialExpenseReviewStep', () => {
  it('opens drafts at step 1 regardless of which steps are complete or pending', () => {
    assert.equal(initialFor({}), 'data');
    assert.equal(initialFor({ vendorNameSnapshot: null }), 'data');
    assert.equal(initialFor({ taxEvidenceStatus: 'NEEDS_REVIEW' }), 'data');
    assert.equal(initialFor({ duplicateStatus: 'NOT_CHECKED' }), 'data');
  });

  it('opens at step 1 when a later step needs action', () => {
    assert.equal(initialFor({ duplicateStatus: 'POSSIBLE_DUPLICATE' }), 'data');
  });

  it('opens a no-file draft at step 1', () => {
    assert.equal(initialFor({ attachments: [], aiVerificationSummaryJson: null }), 'data');
  });

  it('opens at step 1 regardless of expense status', () => {
    const steps = deriveExpenseReviewSteps({ ...base, vendorNameSnapshot: null }, true);
    assert.equal(initialExpenseReviewStep(steps, 'READY_FOR_CONFIRMATION'), 'data');
    assert.equal(initialExpenseReviewStep(steps, 'DRAFT'), 'data');
  });
});
