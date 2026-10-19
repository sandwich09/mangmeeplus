import * as evidence from './expense-evidence.js';
import { expenseEvidenceAssessment } from './expense-evidence.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expenseEvidenceInputError, expenseEvidenceFingerprint, hasCurrentExpenseEvidenceReview, expenseEvidenceConfirmationError, type ExpenseEvidenceAssessment, type ExpenseEvidenceSource } from './expense-evidence.js';

const source: ExpenseEvidenceSource = { sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', taxEvidenceStatus: 'SUPPORTING_ONLY',
  inputVatClaimStatus: 'NON_CLAIMABLE', vendorNameSnapshot: 'ร้านทดสอบ', expenseDate: new Date('2026-08-14T00:00:00Z'),
  grandTotalAmount: '680.0000', vatAmount: '44.4900', lines: [{ lineNumber: 1, description: 'สินค้า', lineTotalAmount: '680.0000' }],
  attachments: [{ id: 'receipt', status: 'ACTIVE', checksumSha256: 'image-v1' }],
};
const receipt: ExpenseEvidenceAssessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: ['receipt'], reason: '' };
function reviewed(input: ExpenseEvidenceSource, assessment = receipt): ExpenseEvidenceSource {
  return { ...input, aiVerificationSummaryJson: { ...input.aiVerificationSummaryJson, documentEvidenceDraft: assessment, documentReview: { version: 2,
    reviewedAt: '2026-09-11T00:00:00Z', reviewedByUserId: 'reviewer', assessment, fingerprint: expenseEvidenceFingerprint(input, assessment) } } };
}

test('reviewed abbreviated receipt and supporting-slot receipt use the source route, independently of primary slot', () => {
  const value = reviewed(source);
  assert(hasCurrentExpenseEvidenceReview(value));
  assert.equal(expenseEvidenceConfirmationError(value), null);
  assert(hasCurrentExpenseEvidenceReview({ ...value, primaryAttachmentId: 'different-unrelated-file' }));
});
test('partial save allows unresolved facts but never counts as reviewed', () => {
  const pending = { ...source, sourceDocumentType: 'NEEDS_REVIEW' as const, taxEvidenceStatus: 'NEEDS_REVIEW' as const };
  assert.equal(expenseEvidenceInputError(receipt, pending), null);
  assert(expenseEvidenceInputError(receipt, pending, true));
  assert(!hasCurrentExpenseEvidenceReview({ ...pending, aiVerificationSummaryJson: { documentEvidenceDraft: receipt } }));
});
test('alternative evidence requires scoped active files and a reason; it does not require an issued certificate', () => {
  const alternative: ExpenseEvidenceAssessment = { ...receipt, route: 'ALTERNATIVE_EVIDENCE', receiptProblem: 'NOT_AVAILABLE', reason: 'หลักฐานการชำระตรงกับผู้รับและรายการ' };
  const slip = { ...source, sourceDocumentType: 'TRANSFER_SLIP' as const };
  assert.equal(expenseEvidenceConfirmationError(reviewed(slip, alternative)), null);
  for (const bad of [{ ...alternative, reason: '' }, { ...alternative, attachmentIds: [] }, { ...alternative, attachmentIds: ['foreign-file'] }]) {
    assert(expenseEvidenceInputError(bad, slip, true));
  }
  assert(expenseEvidenceInputError(alternative, { ...slip, inputVatClaimStatus: 'CLAIMABLE' }, true));
});
test('zero-attachment cash certificate can be reviewed before prepare, but cannot confirm before issue', () => {
  const certificate: ExpenseEvidenceAssessment = { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: '' };
  const value = reviewed({ ...source, sourceDocumentType: 'EXPENSE_NOTE_TEXT', attachments: [] }, certificate);
  assert(hasCurrentExpenseEvidenceReview(value));
  assert(expenseEvidenceConfirmationError(value));
  assert.equal(expenseEvidenceConfirmationError({ ...value, substituteReceiptEvidence: { status: 'ISSUED', artifactAttachmentId: 'signed-artifact' } }), null);
});

