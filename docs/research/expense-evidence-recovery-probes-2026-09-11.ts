// Audit probes only: import current production helpers; no database/network calls or application edits.
// Run from repo root: apps/api/node_modules/.bin/tsx --tsconfig docs/research/expense-evidence-recovery-probes.tsconfig.json docs/research/expense-evidence-recovery-probes-2026-09-11.ts
import assert from 'node:assert/strict';
import { hasCurrentExpenseDocumentReview } from '../../packages/contracts/src/expenses';
import { collectSubstituteReceiptEligibilityIssues } from '../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case';
import { deriveTaxEvidence } from '../../apps/api/src/modules/expenses/domain/logic/expense-document.logic';
import { validateConfirm } from '../../apps/api/src/modules/expenses/domain/logic/expense-status.logic';
import { expenseEvidenceStepBlocker, expenseConfirmBlocker, expenseNeedsReceiptOrSubstitute, expenseSubstituteReceiptReady, expenseVatBlockedWayOut } from '../../apps/web/src/features/expenses/expenses.model';

const results: Array<{ id: string; outcome: 'GAP_REPRODUCED' | 'EXISTING_RULE_VERIFIED'; detail: string }> = [];
function record(id: string, outcome: 'GAP_REPRODUCED' | 'EXISTING_RULE_VERIFIED', detail: string, check: () => void) {
  check();
  results.push({ id, outcome, detail });
}
const expense: any = {
  status: 'NEEDS_REVIEW', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
  aiVerificationSummaryJson: null, currency: 'THB', grandTotalAmount: '680',
  lines: [{ description: 'รายการสำหรับทดสอบ', expenseCategoryId: 'synthetic-category' }],
  expenseCategoryId: 'synthetic-category', accountHintKey: null,
};
const issues = (changes: Record<string, unknown>, reason: any = 'PAYEE_CANNOT_ISSUE') =>
  collectSubstituteReceiptEligibilityIssues({ ...expense, ...changes }, reason).map(item => item.code);

record('P01', 'EXISTING_RULE_VERIFIED', 'A usable RECEIPT is routed to the normal path by the current prepare helper', () => {
  assert(issues({ sourceDocumentType: 'RECEIPT' }).includes('valid_receipt_normal_path'));
});
record('P02', 'GAP_REPRODUCED', 'ABBREVIATED_TAX_INVOICE lacks that same valid-receipt guard', () => {
  assert(!issues({ sourceDocumentType: 'ABBREVIATED_TAX_INVOICE' }).includes('valid_receipt_normal_path'));
});
record('P03', 'GAP_REPRODUCED', 'Complete handwritten facts still receive a needs-substitute reason', () => {
  assert.equal(deriveTaxEvidence({ sourceDocumentType: 'HANDWRITTEN_CASH_BILL', grandTotalAmount: '680', vendorName: 'ผู้ขายตัวอย่าง', documentNumber: 'TEST-1' }).taxEvidenceReasonCode, 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE');
});
record('P04', 'EXISTING_RULE_VERIFIED', 'Lost receipt exception is distinguished from having a usable receipt', () => {
  assert(!issues({ sourceDocumentType: 'RECEIPT' }, 'RECEIPT_UNAVAILABLE').includes('valid_receipt_normal_path'));
});
record('P05', 'EXISTING_RULE_VERIFIED', 'Unreviewed source, unknown tax and zero amount remain genuine prerequisites', () => {
  const errors = issues({ sourceDocumentType: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW', grandTotalAmount: '0' });
  for (const code of ['source_type_ineligible', 'tax_evidence_review_required', 'reviewed_total_required']) assert(errors.includes(code));
});
record('P06', 'EXISTING_RULE_VERIFIED', 'The current certificate flow is THB only: do not promise completion for unsupported currency', () => {
  assert(issues({ currency: 'USD' }).includes('currency_not_supported'));
});

const identity: any = { sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', expenseCategoryId: null, primaryAttachmentId: 'fixture-file-1', extractionId: 'fixture-extraction-1', vendorNameSnapshot: 'ผู้ขาย A', grandTotalAmount: '680' };
identity.aiVerificationSummaryJson = { documentReview: { version: 1, reviewedAt: '2026-09-11T00:00:00Z', reviewedByUserId: 'fixture-reviewer', sourceDocumentType: identity.sourceDocumentType, taxEvidenceStatus: identity.taxEvidenceStatus, expenseCategoryId: null, primaryAttachmentId: identity.primaryAttachmentId, extractionId: identity.extractionId } };
record('P07', 'EXISTING_RULE_VERIFIED', 'Unchanged saved review is current and replaced source identity invalidates it', () => {
  assert(hasCurrentExpenseDocumentReview(identity));
  assert(!hasCurrentExpenseDocumentReview({ ...identity, primaryAttachmentId: 'fixture-file-2' }));
});
record('P08', 'GAP_REPRODUCED', 'v1 review does not bind vendor or amount changes; broader v2 source binding is required', () => {
  assert(hasCurrentExpenseDocumentReview({ ...identity, vendorNameSnapshot: 'ผู้ขาย B', grandTotalAmount: '900' } as any));
});

const evidenceBase: any = { sourceDocumentType: 'TRANSFER_SLIP', missingReceiptReason: null, substituteReceiptGeneratedAt: null, substituteReceiptEvidence: null, attachments: [{ purpose: 'expense.review.evidence', status: 'ACTIVE' }] };
record('P09', 'GAP_REPRODUCED', 'A supporting-slot evidence set cannot satisfy current receipt-or-substitute routing', () => {
  assert(expenseNeedsReceiptOrSubstitute(evidenceBase));
});
record('P10', 'GAP_REPRODUCED', 'File purpose alone changes that answer even though the source remains TRANSFER_SLIP', () => {
  assert(!expenseNeedsReceiptOrSubstitute({ ...evidenceBase, attachments: [{ purpose: 'expense.receipt.primary', status: 'ACTIVE' }] }));
});
record('P11', 'GAP_REPRODUCED', 'A missing-receipt reason forces an issued certificate without an alternative-evidence route', () => {
  assert(!expenseSubstituteReceiptReady({ ...evidenceBase, missingReceiptReason: 'ต้นฉบับสูญหาย' }));
});
record('P12', 'EXISTING_RULE_VERIFIED', 'An issued certificate requires an artifact; the label ISSUED alone is insufficient', () => {
  const detail = { ...evidenceBase, missingReceiptReason: 'ต้นฉบับสูญหาย', substituteReceiptEvidence: { status: 'ISSUED', artifactAttachmentId: 'fixture-artifact' } };
  assert(expenseSubstituteReceiptReady(detail));
  assert(!expenseSubstituteReceiptReady({ ...detail, substituteReceiptEvidence: { status: 'ISSUED', artifactAttachmentId: null } }));
});

const confirm: any = { status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'NO_MATCH', primaryAttachmentId: null, missingReceiptReason: 'สูญหาย', hasLinkedClaimEvidence: false, hasMissingReceiptPermission: false, expenseDate: '2026-08-14', grandTotalAmount: '680', whtAmount: '0', aiVerifiedFieldsJson: null, aiVerificationSummaryJson: null };
record('P13', 'GAP_REPRODUCED', 'The no-primary domain guard demands finance permission again; it cannot consume a prior alternative-evidence acceptance', () => {
  assert.equal(validateConfirm(confirm), 'Finance permission required to confirm expense without receipt attachment.');
});
record('P14', 'GAP_REPRODUCED', 'The domain confirm validator itself does not require a review marker (not a claim that the complete confirm API succeeded)', () => {
  assert.equal(validateConfirm({ ...confirm, primaryAttachmentId: 'fixture-file', missingReceiptReason: null }), null);
});
record('P15', 'EXISTING_RULE_VERIFIED', 'Unsaved/current review uses one Next predicate; back/draft recovery must be supplied by the page', () => {
  const base = { checkBillBlocked: false, classificationBlocked: false, canReview: true, unsavedReview: false, reviewRequired: false };
  assert.equal(expenseEvidenceStepBlocker(base), null);
  assert.equal(expenseEvidenceStepBlocker({ ...base, unsavedReview: true }), 'expenses.doc_review_unsaved_next');
  assert.equal(expenseEvidenceStepBlocker({ ...base, reviewRequired: true }), 'expenses.doc_review_required_next');
});
record('P16', 'EXISTING_RULE_VERIFIED', 'A final-page subtitle may be clear while its blocker needs a separate actionable recovery target', () => {
  const base = { status: 'READY_FOR_CONFIRMATION', classificationBlocked: false, hasDuplicates: false, needsReceiptOrSubstitute: false, substituteReady: true, ocrTotalUnacknowledged: false, isZeroAmount: false };
  assert.equal(expenseConfirmBlocker(base), null);
  assert.deepEqual(expenseConfirmBlocker({ ...base, needsReceiptOrSubstitute: true }), { key: 'expenses.confirm_needs_receipt' });
  assert.deepEqual(expenseConfirmBlocker({ ...base, substituteReady: false }), { key: 'expenses.confirm_needs_substitute_signed' });
});
record('P17', 'EXISTING_RULE_VERIFIED', 'Existing VAT-difference recovery preserves confirmer permission and a route to set VAT first', () => {
  assert.equal(expenseVatBlockedWayOut({ canConfirm: true, vatCarrierLineCount: 1 }), 'OVERRIDE_FORM');
  assert.equal(expenseVatBlockedWayOut({ canConfirm: true, vatCarrierLineCount: 0 }), 'SET_VAT_RATE_FIRST');
  assert.equal(expenseVatBlockedWayOut({ canConfirm: false, vatCarrierLineCount: 1 }), 'NEEDS_CONFIRMER');
});
console.log(JSON.stringify({ kind: 'current-helper-evidence', assertionGroups: results.length, gapsReproduced: results.filter(item => item.outcome === 'GAP_REPRODUCED').length, limits: 'Synthetic helper inputs. No DB, final API confirmation, tax entitlement or new implementation is proven.', results }, null, 2));