test('cancelled certificates never authorize confirmation or send the reviewer back to sign cancelled history', () => {
  const certificate: ExpenseEvidenceAssessment = { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: 'ร้านไม่ออกใบเสร็จ' };
  // Expense detail excludes SUPERSEDED evidence; historical projections may still include it.
  for (const substituteReceiptEvidence of [null, { status: 'SUPERSEDED', artifactAttachmentId: 'old-artifact' }]) {
    const cancelled = { ...source, missingReceiptReason: certificate.reason, substituteReceiptGeneratedAt: null, substituteReceiptEvidence };
    assert.equal(expenseEvidenceConfirmationError(cancelled), 'กรุณาบันทึกการตรวจเอกสารและหลักฐานล่าสุดก่อนยืนยัน');
    assert.match(expenseEvidenceConfirmationError({ ...reviewed(cancelled, certificate), substituteReceiptEvidence })!, /เลือกหลักฐาน.*ฉบับใหม่/);
    assert.equal(expenseEvidenceConfirmationError({ ...reviewed(cancelled), substituteReceiptEvidence }), null);
    const alternative: ExpenseEvidenceAssessment = { ...certificate, route: 'ALTERNATIVE_EVIDENCE', attachmentIds: ['receipt'], reason: 'ตรวจหลักฐานการจ่ายและผู้รับแล้ว' };
    assert.equal(expenseEvidenceConfirmationError({ ...reviewed(cancelled, alternative), substituteReceiptEvidence }), null);
  }
  for (const status of ['PREPARED', 'PAYER_CERTIFIED']) {
    assert.equal(expenseEvidenceConfirmationError({ ...reviewed(source, certificate), substituteReceiptEvidence: { status } }),
      'เปิดใบรับรองฉบับเดิมและดำเนินการให้สมบูรณ์ก่อนยืนยัน');
  }
});
test('vendor, amount, selected evidence and route changes stale review; unrelated file/no-op do not', () => {
  const value = reviewed(source);
  for (const patch of [{ vendorNameSnapshot: 'different' }, { grandTotalAmount: '681' }, { attachments: [{ id: 'receipt', status: 'DELETED', checksumSha256: 'image-v1' }] },
    { attachments: [{ id: 'receipt', status: 'ACTIVE', checksumSha256: 'image-v2' }] }]) assert(!hasCurrentExpenseEvidenceReview({ ...value, ...patch }));
  assert(!hasCurrentExpenseEvidenceReview({ ...value, aiVerificationSummaryJson: { ...value.aiVerificationSummaryJson, documentEvidenceDraft: { ...receipt, reason: 'changed' } } }));
  assert(hasCurrentExpenseEvidenceReview({ ...value, grandTotalAmount: '680.00', expenseDate: '2026-08-14', attachments: [...source.attachments!, { id: 'other', status: 'ACTIVE' }] }));
});
test('API tax snapshot and JSON line projection have the same semantic fingerprint', () => {
  const api = { ...source, lines: [{ ...source.lines![0], taxSnapshot: { taxCodeDefinitionId: 'v7', externalTaxCode: 'V7' } }] };
  const web = { ...source, lines: [{ ...source.lines![0], taxCodeDefinitionId: 'v7', externalTaxCode: 'V7' }] };
  assert.equal(expenseEvidenceFingerprint(api as unknown as ExpenseEvidenceSource, receipt), expenseEvidenceFingerprint(web, receipt));
});
test('legacy marker and client-owned approval fields do not become a v2 human review', () => {
  assert(!hasCurrentExpenseEvidenceReview({ ...source, aiVerificationSummaryJson: { documentReview: { version: 1, reviewedByUserId: 'old' } } }));
  assert(expenseEvidenceInputError({ ...receipt, reviewedByUserId: 'attacker' }, source));
});

test('JSONB key ordering and selected-file ordering do not invalidate a saved review', () => {
  const value = reviewed(source);
  const assessment = { reason: '', attachmentIds: ['receipt'], receiptProblem: 'NONE' as const, route: 'SOURCE_DOCUMENT' as const };
  const review = value.aiVerificationSummaryJson!.documentReview as Record<string, unknown>;
  assert(hasCurrentExpenseEvidenceReview({ ...value, aiVerificationSummaryJson: {
    documentEvidenceDraft: assessment, documentReview: { ...review, assessment },
  } }));
});

test('a deleted or generated file cannot approve evidence; stored reason remains recoverable', () => {
  const value = reviewed(source);
  const deleted = { ...value, attachments: [{ id: 'receipt', status: 'DELETED' }] };
  assert(!hasCurrentExpenseEvidenceReview(deleted));
  assert.equal(expenseEvidenceAssessment(deleted)?.route, 'SOURCE_DOCUMENT');
  assert(expenseEvidenceInputError(receipt, { ...source, attachments: [{ id: 'receipt', status: 'ACTIVE', purpose: 'expense.review.evidence' }] }, true));
});

test('a new OCR request invalidates review even when the recognized money and vendor are unchanged', () => {
  const value = reviewed({ ...source, aiVerificationSummaryJson: { extractionRequestId: 'ocr-before', extractionAttachmentId: 'receipt' } });
  assert(hasCurrentExpenseEvidenceReview(value));
  const reread = { ...value, aiVerificationSummaryJson: { ...value.aiVerificationSummaryJson, extractionRequestId: 'ocr-after' } };
  assert(!hasCurrentExpenseEvidenceReview(reread));
  assert.deepEqual(expenseEvidenceAssessment(reread), receipt);
});

test('a VAT decision does not invalidate document evidence review, including its legacy fingerprint', () => {
  const value = reviewed({ ...source, sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX', inputVatClaimStatus: 'NEEDS_REVIEW' });
  assert(hasCurrentExpenseEvidenceReview({ ...value, inputVatClaimStatus: 'CLAIMABLE' }));
  const review = value.aiVerificationSummaryJson!.documentReview as any;
  const legacy = JSON.parse(review.fingerprint);
  if (legacy.fields.at(-1) !== 'NEEDS_REVIEW') legacy.fields.push('NEEDS_REVIEW');
  const old = { ...value, inputVatClaimStatus: 'CLAIMABLE' as const, aiVerificationSummaryJson: { ...value.aiVerificationSummaryJson,
    documentReview: { ...review, fingerprint: JSON.stringify(legacy) } } };
  assert(hasCurrentExpenseEvidenceReview(old));
  assert(!hasCurrentExpenseEvidenceReview({ ...old, vendorNameSnapshot: 'ร้านอื่น' }));
});

test('EVID-1 accepts an original paper without an image, keeps VAT answers and clears the image reminder only for selected active files', () => {
  const paper = { ...receipt, attachmentIds: [], originalDocumentAvailable: true, note: 'อยู่กับผู้ทำบัญชี' };
  const invoice = { ...source, sourceDocumentType: 'TAX_INVOICE' as const, taxEvidenceStatus: 'USABLE_FOR_TAX' as const, inputVatClaimStatus: 'CLAIMABLE', attachments: [] };
  assert.equal(expenseEvidenceInputError(paper, invoice, true), null);
  assert.equal(expenseEvidenceConfirmationError(reviewed(invoice, paper)), null);
  assert.equal(evidence.expenseEvidenceImageMissing(reviewed(invoice, paper)), true);
  assert(expenseEvidenceInputError({ ...paper, originalDocumentAvailable: false }, invoice, true));
  assert(expenseEvidenceInputError(paper, { ...invoice, sourceDocumentType: 'NEEDS_REVIEW' }, true));
  assert(expenseEvidenceInputError(paper, { ...invoice, taxEvidenceStatus: 'NEEDS_REVIEW' }, true));
  const withFile = { ...invoice, attachments: source.attachments };
  assert.equal(evidence.expenseEvidenceImageMissing(reviewed(withFile, paper)), true);
  const selected = { ...paper, attachmentIds: ['receipt'] };
  assert.equal(expenseEvidenceInputError(selected, withFile, true), null);
  assert.equal(evidence.expenseEvidenceImageMissing(reviewed(withFile, selected)), false);
  assert(expenseEvidenceInputError({ ...selected, attachmentIds: ['foreign'] }, withFile, true));
  assert(expenseEvidenceInputError(selected, { ...invoice, attachments: [{ id: 'receipt', status: 'DELETED' }] }, true));
});
test('EVID-1 strictly validates the original-paper flag and 500-character note without bypassing other evidence routes', () => {
  const paper = { ...receipt, attachmentIds: [], originalDocumentAvailable: true, note: 'ก'.repeat(500) };
  assert.equal(expenseEvidenceInputError(paper, source, true), null);
  for (const bad of [{ ...paper, note: 'ก'.repeat(501) }, { ...paper, note: null }, { ...paper, originalDocumentAvailable: 'true' }, { ...paper, location: 'ร้าน' },
    { ...paper, route: 'ALTERNATIVE_EVIDENCE', receiptProblem: 'LOST' }, { ...paper, route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE' }]) assert(expenseEvidenceInputError(bad, source));
  const old = reviewed(source);
  assert(hasCurrentExpenseEvidenceReview(old), 'existing fingerprints remain valid');
  const saved = reviewed({ ...source, attachments: [] }, paper);
  assert(hasCurrentExpenseEvidenceReview(saved));
  assert(!hasCurrentExpenseEvidenceReview({ ...saved, aiVerificationSummaryJson: { ...saved.aiVerificationSummaryJson, documentEvidenceDraft: { ...paper, note: 'เปลี่ยนที่เก็บ' } } }));
});
