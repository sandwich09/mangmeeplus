import * as expenseModel from './expenses.model';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockingExpenseVatReconciliation, type ExpenseVatCaptureSnapshotV1 } from '@watchdog-bms/contracts';
import {
  postingErrorText,
  expensePaymentAttempt,
  classifyExpensePaymentFailure,
  buildExpenseDraftReviewPayload,
  reviewValues,
  formatTaxId,
  taxIdDigits,
  aiGrandTotalValue,
  expenseSubstituteReceiptAction,
  substituteReceiptPreparationHref,
  deriveExpenseClassificationReviewState,
  expenseAiFieldProvenance,
  expenseAiMissingFields,
  expenseDocumentDateStatus,
  expenseDateIsReadable,
  expenseAiSuggestion,
  expenseAiCategorySuggestion,
  applyExpenseAiSuggestion,
  expenseRatePercent,
  expenseDocumentWhtRate,
  hasAcknowledgedAiTotalMismatch,
  hasAiGrandTotalMismatch,
  needsAiTotalAcknowledgement,
  canRunExpenseDuplicateCheck,
  hasUnresolvedDuplicateWarning,
  isBlockedCheckBillClassification,
  findOpaqueBounds,
  removeLightBackground,
  allowsDomesticInputTaxCode,
  clearExpenseTaxSelections,
  calculateManualExpenseTotals,
  buildManualExpenseLines,
  vatRateFromPrintedAmount,
  vatRatePreset,
  vatRatePresetValue,
  vatTreatmentForPreset,
  expensePercentToRate,
  expenseRateToPercent,
  effectiveVatRateLabel,
  TAX_EVIDENCE_REASON_LABELS,
  AI_SUMMARY_STATUS_LABELS,
  AI_MISSING_FIELD_LABELS,
  AI_REVIEW_FIELD_KEYS,
  ATTACHMENT_PURPOSE_LABELS,
  isWetSignedScanAttachment,
  SUBSTITUTE_RECEIPT_STATUS_LABELS,
  expenseValueLabel,
  expenseCapabilities,
  canExportExpenseList,
  isFreeExpenseListDraft,
  expenseUiPermissions,
  expenseSourceDraftViewState,
  canDeleteExpense,
  canCancelExpenseInsteadOfDelete,
  canAccessExpenseTab,
  expenseDeleteErrorMessage,
  canCorrectWhtCertificate,
  canIssueWhtReplacementCopy,
  expenseDeleteTargetLabel,
  isExpensePending,
  summarizeExpenseKpis,
  lateDocumentDays,
  expenseVatSourceFromSnapshot,
  expenseVatSourceValidationMessage,
  changeExpenseVatSourceType,
  insertExpenseReviewLine,
  type ExpenseDraftReviewValues,
  type ExpenseDetail,
} from './expenses.model';

describe('expenses.model', () => {
  it('issued receipt facts fill an empty quick-expense source without replacing entered facts', () => {
    const detail = { status: 'NEEDS_REVIEW', expenseDate: '2026-10-19', vendorNameSnapshot: 'แม่ค้าผักทดสอบ', note: 'วัตถุประสงค์: ทดสอบระบบ', lines: [],
      sourceDraft: { header: { vendorName: null, businessPurpose: null }, items: [] },
      substituteReceiptEvidence: { status: 'ISSUED', payeeName: 'แม่ค้าผักทดสอบ', businessPurpose: 'ทดสอบระบบ' } } as unknown as ExpenseDetail;
    const values = reviewValues(detail);
    assert.equal(values.vendorNameSnapshot, 'แม่ค้าผักทดสอบ');
    assert.equal(values.businessPurpose, 'ทดสอบระบบ');
    const payload = buildExpenseDraftReviewPayload(values, { sourceDraft: detail.sourceDraft, partial: true });
    assert.equal(payload.sourceDraft?.vendorName, 'แม่ค้าผักทดสอบ');
    assert.equal(payload.sourceDraft?.businessPurpose, 'ทดสอบระบบ');
    assert.equal(payload.note, detail.note);
    const entered = reviewValues({ ...detail, sourceDraft: { ...detail.sourceDraft!, header: { ...detail.sourceDraft!.header, vendorName: 'ผู้ขายที่แก้', businessPurpose: 'ใช้จัดงาน' } } });
    assert.equal(entered.vendorNameSnapshot, 'ผู้ขายที่แก้'); assert.equal(entered.businessPurpose, 'ใช้จัดงาน');
  });

  it('prefills shared purpose on linked manual receipts and preserves legacy notes on unchanged saves', () => {
    const detail = { status: 'NEEDS_REVIEW', expenseDate: '2026-08-14', vendorNameSnapshot: 'ร้าน ก',
      note: 'ใช้ในสำนักงาน', lines: [], substituteReceiptEvidence: { businessPurpose: 'ใช้ในสำนักงาน' } } as unknown as ExpenseDetail;
    const values = reviewValues(detail);
    assert.equal(values.businessPurpose, 'ใช้ในสำนักงาน');
    assert.equal(buildExpenseDraftReviewPayload(values).note, undefined);
    assert.equal(buildExpenseDraftReviewPayload({ ...values, businessPurpose: 'ใช้จัดประชุม' }).note, 'วัตถุประสงค์: ใช้จัดประชุม');
    assert.equal(buildExpenseDraftReviewPayload({ ...values, businessPurpose: '' }).note, '');
    const reviewed = reviewValues({ ...detail, note: `อัปโหลด · วัตถุประสงค์: ${'ก'.repeat(500)}` });
    assert.equal(reviewed.businessPurpose, 'ก'.repeat(500));
    assert.equal(buildExpenseDraftReviewPayload(reviewed).note, undefined);
    assert.equal(buildExpenseDraftReviewPayload({ ...reviewed, businessPurpose: 'ใหม่' }).note, 'อัปโหลด · วัตถุประสงค์: ใหม่');
  });

  it('does not restore a stale certificate purpose when the source explicitly cleared it', () => {
    const detail = { status: 'NEEDS_REVIEW', expenseDate: '2026-08-14', lines: [],
      note: 'วัตถุประสงค์: เก่า', substituteReceiptEvidence: { businessPurpose: 'เก่า' },
      sourceDraft: { header: { businessPurpose: null, expenseDate: '2026-08-14' }, items: [] } } as unknown as ExpenseDetail;
    const values = reviewValues(detail);
    assert.equal(values.businessPurpose, '');
    const payload = buildExpenseDraftReviewPayload(values, { sourceDraft: detail.sourceDraft, partial: true });
    assert.equal(payload.note, undefined);
    assert.equal(payload.sourceDraft?.businessPurpose, undefined);
  });

  it('treats a first definitive client refusal as rejected, not an uncertain payment', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      assert.equal(classifyExpensePaymentFailure({ status }, false), 'definitive');
      assert.equal(classifyExpensePaymentFailure({ statusCode: status }, false), 'definitive');
    }
    assert.equal(classifyExpensePaymentFailure({ details: { statusCode: 422 } }, false), 'definitive');
  });

  it('retains ambiguity for network, timeout, server, and missing-status failures', () => {
    for (const failure of [new Error('network'), { kind: 'network_error' }, { status: 408 }, { statusCode: 500 }, { status: 504 }, {}, null, undefined]) {
      assert.equal(classifyExpensePaymentFailure(failure, false), 'uncertain');
    }
  });

  it('does not clear a network-uncertain intent when a later retry is forbidden or otherwise refused', () => {
    const input = { paidAmount: '40.00', paymentMethod: 'CASH' as const, paidAt: '2026-07-31' };
    const first = expensePaymentAttempt(null, 'company-1', 'expense-1', input, () => 'same-intent');
    const initial = classifyExpensePaymentFailure(new Error('lost response'), false);
    for (const status of [400, 403, 404, 409, 422]) {
      assert.equal(classifyExpensePaymentFailure({ status }, initial === 'uncertain'), 'uncertain');
    }
    assert.equal(expensePaymentAttempt(first, 'company-1', 'expense-1', input, () => { throw new Error('must keep key'); }), first);
  });

  it('keeps an idempotency conflict distinct from both rejection and a same-key retryable outcome', () => {
    for (const hadUncertain of [false, true]) {
      assert.equal(classifyExpensePaymentFailure({ status: 409, code: 'expense_payment_idempotency_conflict' }, hadUncertain), 'conflict');
      assert.equal(classifyExpensePaymentFailure({ details: { statusCode: 409, code: 'expense_payment_idempotency_conflict' } }, hadUncertain), 'conflict');
    }
  });

  it('starts fresh failure history after an explicit edit or confirmed success resets the intent', () => {
    const input = { paidAmount: '40.00', paidAt: '2026-07-31' };
    const original = expensePaymentAttempt(null, 'company-1', 'expense-1', input, () => 'old-intent');
    assert.equal(classifyExpensePaymentFailure({ status: 500 }, false), 'uncertain');
    for (const resetAfter of ['success', 'edit'] as const) {
      const fresh = expensePaymentAttempt(null, 'company-1', 'expense-1', input, () => `after-${resetAfter}`);
      assert.notEqual(fresh.payload.idempotencyKey, original.payload.idempotencyKey);
      assert.equal(classifyExpensePaymentFailure({ status: 400 }, false), 'definitive');
    }
  });

  it('retains the same payment intent and exact selected civil date on uncertain retries', () => {
    let keys = 0;
    const createKey = () => `intent-${++keys}`;
    const input = { paidAmount: '40.00', paymentMethod: 'CASH' as const, paidAt: '2026-07-31' };
    const first = expensePaymentAttempt(null, 'company-1', 'expense-1', input, createKey);
    const retry = expensePaymentAttempt(first, 'company-1', 'expense-1', { ...input }, createKey);
    assert.equal(retry, first);
    assert.equal(retry.payload.paidAt, '2026-07-31');
    assert.equal(keys, 1);
    input.paidAt = '2026-08-01';
    assert.equal(first.payload.paidAt, '2026-07-31', 'the original wire body is a snapshot, not a reference to edited values');
  });

  it('uses a new intent for any deliberate edit, new target, or confirmed second payment', () => {
    let keys = 0;
    const createKey = () => `intent-${++keys}`;
    const input = { paidAmount: '40.00', paymentMethod: 'CASH' as const, paidAt: '2026-07-31' };
    const first = expensePaymentAttempt(null, 'company-1', 'expense-1', input, createKey);
    for (const edited of [{ ...input, paidAmount: '40.01' }, { ...input, paidAt: '2026-08-01' }, { ...input, paymentMethod: 'BANK_TRANSFER' as const }, { ...input, bankAccountRef: 'BANK-1' }]) {
      assert.notEqual(expensePaymentAttempt(first, 'company-1', 'expense-1', edited, createKey).payload.idempotencyKey, first.payload.idempotencyKey);
    }
    assert.notEqual(expensePaymentAttempt(first, 'company-2', 'expense-1', input, createKey).payload.idempotencyKey, first.payload.idempotencyKey);
    assert.notEqual(expensePaymentAttempt(first, 'company-1', 'expense-2', input, createKey).payload.idempotencyKey, first.payload.idempotencyKey);
    assert.notEqual(expensePaymentAttempt(null, 'company-1', 'expense-1', input, createKey).payload.idempotencyKey, first.payload.idempotencyKey);
  });

  it('marks a document as backdated only when its Bangkok intake date is in a later month', () => {
    assert.equal(lateDocumentDays({ expenseDate: '2026-06-30', uploadedAt: '2026-08-20T10:00:00.000Z' }), 51);
    assert.equal(lateDocumentDays({ expenseDate: '2026-07-31', uploadedAt: '2026-07-31T18:00:00.000Z' }), 1);
    assert.equal(lateDocumentDays({ expenseDate: '2026-08-01', uploadedAt: '2026-08-31T10:00:00.000Z' }), null);
    assert.equal(lateDocumentDays({ expenseDate: '2026-08-20', uploadedAt: '2026-08-01T10:00:00.000Z' }), null);
    assert.equal(lateDocumentDays({ expenseDate: 'not-a-date', uploadedAt: '2026-08-20T10:00:00.000Z' }), null);
    assert.equal(lateDocumentDays({ expenseDate: '2026-06-30', uploadedAt: 'not-an-instant' }), null);
  });

  it('turns internal expense codes into meaningful Thai labels', () => {
    assert.equal(expenseValueLabel(TAX_EVIDENCE_REASON_LABELS, 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE'), 'หลักฐานประกอบการจ่าย ตรวจข้อมูลและเลือกหลักฐานให้ตรงกับรายการ');
    assert.equal(expenseValueLabel(AI_SUMMARY_STATUS_LABELS, 'TEXT_NOTE_SEMANTIC_CAPTURE'), 'อ่านข้อมูลจากโน้ตข้อความแล้ว รอตรวจสอบ');
    assert.equal(expenseValueLabel(AI_MISSING_FIELD_LABELS, 'receipt_evidence'), 'หลักฐานใบเสร็จหรือหลักฐานประกอบ');
    assert.equal(expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, 'expense.payment.evidence'), 'หลักฐานการจ่ายเงิน');
    // R11: the hand-signed scan shares expense.review.evidence with system-rendered artifacts, so
    // the purpose alone would call a photograph of real ink "เอกสารที่ผ่านการตรวจ".
    assert.equal(isWetSignedScanAttachment('att-scan', { wetSignedScanAttachmentId: 'att-scan' }), true);
    assert.equal(isWetSignedScanAttachment('att-other', { wetSignedScanAttachmentId: 'att-scan' }), false);
    assert.equal(isWetSignedScanAttachment('att-scan', { wetSignedScanAttachmentId: null }), false);
    assert.equal(isWetSignedScanAttachment('att-scan', null), false);
    assert.equal(expenseValueLabel(SUBSTITUTE_RECEIPT_STATUS_LABELS, 'PAYER_CERTIFIED'), 'รออนุมัติ');
    assert.equal(expenseValueLabel({}, 'NEW_INTERNAL_CODE', 'ข้อมูลที่ต้องตรวจเพิ่ม'), 'ข้อมูลที่ต้องตรวจเพิ่ม');
  });

  it('clears a manually selected Tax Code when the document changes to a receipt', () => {
    const selectedLines = [{
      description: 'อาหาร', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '0.07', whtRate: null,
      expenseCategoryId: null, accountHintKey: null, taxCategory: 'INPUT_VAT',
      taxCodeDefinitionId: 'tax-o7', externalTaxCode: 'O7', transactionContext: 'DOMESTIC_PURCHASE' as const,
    }];

    assert.equal(allowsDomesticInputTaxCode('TAX_INVOICE', 'USABLE_FOR_TAX'), true);
    assert.equal(allowsDomesticInputTaxCode('RECEIPT', 'USABLE_FOR_TAX'), false);
    assert.equal(allowsDomesticInputTaxCode('TAX_INVOICE', 'SUPPORTING_ONLY'), false);
    // Spec §19c: claimability clears the Tax Code, never the document's printed VAT rate.
    assert.deepEqual(clearExpenseTaxSelections(selectedLines), [{
      ...selectedLines[0], vatRate: '0.07', taxCodeDefinitionId: null, externalTaxCode: null,
    }]);
  });

  it('blocks confirmation while duplicate warning is unresolved', () => {
    assert.equal(hasUnresolvedDuplicateWarning('POSSIBLE_DUPLICATE'), true);
    assert.equal(hasUnresolvedDuplicateWarning('CONFIRMED_DUPLICATE'), true);
    assert.equal(hasUnresolvedDuplicateWarning('NO_MATCH'), false);
    assert.equal(hasUnresolvedDuplicateWarning('OVERRIDDEN'), false);
  });

  it('offers duplicate checks only before an expense reaches a terminal status', () => {
    for (const status of ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as const) {
      assert.equal(canRunExpenseDuplicateCheck(status), true);
    }
    for (const status of ['CONFIRMED', 'REJECTED', 'VOIDED'] as const) {
      assert.equal(canRunExpenseDuplicateCheck(status), false);
    }
  });

  it('derives one bill-level WHT rate without overwriting mixed historical lines', () => {
    assert.equal(expenseDocumentWhtRate([]), '');
    assert.equal(expenseDocumentWhtRate([{ whtRate: null }, { whtRate: null }]), '');
    assert.equal(expenseDocumentWhtRate([{ whtRate: '0.03' }, { whtRate: ' 0.03 ' }]), '0.03');
    assert.equal(expenseDocumentWhtRate([{ whtRate: '0.03' }, { whtRate: null }]), null);
  });

  it('keeps non-expense manual uploads blocked and exposes override only to finance reviewers', () => {
    const unresolved = { status: 'NOT_EXPENSE_DOCUMENT', classification: { documentKind: 'QUOTATION' } };
    assert.deepEqual(deriveExpenseClassificationReviewState(unresolved, false), {
      blocked: true,
      showFinanceOverride: false,
      showWaitingForFinance: true,
    });
    assert.deepEqual(deriveExpenseClassificationReviewState(unresolved, true), {
      blocked: true,
      showFinanceOverride: true,
      showWaitingForFinance: false,
    });
    assert.deepEqual(deriveExpenseClassificationReviewState({
      ...unresolved,
      classificationResolution: {
        outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE',
        acknowledged: true,
        reason: 'Verified against the final supplier bill.',
        sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
        resolvedByUserId: 'finance-1',
        resolvedAt: '2026-07-13T10:00:00.000Z',
      },
    }, true), {
      blocked: false,
      showFinanceOverride: false,
      showWaitingForFinance: false,
    });
  });

  it('routes an unresolved check bill to guidance and never exposes inline substitute preparation', () => {
    const checkBill = {
      status: 'NOT_EXPENSE_DOCUMENT',
      classification: { documentKind: 'ORDER_OR_CHECK_BILL' },
    };
    assert.equal(isBlockedCheckBillClassification(checkBill), true);
    assert.equal(isBlockedCheckBillClassification({
      ...checkBill,
      classification: { documentKind: 'RECEIPT' },
    }), false);
    const overridden = { ...checkBill, classificationResolution: {
      outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE', sourceDocumentType: 'RECEIPT', reason: 'checked original',
      acknowledged: true, resolvedByUserId: 'finance-1', resolvedAt: '2026-08-27T00:00:00.000Z',
    } };
    assert.equal(isBlockedCheckBillClassification(overridden), false, 'genuine finance correction remains available for normal receipt review');
    assert.equal(substituteReceiptPreparationHref('co/1', 'exp 1', overridden),
      '/companies/co%2F1/expenses/substitute-receipts/new?expenseId=exp%201&route=check-bill');
    assert.equal(substituteReceiptPreparationHref('co1', 'exp1', { classification: { documentKind: 'RECEIPT' } }),
      '/companies/co1/expenses/substitute-receipts/new?expenseId=exp1');
  });

  it('opens the existing substitute receipt through every active status and only starts new after cancellation', () => {
    for (const status of ['PREPARED', 'PAYER_CERTIFIED', 'ISSUED'] as const) {
      assert.deepEqual(expenseSubstituteReceiptAction('co/1', 'exp 1', null, { id: 'src/1', status }), {
        href: '/companies/co%2F1/expenses/substitute-receipts/src%2F1',
        labelKey: status === 'ISSUED' ? 'expenses.substitute_hub.open_document' : 'expenses.substitute_hub.continue',
      });
    }
    for (const evidence of [null, undefined, { id: 'old', status: 'SUPERSEDED' as const }]) {
      assert.deepEqual(expenseSubstituteReceiptAction('co/1', 'exp 1', null, evidence), {
        href: '/companies/co%2F1/expenses/substitute-receipts/new?expenseId=exp%201',
        labelKey: 'expenses.no_receipt_start_substitute',
      });
      assert.equal(expenseSubstituteReceiptAction('co1', 'exp1', {
        classification: { documentKind: 'ORDER_OR_CHECK_BILL' },
      }, evidence).href, '/companies/co1/expenses/substitute-receipts/new?expenseId=exp1&route=check-bill');
    }
  });

  it('warns only when the AI and server grand totals differ by more than the reconciliation tolerance', () => {
    assert.equal(aiGrandTotalValue({ grandTotalAmount: 1000 }), '1000');
    assert.equal(aiGrandTotalValue({ grandTotalAmount: '' }), null);
    assert.equal(hasAiGrandTotalMismatch({ grandTotalAmount: '1,000.00' }, '1000.0000'), false);
    assert.equal(hasAiGrandTotalMismatch({ grandTotalAmount: '1000.05' }, '1000.0000'), false);
    assert.equal(hasAiGrandTotalMismatch({ grandTotalAmount: '1000.0501' }, '1000.0000'), true);
    assert.equal(hasAiGrandTotalMismatch({ grandTotalAmount: 'not-a-number' }, '1000.0000'), false);
    assert.equal(hasAiGrandTotalMismatch(null, '1000.0000'), false);
  });

  // Mirrors the server gate: acceptance is bound to the accepted figure, so re-editing the total
  // brings the block back. A bare "finance saved this" signal could never expire that way.
  it('clears the OCR total block only for the exact amount Finance accepted', () => {
    const detail = { aiVerifiedFieldsJson: { grandTotalAmount: '1200.00' }, grandTotalAmount: '1177.0000' };
    const accepted = { totalMismatchResolution: { acknowledged: true, acknowledgedTotalAmount: '1177.00' } };

    assert.equal(needsAiTotalAcknowledgement({ ...detail, aiVerificationSummaryJson: null }), true);
    assert.equal(needsAiTotalAcknowledgement({ ...detail, aiVerificationSummaryJson: accepted }), false);
    assert.equal(needsAiTotalAcknowledgement({ ...detail, grandTotalAmount: '1099.0000', aiVerificationSummaryJson: accepted }), true);

    assert.equal(hasAcknowledgedAiTotalMismatch({ totalMismatchResolution: { acknowledged: false, acknowledgedTotalAmount: '1177.00' } }, '1177.00'), false);
    assert.equal(hasAcknowledgedAiTotalMismatch({ totalMismatchResolution: { acknowledged: true } }, '1177.00'), false);
    assert.equal(hasAcknowledgedAiTotalMismatch({ totalMismatchResolution: 'yes' }, '1177.00'), false);
    assert.equal(hasAcknowledgedAiTotalMismatch(null, '1177.00'), false);
  });

  it('maps AI summary aliases to review fields and keeps manual expenses unmarked', () => {
    // Every producer writes `recognizedFields` as the ReceiptOcrFieldResult OBJECT; the legacy
    // string[] shape is still read so nothing stored before this fix goes dark.
    const summary = {
      recognizedFields: { vendorName: 'ร้านกาแฟ', amount: '65.00', vatAmount: '4.20', documentNumber: '' },
      missingFields: ['vendorTaxId', 'category'],
    };
    assert.deepEqual(expenseAiFieldProvenance(
      { recognizedFields: ['vendorName', 'amount', 'vatAmount'], missingFields: [] },
      'vendorNameSnapshot',
    ), { recognized: true, missing: false }, 'the legacy array shape still reads');
    assert.deepEqual(expenseAiFieldProvenance(summary, 'vendorDocumentNumber'), { recognized: false, missing: false },
      'a key the OCR left empty was not a reading');
    assert.deepEqual(expenseAiFieldProvenance(summary, 'vendorNameSnapshot'), { recognized: true, missing: false });
    assert.deepEqual(expenseAiFieldProvenance(summary, 'total'), { recognized: true, missing: false });
    assert.deepEqual(expenseAiFieldProvenance(summary, 'vendorTaxIdSnapshot'), { recognized: false, missing: true });
    assert.deepEqual(expenseAiFieldProvenance(summary, 'category'), { recognized: false, missing: true });
    assert.equal(expenseAiFieldProvenance(null, 'vendorNameSnapshot'), null);
  });

  /**
   * Vendor address spec §7 (D3 step two) and CON-8. The OCR does not emit `vendorAddress` yet, so
   * what this pins is the wiring it will land on: the alias is registered under the snapshot field,
   * and the blank branch code the form starts out with reaches the API as null — not as `'00000'`,
   * which is a head-office code a person may really type and which the vendor matcher reads as one.
   */
  it('registers the seller address as an AI-read field and never invents a branch code', () => {
    assert.deepEqual([...AI_REVIEW_FIELD_KEYS.vendorAddressSnapshot], ['vendorAddress']);
    assert.deepEqual(
      expenseAiFieldProvenance({ recognizedFields: { vendorAddress: '99/1 ถ.สุขุมวิท' }, missingFields: [] }, 'vendorAddressSnapshot'),
      { recognized: true, missing: false },
    );
    assert.deepEqual(
      expenseAiFieldProvenance({ recognizedFields: {}, missingFields: ['vendorAddress'] }, 'vendorAddressSnapshot'),
      { recognized: false, missing: true },
    );

    const detail = { status: 'NEEDS_REVIEW', expenseDate: '2026-09-18', lines: [],
      vendorAddressSnapshot: ' 99/1 ถ.สุขุมวิท กรุงเทพฯ ', vendorBranchCodeSnapshot: null } as unknown as ExpenseDetail;
    const values = reviewValues(detail);
    assert.equal(values.vendorBranchCodeSnapshot, '');
    const payload = buildExpenseDraftReviewPayload(values);
    assert.equal(payload.vendorAddressSnapshot, '99/1 ถ.สุขุมวิท กรุงเทพฯ');
    assert.equal(payload.vendorBranchCodeSnapshot, null, 'blank stays blank — never the string 00000');
    assert.equal(buildExpenseDraftReviewPayload({ ...values, vendorBranchCodeSnapshot: '00001' }).vendorBranchCodeSnapshot, '00001');
    assert.equal(buildExpenseDraftReviewPayload({ ...values, vendorAddressSnapshot: '   ' }).vendorAddressSnapshot, null);
  });

  // Spec `line-ai-draft-control-spec-th.md` §5.2(ง). The date column is NOT NULL, so an unread date
  // still stores the upload day — a value every non-empty check passes. The server now flags it in
  // `missingFields`, and this is the chain that turns that flag into "ต้องกรอกเอง: วันที่รายจ่าย" on
  // the review page. No new web mechanism: the flag reuses the one the page already reads.
  it('shows an unverified expense date as a field the reviewer must confirm', () => {
    const summary = { recognizedFields: {}, missingFields: ['expenseDate', 'category'], dateStatus: 'unverified' };
    assert.deepEqual(expenseAiFieldProvenance(summary, 'expenseDate'), { recognized: false, missing: true });
    assert.ok(expenseAiMissingFields(summary, 'data').includes('expenseDate'), 'and it belongs to the data step, not evidence');
    assert.equal(AI_MISSING_FIELD_LABELS['expenseDate'], 'วันที่รายจ่าย');

    const verified = { recognizedFields: {}, missingFields: ['category'] };
    assert.deepEqual(expenseAiMissingFields(verified, 'data'), [], 'a date read off the document raises nothing');
  });

  // Spec §5.2: four states, and every surface reads them from here.
  it('reports what the stored document date actually is', () => {
    assert.equal(expenseDocumentDateStatus({ dateStatus: 'assumed' }), 'assumed');
    assert.equal(expenseDocumentDateStatus({ dateStatus: 'implausible' }), 'implausible');
    assert.equal(expenseDocumentDateStatus({ missingFields: ['expenseDate'] }), 'unverified', 'pre-§5.2 rows fall back to the flag');
    assert.equal(expenseDocumentDateStatus({ missingFields: ['category'] }), 'verified');
    assert.equal(expenseDocumentDateStatus(null), 'verified', 'a manual entry is a date a person typed');
    assert.equal(expenseDocumentDateStatus({ dateStatus: 'nonsense' }), 'verified', 'an unknown value is not a warning');

    assert.equal(expenseDateIsReadable({ dateStatus: 'assumed' }), true, 'read off the bill IS read');
    assert.equal(expenseDateIsReadable({ dateStatus: 'unverified' }), false);
    assert.equal(expenseDateIsReadable({ dateStatus: 'implausible' }), false);
  });

  it('formats fraction rates as a display-only percentage with at most two decimals', () => {
    assert.equal(expenseRatePercent('0.07'), '7');
    assert.equal(expenseRatePercent('0.07555'), '7.56');
    assert.equal(expenseRatePercent('0'), null);
    assert.equal(expenseRatePercent('abc'), null);
  });

  it('rounds manual line components before VAT and total, as the server does', () => {
    assert.deepEqual(calculateManualExpenseTotals({ quantity: '1', unitPrice: '100.074', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' }), {
      subtotal: 100.07, vat: 7, grandTotal: 107.07,
    });
    assert.deepEqual(calculateManualExpenseTotals({ quantity: '1', unitPrice: '100.074', discountAmount: '0.015', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' }), {
      subtotal: 100.05, vat: 7, grandTotal: 107.05,
    });
    assert.deepEqual(calculateManualExpenseTotals({ quantity: '1', unitPrice: '0.075', vatRate: '1', vatMode: 'VAT_INCLUDED' }), {
      subtotal: 0.04, vat: 0.04, grandTotal: 0.08,
    });
  });

  it('calculates manual-entry VAT and totals from the selected tax mode', () => {
    const fuel = calculateManualExpenseTotals({ quantity: '61.488', unitPrice: '39.19', discountAmount: '0', vatRate: '0.07', vatMode: 'VAT_INCLUDED' });
    assert.deepEqual(fuel, { subtotal: 2252.07, vat: 157.64, grandTotal: 2409.71 });
    assert.equal(Math.round(fuel.subtotal * 0.07 * 100) / 100, 157.64,
      'an EXCLUSIVE Tax Code must receive the net base, not the VAT-inclusive price');
    assert.deepEqual(calculateManualExpenseTotals({ quantity: '1', unitPrice: '195', discountAmount: '15', vatRate: '0.07', vatMode: 'VAT_INCLUDED' }), {
      subtotal: 168.22, vat: 11.78, grandTotal: 180,
    });
    assert.deepEqual(calculateManualExpenseTotals({ quantity: '2', unitPrice: '100', vatMode: 'NO_VAT' }), {
      subtotal: 200, vat: 0, grandTotal: 200,
    });
    assert.deepEqual(calculateManualExpenseTotals({ quantity: '2', unitPrice: '100', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' }), {
      subtotal: 200, vat: 14, grandTotal: 214,
    });
    const inclusive = calculateManualExpenseTotals({ quantity: '1', unitPrice: '107', vatRate: '0.07', vatMode: 'VAT_INCLUDED' });
    assert.equal(inclusive.subtotal, 100);
    assert.equal(inclusive.vat, 7);
    assert.equal(inclusive.grandTotal, 107);
    // The reported Starbucks ABB slip typed by hand, in the shape the manual panel feeds the helper:
    // Sub Total 195 − Total Discount 15 priced as one unit. The printed gross must survive the split
    // to the satang the slip prints ("Net TTL 168.22" / "11.78 VAT TTL" / 180.00) — unlike 107, which
    // divides exactly and so never exercises the rounding.
    const afterDiscount = Math.max(0, 1 * 195 - 15);
    assert.deepEqual(calculateManualExpenseTotals({ quantity: '1', unitPrice: afterDiscount, vatRate: '0.07', vatMode: 'VAT_INCLUDED' }), {
      subtotal: 168.22, vat: 11.78, grandTotal: 180,
    });
  });

  it('gives a manually typed service charge its own line, like the OCR path', () => {
    const bill = {
      items: [{ description: ' ค่าอาหาร ', quantity: '1', unitPrice: '1000', discountAmount: '0' }],
      serviceChargeDescription: 'ค่าบริการ (Service charge)',
      vatRate: '0.07', taxCodeDefinitionId: 'tax-def-1', externalTaxCode: 'V7',
    };
    const lines = buildManualExpenseLines({ ...bill, serviceChargeAmount: '100' });
    assert.deepEqual(lines, [
      { lineNumber: 1, description: 'ค่าอาหาร', quantity: '1', unitPrice: '1000', discountAmount: '0', vatRate: '0.07', taxCodeDefinitionId: 'tax-def-1', externalTaxCode: 'V7', transactionContext: 'DOMESTIC_PURCHASE' },
      { lineNumber: 2, description: 'ค่าบริการ (Service charge)', chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '0.07', taxCodeDefinitionId: 'tax-def-1', externalTaxCode: 'V7', transactionContext: 'DOMESTIC_PURCHASE' },
    ]);
    // receipt-additional-charges spec §15, first acceptance case: 1,000 + service 100 + VAT 77 = 1,177.
    // The AI path already produces this; typing the same bill by hand must land on the same total.
    const grandTotal = lines.reduce((sum, line) => sum + calculateManualExpenseTotals({
      quantity: line.quantity, unitPrice: line.unitPrice, vatRate: line.vatRate, vatMode: 'VAT_EXCLUDED',
    }).grandTotal, 0);
    assert.equal(grandTotal, 1177);
    // No charge typed: the document stays a single line, exactly as before.
    assert.equal(buildManualExpenseLines({ ...bill, serviceChargeAmount: '' }).length, 1);
    assert.equal(buildManualExpenseLines({ ...bill, serviceChargeAmount: '0' }).length, 1);
    assert.equal(buildManualExpenseLines(bill).length, 1);
  });

  it('numbers multiple hand-keyed items sequentially and appends the charge after them', () => {
    const lines = buildManualExpenseLines({
      items: [
        { description: 'ค่าอาหาร', quantity: '2', unitPrice: '250', discountAmount: '0' },
        { description: 'ค่าเครื่องดื่ม', quantity: '4', unitPrice: '80' },
      ],
      serviceChargeAmount: '50',
      serviceChargeDescription: 'ค่าบริการ (Service charge)',
      vatRate: '0.07',
    });
    assert.deepEqual(lines.map((line) => [line.lineNumber, line.description, line.quantity, line.unitPrice, line.discountAmount]), [
      [1, 'ค่าอาหาร', '2', '250', '0'],
      [2, 'ค่าเครื่องดื่ม', '4', '80', '0'],
      [3, 'ค่าบริการ (Service charge)', '1', '50', '0'],
    ]);
    // One bill, one tax treatment: every line carries the document VAT rate.
    assert.ok(lines.every((line) => line.vatRate === '0.07' && line.transactionContext === 'DOMESTIC_PURCHASE'));
  });

  it('builds the review PATCH without client-computed totals', () => {
    const payload = buildExpenseDraftReviewPayload({
      vendorNameSnapshot: ' ร้านทดสอบ ',
      vendorTaxIdSnapshot: '0100000000001',
      vendorAddressSnapshot: '',
      vendorBranchCodeSnapshot: '',
      vendorDocumentNumber: 'INV-1',
      expenseDate: '2026-07-10',
      vatMode: 'VAT_EXCLUDED',
      lines: [{
        description: ' สินค้า ', quantity: '2', unitPrice: '150', discountAmount: '10', vatRate: '0.07',
        whtRate: '0.03', expenseCategoryId: 'category-1', accountHintKey: 'expense.office', taxCategory: 'INPUT_VAT',
      }],
    });

    assert.deepEqual(payload, {
      vendorNameSnapshot: 'ร้านทดสอบ',
      vendorTaxIdSnapshot: '0100000000001',
      // CON-8/§6: an untouched address and branch travel as null, never '' and never '00000'.
      vendorAddressSnapshot: null,
      vendorBranchCodeSnapshot: null,
      vendorDocumentNumber: 'INV-1',
      expenseDate: '2026-07-10',
      vatMode: 'VAT_EXCLUDED',
      lines: [{
        // §5.1: stated on EVERY row, product rows included. An absent kind tells the server to keep
        // whatever that row already had, which is not what this form means on a goods line.
        lineNumber: 1, description: 'สินค้า', chargeKind: null, quantity: '2', unitPrice: '150', discountAmount: '10', vatRate: '0.07',
        whtRate: '0.03', expenseCategoryId: 'category-1', accountHintKey: 'expense.office', taxCategory: 'INPUT_VAT',
      }],
    });
    assert.equal('grandTotalAmount' in payload, false);
    assert.equal('subtotalAmount' in payload, false);
  });

  it('persists the selected VAT source unit instead of only a derived rate', () => {
    const payload = buildExpenseDraftReviewPayload({
      vendorNameSnapshot: 'ร้านทดสอบ',
      vendorTaxIdSnapshot: '',
      vendorAddressSnapshot: '',
      vendorBranchCodeSnapshot: '',
      vendorDocumentNumber: 'INV-1',
      expenseDate: '2026-08-20',
      vatMode: 'VAT_INCLUDED',
      vatSource: { inputType: 'AMOUNT', vatAmount: '27.08' },
      lines: [{
        description: 'กาแฟ', quantity: '1', unitPrice: '414', discountAmount: '0', vatRate: '0.07',
        whtRate: null, expenseCategoryId: null, accountHintKey: null, taxCategory: null,
      }],
    });
    assert.deepEqual(payload.vatSource, { inputType: 'AMOUNT', vatAmount: '27.08' });
    assert.equal(expenseVatSourceValidationMessage(payload.vatSource!), null);
  });

  it('round trips exact WHT source units without deriving a rate or sending a server-owned origin', () => {
    for (const whtInput of [
      { inputType: 'AMOUNT', value: '12.34' },
      { inputType: 'RATE', value: '3' },
      { inputType: 'RATE', value: '100' },
      { inputType: 'AMOUNT', value: '0' },
    ] as const) {
      // Only fields read by the review mapper are relevant to this persisted-detail fixture.
      const detail = {
        vendorNameSnapshot: 'ร้านทดสอบ', expenseDate: '2026-08-27', vatMode: 'VAT_EXCLUDED',
        whtInputJson: { ...whtInput, origin: 'OCR' },
        lines: [{
          description: 'ค่าบริการ', quantity: '1', unitPrice: '1000', discountAmount: '0',
          vatRate: '0.07', whtRate: '0.03', expenseCategoryId: null, accountHintKey: null, taxCategory: null,
        }],
      } as ExpenseDetail;
      const values = reviewValues(detail);
      assert.deepEqual(values.whtInput, whtInput);
      values.lines[0]!.unitPrice = '2000';
      values.lines[0]!.discountAmount = '100';
      const payload = buildExpenseDraftReviewPayload(values);
      assert.deepEqual(payload.whtInput, whtInput);
      assert.equal('origin' in payload.whtInput!, false);
      assert.equal('whtRate' in payload.lines![0]!, false, 'source input replaces stale line rates');
    }
  });

  it('keeps existing line identities through a deletion while a newly inserted row has no id', () => {
    const line = (id: string, description: string) => ({
      id, description, quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '0',
      whtRate: null, expenseCategoryId: null, accountHintKey: null, taxCategory: null,
    });
    const detail = {
      vendorNameSnapshot: 'ร้านทดสอบ', expenseDate: '2026-09-07', vatMode: 'NO_VAT', whtInputJson: null,
      lines: [line('line-first', 'รายการแรก'), line('line-second', 'รายการที่สอง')],
    } as ExpenseDetail;

    let values = reviewValues(detail);
    values = { ...values, lines: values.lines.slice(1) };
    values = insertExpenseReviewLine(values, null);
    const payload = buildExpenseDraftReviewPayload(values);

    assert.deepEqual(payload.lines?.map((item) => item.id), ['line-second', undefined]);
    assert.deepEqual(payload.lines?.map((item) => item.description), ['รายการที่สอง', '']);
  });

  it('preserves a legacy mixed-rate bill on ordinary save until an explicit whole-bill replacement', () => {
    const detail = {
      expenseDate: '2026-08-27', vatMode: 'NO_VAT', whtInputJson: null,
      lines: ['0.03', '0.01', null].map((whtRate) => ({
        description: 'รายการ', quantity: '1', unitPrice: '100', discountAmount: '0',
        vatRate: '0', whtRate, expenseCategoryId: null, accountHintKey: null, taxCategory: null,
      })),
    } as ExpenseDetail;
    const values = reviewValues(detail);
    values.vendorNameSnapshot = 'แก้ชื่อผู้ขายเท่านั้น';
    const unchanged = buildExpenseDraftReviewPayload(values);
    assert.equal('whtInput' in unchanged, false);
    assert.deepEqual(unchanged.lines!.map((line) => line.whtRate), ['0.03', '0.01', undefined]);
    values.whtInput = { inputType: 'RATE', value: '0' };
    const replaced = buildExpenseDraftReviewPayload(values);
    assert.deepEqual(replaced.whtInput, { inputType: 'RATE', value: '0' });
    assert.ok(replaced.lines!.every((line) => !('whtRate' in line)));
  });

  it('keeps all zero VAT meanings through reload and removal of receipt-ineligible Tax Codes', () => {
    const detail = {
      expenseDate: '2026-08-27', vatMode: 'VAT_EXCLUDED',
      lines: ['ZERO_RATED', 'EXEMPT', 'NON_VAT', null].map((vatTreatment) => ({
        description: 'ชื่อสินค้าไม่ใช้ตัดสินประเภทภาษี', quantity: '1', unitPrice: '50', discountAmount: '0',
        vatRate: '0', vatTreatment, whtRate: null, expenseCategoryId: null, accountHintKey: null, taxCategory: null,
        taxSnapshot: { taxCodeDefinitionId: 'tax-code', externalTaxCode: 'ZERO', taxContext: 'DOMESTIC_PURCHASE' },
      })),
    } as ExpenseDetail;
    const values = reviewValues(detail);
    const payload = buildExpenseDraftReviewPayload({ ...values, lines: clearExpenseTaxSelections(values.lines) });
    assert.deepEqual(payload.lines!.map((line) => line.vatTreatment), ['ZERO_RATED', 'EXEMPT', 'NON_VAT', null]);
    assert.ok(payload.lines!.every((line) => line.vatRate === '0' && !line.taxCodeDefinitionId));
    assert.deepEqual(values.lines.map((line) => vatRatePreset(line.vatRate, line.vatTreatment)), ['zero', 'exempt', 'nonVat', 'unknownZero']);
  });

  it('clears previous VAT evidence on every explicit unit change without changing accounting lines', () => {
    const values = reviewValues({ vendorNameSnapshot: 'ร้านทดสอบ', vendorDocumentNumber: 'TEST',
      expenseDate: '2026-09-07', vatMode: 'VAT_INCLUDED', lines: [1, 2].map((lineNumber) => ({
        lineNumber, description: 'สินค้า', quantity: '1', unitPrice: '107', discountAmount: '0', vatRate: '0.07',
      })),
    } as ExpenseDetail);
    for (const from of ['NONE', 'RATE', 'AMOUNT', 'BOTH', 'LINES'] as const) {
      const previous = { ...values, vatSource: from === 'LINES'
        ? { inputType: 'NONE' as const, lines: [{ lineNumber: 1, inputType: 'BOTH' as const, vatRatePercent: '7', vatAmount: '157.64' }] }
        : { inputType: from, vatRatePercent: '7', vatAmount: '157.64' } };
      for (const to of ['NONE', 'RATE', 'AMOUNT', 'BOTH', 'LINES'] as const) {
        const changed = changeExpenseVatSourceType(previous, to);
        if (from === to) {
          assert.equal(changed, previous, 'selecting the same unit again must not erase entered evidence');
          continue;
        }
        assert.equal(changed.lines, previous.lines, 'a source-unit change must not silently change the line VAT');
        const source = buildExpenseDraftReviewPayload(changed).vatSource!;
        assert.deepEqual(source, to === 'LINES'
          ? { inputType: 'NONE', lines: [1, 2].map((lineNumber) => ({ lineNumber, inputType: 'NONE' })) }
          : { inputType: to });
        assert.equal(Boolean(expenseVatSourceValidationMessage(source, 'VAT_INCLUDED')), !['NONE', 'LINES'].includes(to));
      }
    }
    const other = { lineNumber: 2, inputType: 'BOTH' as const, vatRatePercent: '7', vatAmount: '7.00' };
    const perLine = { ...values, vatSource: { inputType: 'NONE' as const, lines: [
      { lineNumber: 1, inputType: 'BOTH' as const, vatRatePercent: '7', vatAmount: '7.00' }, other,
    ] } };
    for (const to of ['NONE', 'RATE', 'AMOUNT', 'BOTH'] as const) {
      if (to === 'BOTH') {
        assert.equal(changeExpenseVatSourceType(perLine, to, 0), perLine);
        continue;
      }
      const source = changeExpenseVatSourceType(perLine, to, 0).vatSource!;
      assert.deepEqual(source.lines, [{ lineNumber: 1, inputType: to }, other]);
      assert.equal(source.lines![1], other, 'changing one line leaves other evidence intact');
    }
    assert.deepEqual(changeExpenseVatSourceType(values, 'BOTH', 0).vatSource?.lines,
      [{ lineNumber: 1, inputType: 'BOTH' }, { lineNumber: 2, inputType: 'NONE' }],
      'a line without previous source evidence must not acquire a required hidden amount');
  });

  it('hydrates normalized source VAT and validates missing unit values', () => {
    const snapshot: ExpenseVatCaptureSnapshotV1 = {
      version: 1,
      source: {
        inputType: 'BOTH', origin: 'OCR', vatRatePercent: '7.0000', vatAmount: '27.0800',
        taxableAmount: '386.92', grossAmount: '414', capturedAt: '2026-08-20T00:00:00.000Z',
      },
      calculation: {
        formula: 'INCLUDED', vatRatePercent: '7.0000', preVatAmount: '386.9200',
        vatBaseAmount: '386.9200', vatAmount: '27.0800', grossAmount: '414.0000',
        lineResults: [], roundingMode: 'HALF_UP', decimalPlaces: 2, calculationVersion: 'expense-vat-v1',
      },
      reconciliation: {
        status: 'MATCHED', acceptedSource: 'SOURCE_AMOUNT', differenceAmount: '0.0000', toleranceAmount: '0.05',
      },
    };
    const source = expenseVatSourceFromSnapshot(snapshot);
    assert.deepEqual(source, { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '27.08' });
    const accepted: ExpenseVatCaptureSnapshotV1 = { ...snapshot,
      calculation: { ...snapshot.calculation, vatAmount: '27.0000' },
      reconciliation: { ...snapshot.reconciliation, status: 'REVIEWER_ACCEPTED', differenceAmount: '0.0800' },
    };
    assert.equal(isBlockingExpenseVatReconciliation(accepted), false);
    assert.deepEqual(expenseVatSourceFromSnapshot(accepted), source, 'reload retains source evidence rather than calculating it away');
    assert.match(expenseVatSourceValidationMessage({ inputType: 'AMOUNT', vatAmount: '' }) ?? '', /บาท/);
    assert.match(expenseVatSourceValidationMessage({
      inputType: 'NONE',
      lines: [{ lineNumber: 2, inputType: 'BOTH', vatRatePercent: '7', vatAmount: '' }],
    }) ?? '', /รายการ 2/);
    assert.match(expenseVatSourceValidationMessage({ inputType: 'AMOUNT', vatAmount: '1.001' }) ?? '', /2 ตำแหน่ง/);
    assert.match(expenseVatSourceValidationMessage({ inputType: 'AMOUNT', vatAmount: '1.00' }, 'NO_VAT') ?? '', /ไม่มี VAT/);
    assert.match(expenseVatSourceValidationMessage({ inputType: 'RATE', vatRatePercent: '7' }, 'EXEMPT') ?? '', /ไม่มี VAT/);
  });

  it('formats a taxpayer ID for display and stores it as digits only', () => {
    assert.equal(formatTaxId('0105558096348'), '0-1055-58096-34-8');
    assert.equal(formatTaxId('0-1055-58096-34-8'), '0-1055-58096-34-8');
    // Half-typed input never shows a trailing separator.
    assert.equal(formatTaxId('0'), '0');
    assert.equal(formatTaxId('01055'), '0-1055');
    assert.equal(formatTaxId(''), '');
    // Overlong paste is cut at 13 digits, not carried into the value.
    assert.equal(taxIdDigits('1231243431321323232323'), '1231243431321');
    assert.equal(taxIdDigits('0-1055-58096-34-8'), '0105558096348');
    assert.equal(
      buildExpenseDraftReviewPayload({
        vendorNameSnapshot: 'ร้านทดสอบ', vendorTaxIdSnapshot: ' 0-1055-58096-34-8 ', vendorDocumentNumber: 'INV-1',
        vendorAddressSnapshot: '', vendorBranchCodeSnapshot: '',
        expenseDate: '2026-07-10', vatMode: 'VAT_EXCLUDED', lines: [],
      }).vendorTaxIdSnapshot,
      '0105558096348',
    );
  });

  it('takes a digit typed in front of a complete ID and drops the overflow at the end', () => {
    // The receipt reads 0105541008688; OCR lost the leading zero, so the reviewer types it back in
    // front of an already-full field. The kept digits are the leading 13, not the trailing ones.
    assert.equal(taxIdDigits(`0${formatTaxId('1055410086888')}`), '0105541008688');
    assert.equal(formatTaxId(taxIdDigits(`0${formatTaxId('1055410086888')}`)), '0-1055-41008-68-8');
  });

  it('sends the payee taxpayer class only once review has picked one', () => {
    const values = {
      vendorNameSnapshot: 'ร้านทดสอบ', vendorTaxIdSnapshot: '0100000000001', vendorDocumentNumber: 'INV-1',
      vendorAddressSnapshot: '', vendorBranchCodeSnapshot: '',
      expenseDate: '2026-07-10', vatMode: 'VAT_EXCLUDED' as const, lines: [],
    };
    assert.equal(buildExpenseDraftReviewPayload({ ...values, vendorEntityKindSnapshot: 'INDIVIDUAL' }).vendorEntityKindSnapshot, 'INDIVIDUAL');
    // '' is the ยังไม่ระบุ sentinel: the update contract has no clear-to-null idiom, so it is omitted.
    assert.equal('vendorEntityKindSnapshot' in buildExpenseDraftReviewPayload({ ...values, vendorEntityKindSnapshot: '' }), false);
    assert.equal('vendorEntityKindSnapshot' in buildExpenseDraftReviewPayload(values), false);
  });

  it('preserves explicit zero VAT and WHT rates in the review PATCH', () => {
    const payload = buildExpenseDraftReviewPayload({
      vendorNameSnapshot: '',
      vendorTaxIdSnapshot: '',
      vendorAddressSnapshot: '',
      vendorBranchCodeSnapshot: '',
      vendorDocumentNumber: '',
      expenseDate: '2026-07-30',
      vatMode: 'VAT_EXCLUDED',
      lines: [{
        description: 'Tip',
        quantity: '1',
        unitPrice: '20',
        discountAmount: '0',
        vatRate: '0',
        whtRate: '0',
        expenseCategoryId: null,
        accountHintKey: null,
        taxCategory: null,
      }],
    });
    assert.equal(payload.lines![0].vatRate, '0');
    assert.equal(payload.lines![0].whtRate, '0');
  });

  // Spec §19g decision 1: omitting a blank rate let the server apply its own default, so the totals
  // previewed here were not the totals stored. Blank must travel as blank.
  it('sends a blank VAT rate rather than omitting it, so preview equals stored', () => {
    const payload = buildExpenseDraftReviewPayload({
      vendorNameSnapshot: '', vendorTaxIdSnapshot: '', vendorDocumentNumber: '',
      vendorAddressSnapshot: '', vendorBranchCodeSnapshot: '',
      expenseDate: '2026-08-04', vatMode: 'VAT_INCLUDED',
      lines: [{
        description: 'Starbucks', quantity: '1', unitPrice: '180', discountAmount: '0',
        vatRate: '', whtRate: null, expenseCategoryId: null, accountHintKey: null, taxCategory: null,
      }],
    });
    assert.equal('vatRate' in payload.lines![0], true);
    assert.equal(payload.lines![0].vatRate, '');
    assert.equal('whtRate' in payload.lines![0], false, 'WHT keeps its existing omit-when-empty idiom');
  });

  // Spec §19g decision 4: the reported slip prints "11.78 VAT TTL", not a rate.
  it('derives the stored rate from the VAT amount a document prints', () => {
    assert.equal(vatRateFromPrintedAmount({
      afterDiscountAmount: '180', printedVatAmount: '11.78', vatMode: 'VAT_INCLUDED',
    }), '0.0700');
    assert.equal(vatRateFromPrintedAmount({
      afterDiscountAmount: '542.06', printedVatAmount: '37.94', vatMode: 'VAT_EXCLUDED',
    }), '0.0700');
    assert.equal(vatRateFromPrintedAmount({
      afterDiscountAmount: '180', printedVatAmount: '0', vatMode: 'VAT_INCLUDED',
    }), '0.0000');
  });

  it('refuses to derive a rate from a pair that cannot describe one', () => {
    for (const input of [
      { afterDiscountAmount: '0', printedVatAmount: '11.78', vatMode: 'VAT_INCLUDED' as const },
      { afterDiscountAmount: '100', printedVatAmount: '-5', vatMode: 'VAT_EXCLUDED' as const },
      // VAT equal to the gross would leave a zero base under VAT_INCLUDED.
      { afterDiscountAmount: '100', printedVatAmount: '100', vatMode: 'VAT_INCLUDED' as const },
      { afterDiscountAmount: '100', printedVatAmount: '150', vatMode: 'VAT_EXCLUDED' as const },
    ]) {
      assert.equal(vatRateFromPrintedAmount(input), '', JSON.stringify(input));
    }
  });

  it('maps stored rates onto the reviewer-facing presets and back', () => {
    assert.equal(vatRatePreset(''), 'unset');
    assert.equal(vatRatePreset('0.07'), 'standard');
    assert.equal(vatRatePreset('0.0700'), 'standard');
    assert.equal(vatRatePreset('0'), 'unknownZero');
    assert.equal(vatRatePreset('0', 'EXEMPT'), 'exempt');
    assert.equal(vatRatePreset('0.0000', 'ZERO_RATED'), 'zero');
    assert.equal(vatRatePreset('0', 'NON_VAT'), 'nonVat');
    assert.equal(vatRatePreset('0.065'), 'custom');

    assert.equal(vatRatePresetValue('standard', ''), '0.07');
    assert.equal(vatRatePresetValue('exempt', '0.07'), '0');
    assert.equal(vatRatePresetValue('zero', '0.07'), '0');
    assert.equal(vatRatePresetValue('nonVat', '0.07'), '0');
    assert.equal(vatRatePresetValue('unknownZero', '0.07'), '0');
    assert.equal(vatTreatmentForPreset('exempt'), 'EXEMPT');
    assert.equal(vatTreatmentForPreset('zero'), 'ZERO_RATED');
    assert.equal(vatTreatmentForPreset('nonVat'), 'NON_VAT');
    assert.equal(vatTreatmentForPreset('unknownZero'), null);
    assert.equal(vatTreatmentForPreset('standard'), null);
    assert.equal(vatTreatmentForPreset('custom'), null);
    // Switching to custom keeps the current rate to edit rather than discarding it.
    assert.equal(vatRatePresetValue('custom', '0.065'), '0.065');
    assert.equal(vatRatePresetValue('custom', ''), '');
  });

  it('converts a typed percentage into the stored fraction, rejecting out-of-range input', () => {
    assert.equal(expensePercentToRate('7'), '0.07');
    assert.equal(expensePercentToRate('6.5'), '0.065');
    assert.equal(expensePercentToRate('0'), '0');
    assert.equal(expensePercentToRate(''), '');
    assert.equal(expensePercentToRate('100'), '');
    assert.equal(expensePercentToRate('-1'), '');
  });

  // The editable input needs a true inverse: expenseRatePercent hides 0 (right for a display echo,
  // wrong for a field the reviewer has to be able to type 0 into).
  it('round-trips the editable percent input through the stored fraction, including zero', () => {
    for (const percent of ['7', '6.5', '0', '20']) {
      assert.equal(expenseRateToPercent(expensePercentToRate(percent)), percent);
    }
    assert.equal(expenseRateToPercent(''), '');
    assert.equal(expenseRateToPercent('abc'), '');
    assert.equal(expenseRatePercent('0'), null, 'the display echo still hides a zero rate');
  });

  it('labels the effective rate from the lines instead of assuming one', () => {
    assert.equal(effectiveVatRateLabel([{ vatRate: '0.07' }, { vatRate: '0.0700' }]), '7%');
    assert.equal(effectiveVatRateLabel([{ vatRate: '0' }]), '0%');
    assert.equal(effectiveVatRateLabel([{ vatRate: '0.07' }, { vatRate: '0' }]), 'หลายอัตรา');
    assert.equal(effectiveVatRateLabel([{ vatRate: null }, { vatRate: '' }]), 'ยังไม่ระบุ');
    assert.equal(effectiveVatRateLabel([]), 'ยังไม่ระบุ');
  });

  it('removes near-white background pixels but keeps dark ink for signature preview', () => {
    // 2 pixels: white background + dark ink stroke.
    const data = new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 60, 255]);
    const imageData = { data, width: 2, height: 1 } as unknown as ImageData;
    const result = removeLightBackground(imageData);
    assert.equal(result.data[3], 0, 'white pixel becomes transparent');
    assert.equal(result.data[7], 255, 'ink pixel keeps its alpha');
    assert.equal(result.data[4], 20, 'ink color is untouched');
  });

  it('finds the smallest non-transparent signature bounds and rejects an empty image', () => {
    const data = new Uint8ClampedArray(4 * 3 * 4);
    data[(1 * 4 + 2) * 4 + 3] = 255;
    data[(2 * 4 + 3) * 4 + 3] = 255;
    const imageData = { data, width: 4, height: 3 } as unknown as ImageData;
    assert.deepEqual(findOpaqueBounds(imageData), { x: 2, y: 1, width: 2, height: 2 });
    assert.equal(findOpaqueBounds({ data: new Uint8ClampedArray(16), width: 2, height: 2 } as unknown as ImageData), null);
  });
});

describe('expenseCapabilities', () => {
  it('grants nothing without permissions', () => {
    const caps = expenseCapabilities([]);
    assert.ok(Object.values(caps).every((allowed) => allowed === false));
  });

  it('maps each backend permission to its capability', () => {
    assert.equal(expenseCapabilities(['expense.read']).canViewList, true);
    assert.equal(expenseCapabilities(['expense.read_related']).canViewList, true);
    assert.equal(expenseCapabilities(['expense.read_own']).canViewList, true);
    assert.equal(expenseCapabilities(['expense.review']).canReview, true);
    assert.equal(expenseCapabilities(['expense.confirm']).canConfirm, true);
    assert.equal(expenseCapabilities(['expense.create']).canCreate, true);
    assert.equal(expenseCapabilities(['expense.update']).canUpdate, true);
    assert.equal(expenseCapabilities(['expense.delete']).canDelete, true);
    assert.equal(expenseCapabilities(['expense.receipt.upload']).canUploadReceipts, true);
    assert.equal(expenseCapabilities(['expense.reject']).canReject, true);
    assert.equal(expenseCapabilities(['expense.void']).canVoid, true);
    assert.equal(expenseCapabilities(['expense.payment.record']).canRecordPayment, true);
    assert.equal(expenseCapabilities(['expense.duplicate.resolve']).canResolveDuplicates, true);
    assert.equal(expenseCapabilities(['expense.category.manage']).canManageCategories, true);
    assert.equal(expenseCapabilities(['expense.signature.self_manage']).canUsePersonalSignatures, true);
    assert.equal(expenseCapabilities(['expense.signature.manage']).canUsePersonalSignatures, true);
    // Evidence moved off expense.read onto its own key, so expense.read alone no longer grants it.
    assert.equal(expenseCapabilities(['expense.evidence.read']).canViewSharedEvidence, true);
    assert.equal(expenseCapabilities(['expense.read']).canViewSharedEvidence, false);
  });

  it('gates list and evidence tabs with their own view permissions', () => {
    assert.equal(canAccessExpenseTab('list', expenseCapabilities([])), false);
    assert.equal(canAccessExpenseTab('list', expenseCapabilities(['expense.read_own'])), true);
    assert.equal(canAccessExpenseTab('list', expenseCapabilities(['expense.read_related'])), true);
    assert.equal(canAccessExpenseTab('evidence', expenseCapabilities(['expense.read'])), false);
    assert.equal(canAccessExpenseTab('evidence', expenseCapabilities(['expense.evidence.read'])), true);
  });

  // "ลายเซ็นของฉัน" (owner decision 2026-08-20): the screen is where you keep your OWN signature, so
  // it belongs to whoever performs either signing act. `expense.signature.approve` no longer opens
  // anything — a reviewer, who could not get in before, is exactly who needs it.
  it('opens the signature tab for self-service, either signing act and the legacy manage grant, and nobody else', () => {
    assert.equal(canAccessExpenseTab('signatures', expenseCapabilities(['expense.signature.self_manage'])), true);
    assert.equal(canAccessExpenseTab('signatures', expenseCapabilities(['expense.review'])), true);
    assert.equal(canAccessExpenseTab('signatures', expenseCapabilities(['expense.confirm'])), true);
    assert.equal(canAccessExpenseTab('signatures', expenseCapabilities(['expense.signature.manage'])), true);
    assert.equal(canAccessExpenseTab('signatures', expenseCapabilities(['expense.signature.approve'])), false);
    assert.equal(canAccessExpenseTab('signatures', expenseCapabilities(['expense.read'])), false);
  });

  it('keeps related-view authority read-only', () => {
    const caps = expenseCapabilities(['expense.read_related']);
    assert.equal(caps.canViewList, true);
    assert.equal(caps.canUpdate, false);
    assert.equal(caps.canConfirm, false);
    assert.equal(caps.canRecordPayment, false);
    assert.equal(caps.canVoid, false);
  });

  it('allows OCR request through every permission accepted by the backend', () => {
    assert.equal(expenseCapabilities(['expense.ocr.request']).canRequestOcr, true);
    assert.equal(expenseCapabilities(['expense.review']).canRequestOcr, true);
    assert.equal(expenseCapabilities(['expense.receipt.upload']).canRequestOcr, true);
  });

  it('requires both expense.export and expense.read for the accountant package', () => {
    assert.equal(expenseCapabilities(['expense.export']).canExportPackage, false);
    assert.equal(expenseCapabilities(['expense.read']).canExportPackage, false);
    assert.equal(expenseCapabilities(['expense.export', 'expense.read']).canExportPackage, true);
  });

  // Owner decision 2026-08-09: the accounting screens are closed this launch while the ledger keeps
  // posting server-side, so the ledger affordances inside the expense workspace — the
  // "ลงบัญชี"/backfill buttons and the "ดู JV" link — are off regardless of permissions. The
  // permissions and POST /posting/generate are untouched; only the buttons are gone.
  it('withholds the ledger affordances while the accounting screens are closed', () => {
    const everyLedgerPermission = ['ledger.journal.read', 'journal.entry.create', 'journal.entry.post'];
    assert.equal(expenseCapabilities(everyLedgerPermission).canPostLedger, false);
    assert.equal(expenseCapabilities(everyLedgerPermission).canReadLedger, false);
    // Non-ledger capabilities in the same object are unaffected by the hide.
    assert.equal(expenseCapabilities([...everyLedgerPermission, 'expense.read']).canViewList, true);
  });

  it('review permission alone does not grant finance actions', () => {
    const caps = expenseCapabilities(['expense.review']);
    assert.equal(caps.canConfirm, false);
    assert.equal(caps.canReject, false);
    assert.equal(caps.canVoid, false);
    assert.equal(caps.canRecordPayment, false);
    assert.equal(caps.canResolveDuplicates, false);
  });

  it('allows deleting a draft, a rejected record, or an unpaid zero-total review item with delete permission or owner update permission', () => {
    const draft = {
      status: 'DRAFT' as const,
      grandTotalAmount: '10.00',
      paymentStatus: 'UNPAID' as const,
      createdByUserId: 'user-1',
    };
    assert.equal(canDeleteExpense(draft, 'user-2', { canDelete: true, canUpdate: false }), true);
    assert.equal(canDeleteExpense(draft, 'user-1', { canDelete: false, canUpdate: true }), true);
    assert.equal(canDeleteExpense(draft, 'user-2', { canDelete: false, canUpdate: true }), false);
    for (const status of ['NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] as const) {
      assert.equal(canDeleteExpense({ ...draft, status, grandTotalAmount: '0.00' }, 'user-1', { canDelete: true, canUpdate: true }), true);
      assert.equal(canDeleteExpense({ ...draft, status, grandTotalAmount: '1.00' }, 'user-1', { canDelete: true, canUpdate: true }), false);
      assert.equal(canDeleteExpense({ ...draft, status, grandTotalAmount: '0.00', paymentStatus: 'PAID' }, 'user-1', { canDelete: true, canUpdate: true }), false);
    }
    const rejected = { ...draft, status: 'REJECTED' as const };
    assert.equal(canDeleteExpense(rejected, 'user-2', { canDelete: true, canUpdate: false }), true);
    assert.equal(canDeleteExpense(rejected, 'user-1', { canDelete: false, canUpdate: true }), true);
    assert.equal(canDeleteExpense(rejected, 'user-2', { canDelete: false, canUpdate: true }), false);
    for (const status of ['EXTRACTING', 'CONFIRMED', 'VOIDED'] as const) {
      assert.equal(canDeleteExpense({ ...draft, status }, 'user-1', { canDelete: true, canUpdate: true }), false);
    }
  });

  it('DELETE-HISTORY payment or voucher history prevents deletion without widening cancellation rights', () => {
    const row = { status: 'DRAFT', grandTotalAmount: '10', paymentStatus: 'UNPAID', createdByUserId: 'user-1', hasDeletionBlockingHistory: true } as any;
    assert.equal(canDeleteExpense(row, 'user-1', { canDelete: true, canUpdate: true }), false);
    assert.equal(canDeleteExpense({ ...row, hasDeletionBlockingHistory: undefined, payments: [{ status: 'VOIDED' }] }, 'user-1', { canDelete: true, canUpdate: true }), false);
    assert.equal(canCancelExpenseInsteadOfDelete(row, { canReject: true, canVoid: false }), true);
    assert.equal(canCancelExpenseInsteadOfDelete(row, { canReject: false, canVoid: false }), false);
    assert.equal(canCancelExpenseInsteadOfDelete({ ...row, status: 'REJECTED' }, { canReject: true, canVoid: true }), false);
    assert.equal(canCancelExpenseInsteadOfDelete({ ...row, sourceReimbursementRequestId: 'claim-1' }, { canReject: true, canVoid: true }), false);
    assert.match(expenseDeleteErrorMessage({ code: 'EXPENSE_HAS_LINKED_DATA', details: { blocker: 'PAYMENT' } }, 'th', 'DRAFT'), /เคยบันทึกการจ่ายไว้.*ยกเลิก/);
    assert.match(expenseDeleteErrorMessage({ code: 'EXPENSE_HAS_LINKED_DATA', details: { blocker: 'DISBURSEMENT_VOUCHER' } }, 'th'), /ใบเตรียมจ่าย.*เปิดรายจ่าย/);
    assert.match(expenseDeleteErrorMessage({ code: 'EXPENSE_HAS_LINKED_DATA', details: { blocker: 'HISTORY' } }, 'th', 'REJECTED'), /ยกเลิกแล้ว.*เลือกรายการอื่น/);
  });

  it('names the delete target by the first field that is actually filled in', () => {
    const unnamed = { expenseNumber: null, vendorDocumentNumber: null, vendorNameSnapshot: null };
    assert.equal(expenseDeleteTargetLabel({ ...unnamed, expenseNumber: 'EXP-2026-0001' }), 'EXP-2026-0001');
    assert.equal(expenseDeleteTargetLabel({ ...unnamed, vendorDocumentNumber: '260705-02-17420' }), '260705-02-17420');
    assert.equal(expenseDeleteTargetLabel({ ...unnamed, vendorNameSnapshot: 'Starbucks Coffee' }), 'Starbucks Coffee');
    // A saved-then-cleared field arrives as '' or whitespace, not null, and must not win the pick.
    assert.equal(expenseDeleteTargetLabel({ ...unnamed, expenseNumber: '', vendorNameSnapshot: 'ร้านทดสอบ' }), 'ร้านทดสอบ');
    assert.equal(expenseDeleteTargetLabel({ ...unnamed, expenseNumber: '   ' }), undefined);
    assert.equal(expenseDeleteTargetLabel(unnamed), undefined);
  });
});

describe('free expense draft UI access', () => {
  it('counts mutable free source states as drafts', () => {
    assert.equal(isFreeExpenseListDraft('DRAFT'), true);
    assert.equal(isFreeExpenseListDraft('NEEDS_REVIEW'), true);
    assert.equal(isFreeExpenseListDraft('CONFIRMED'), false);
    assert.equal(isFreeExpenseListDraft('REJECTED'), false);
  });

  it('keeps a free expense editable only through its source card while paid permissions stay unchanged', () => {
    const paidPermissions = ['expense.read', 'expense.update', 'expense.review', 'expense.confirm', 'expense.create', 'expense.export', 'expense.receipt.upload'];
    const freePermissions = expenseUiPermissions(paidPermissions, true);
    const freeCaps = expenseCapabilities(freePermissions);
    const paidCaps = expenseCapabilities(expenseUiPermissions(paidPermissions));
    const sourceDraft = {
      status: 'OPEN' as const, canEdit: true,
      header: { expenseDate: null, vendorName: null, businessPurpose: null }, items: [],
      missingFields: [{ id: 'vendor', scope: 'DOCUMENT' as const, field: 'vendorName', prompt: 'vendor' }],
    };
    const detail = { status: 'DRAFT' as const, sourceDraft, lines: [] };

    assert.equal(freeCaps.canReview || freeCaps.canConfirm || freeCaps.canCreate || freeCaps.canExportPackage, false);
    assert.equal(paidCaps.canReview && paidCaps.canConfirm && paidCaps.canCreate && paidCaps.canExportPackage, true);
    assert.equal(canExportExpenseList(true, expenseCapabilities(paidPermissions)), false);
    assert.equal(canExportExpenseList(false, paidCaps), true);
    assert.equal(expenseSourceDraftViewState(detail, false).sourceOnly, true);
    assert.equal(expenseSourceDraftViewState(detail, true).sourceOnly, false);
  });
});

describe('summarizeExpenseKpis', () => {
  // The four rows the owner had on screen when the two รอตรวจสอบ counts disagreed.
  const row = (over: Partial<Parameters<typeof summarizeExpenseKpis>[0][number]>) => ({
    status: 'NEEDS_REVIEW' as const,
    grandTotalAmount: '180.00',
    vatAmount: '11.78',
    outstandingAmount: '180.00',
    paymentStatus: 'UNPAID' as const,
    dueDate: null,
    ...over,
  });
  const rows = [
    row({ status: 'DRAFT', grandTotalAmount: '90.00', vatAmount: '0.00', outstandingAmount: '90.00' }),
    row({ status: 'REJECTED' }),
    row({}),
    row({ vatAmount: '0.00' }),
  ];

  it('separates captured totals from confirmed payable amounts', () => {
    const kpi = summarizeExpenseKpis(rows, '2026-08-05');

    assert.equal(kpi.total, 450);
    assert.equal(kpi.counted, 3);
    // VAT on captured documents is not a claimable tax amount.
    assert.equal(kpi.vat, 11.78);
    assert.equal(kpi.outstanding, 0);
    const confirmed = summarizeExpenseKpis([...rows,
      row({ status: 'CONFIRMED', outstandingAmount: '40.50', paymentStatus: 'PARTIALLY_PAID', dueDate: '2026-08-04' }),
      row({ status: 'CONFIRMED', outstandingAmount: '0', paymentStatus: 'PAID' }),
    ], '2026-08-05');
    assert.equal(confirmed.outstanding, 40.5);
    assert.equal(confirmed.overdue, 40.5);
    assert.equal(confirmed.overdueCount, 1);
  });

  it('counts รอตรวจสอบ from DRAFT onward, by the same rule the chip uses', () => {
    const kpi = summarizeExpenseKpis(rows, '2026-08-05');

    // The draft plus the two review items; the rejected row is not outstanding work.
    assert.equal(kpi.pending, 3);
    assert.equal(kpi.pending, rows.filter((r) => isExpensePending(r.status)).length);
    assert.equal(isExpensePending('DRAFT'), true);
    assert.equal(isExpensePending('READY_FOR_CONFIRMATION'), true);
    assert.equal(isExpensePending('CONFIRMED'), false);
    assert.equal(isExpensePending('REJECTED'), false);
  });

  it('counts a past due date as overdue and stops at a paid or cancelled row', () => {
    const kpi = summarizeExpenseKpis([
      row({ status: 'CONFIRMED', dueDate: '2026-08-04' }),
      row({ status: 'CONFIRMED', dueDate: '2026-08-05' }),
      row({ status: 'CONFIRMED', dueDate: '2026-08-01', paymentStatus: 'PAID', outstandingAmount: '0.00' }),
      row({ status: 'NEEDS_REVIEW', dueDate: '2026-08-01' }),
      row({ dueDate: '2026-08-01', status: 'VOIDED' }),
    ], '2026-08-05');

    assert.equal(kpi.overdueCount, 1);
    assert.equal(kpi.overdue, 180);
  });
});

describe('expenseDeleteErrorMessage', () => {
  it('LINE-ACT names the retained expense and its cancellation route while file errors keep their own wording', () => {
    assert.equal(expenseDeleteErrorMessage({ code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED' }, 'th'),
      'ลบรายจ่ายนี้ไม่ได้ เพราะเคยออกใบรับรองแทนใบเสร็จไว้ ใช้ยกเลิกรายการแทน');
    assert.equal(canDeleteExpense({ status: 'DRAFT', grandTotalAmount: '0', paymentStatus: 'UNPAID', createdByUserId: 'user', hasRetainedSubstituteReceiptEvidence: true } as any,
      'user', { canDelete: true, canUpdate: true }), false);
    assert.match(expenseDeleteErrorMessage({ code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED' }, 'th', 'REJECTED'), /ยกเลิกแล้ว/);
    assert.doesNotMatch(expenseDeleteErrorMessage({ code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED' }, 'th', 'REJECTED'), /ใช้ยกเลิกรายการแทน/);
  });
  const blockers = [
    ['PAYMENT', 'ข้อมูลการจ่ายเงิน', 'recorded payment'],
    ['TAX_EVENT', 'เหตุการณ์ภาษี', 'tax event'],
    ['TAX_REVIEW_ISSUE', 'ประเด็นตรวจสอบภาษี', 'tax review issue'],
    ['TAX_RECONCILIATION_LINE', 'รายการกระทบยอดภาษี', 'tax reconciliation line'],
    ['TRADE_TAX_EVIDENCE', 'หลักฐานภาษีการค้า', 'trade tax evidence'],
    ['JOURNAL_ENTRY', 'สมุดรายวัน', 'journal entry'],
    ['JOURNAL_LINE', 'รายการบัญชีในสมุดรายวัน', 'journal line'],
    ['BANK_RECONCILIATION_MATCH', 'การจับคู่กระทบยอดธนาคาร', 'bank reconciliation match'],
    ['WORKFLOW_RUN', 'การทำงานของเวิร์กโฟลว์', 'workflow run'],
    ['WORKFLOW_TASK', 'งานในเวิร์กโฟลว์', 'workflow task'],
    ['WORKFLOW_EVENT_INBOX', 'เหตุการณ์ที่รอประมวลผลในเวิร์กโฟลว์', 'workflow event'],
    ['NOTIFICATION_EVENT', 'เหตุการณ์แจ้งเตือน', 'notification event'],
  ] as const;

  it('names every linked-data blocker in Thai and English', () => {
    for (const [blocker, thaiLabel, englishLabel] of blockers) {
      const error = Object.assign(new Error('generic conflict'), {
        code: 'EXPENSE_HAS_LINKED_DATA',
        details: { blocker },
      });
      assert.equal(
        expenseDeleteErrorMessage(error, 'th'),
        blocker === 'PAYMENT' ? 'ลบรายจ่ายนี้ไม่ได้ เพราะเคยบันทึกการจ่ายไว้ ใช้ยกเลิกรายการแทน' : `ลบรายการนี้ไม่ได้ เนื่องจากมีข้อมูลเชื่อมโยง: ${thaiLabel}`,
      );
      assert.equal(
        expenseDeleteErrorMessage(error, 'en'),
        blocker === 'PAYMENT' ? 'This expense has payment history. Cancel the expense instead, or choose another expense if already cancelled.' : `This expense cannot be deleted because it has linked data: ${englishLabel}.`,
      );
    }
  });

  it('hides an unknown blocker and preserves unrelated error fallbacks', () => {
    assert.equal(
      expenseDeleteErrorMessage({
        details: { code: 'EXPENSE_HAS_LINKED_DATA', blocker: 'FUTURE_LINK' },
      }, 'en'),
      'This expense cannot be deleted because it has linked data. Review the related records.',
    );
    assert.equal(expenseDeleteErrorMessage(new Error('Retention locked.'), 'th'), 'Retention locked.');
    assert.equal(expenseDeleteErrorMessage(null, 'th'), 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
    assert.equal(expenseDeleteErrorMessage(null, 'en'), 'An error occurred.');
  });

  it('asks the user to reload after a concurrent delete conflict', () => {
    const error = { details: { code: 'EXPENSE_CHANGED_DURING_DELETE' } };
    assert.equal(expenseDeleteErrorMessage(error, 'th'), 'รายการถูกแก้ไขระหว่างการลบ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
    assert.equal(expenseDeleteErrorMessage(error, 'en'), 'The expense changed during deletion. Reload and try again.');
  });
});

describe('expenseAiSuggestion / applyExpenseAiSuggestion', () => {
  const summary = {
    status: 'NOT_EXPENSE_DOCUMENT',
    suggestedFields: {
      vendorName: 'Starbucks Coffee',
      documentNumber: '260705-02-17420',
      grandTotalAmount: '180.00',
      vatRate: '0.07',
      confidence: 0.9,
    },
  };

  const emptyValues: ExpenseDraftReviewValues = {
    vendorNameSnapshot: '', vendorTaxIdSnapshot: '', vendorEntityKindSnapshot: '',
    vendorAddressSnapshot: '', vendorBranchCodeSnapshot: '',
    vendorDocumentNumber: '', expenseDate: '', vatMode: 'NO_VAT', lines: [],
  };

  it('reads only known string fields and ignores a missing or malformed block', () => {
    assert.deepEqual(expenseAiSuggestion(summary), {
      vendorName: 'Starbucks Coffee',
      documentNumber: '260705-02-17420',
      grandTotalAmount: '180.00',
    });
    assert.equal(expenseAiSuggestion({ status: 'NOT_EXPENSE_DOCUMENT' }), null);
    assert.equal(expenseAiSuggestion({ suggestedFields: ['vendorName'] }), null);
    assert.equal(expenseAiSuggestion({ suggestedFields: { vendorName: '   ' } }), null);
    assert.equal(expenseAiSuggestion(null), null);
  });

  it('fills blank fields and seeds one line from the total', () => {
    const filled = applyExpenseAiSuggestion(emptyValues, expenseAiSuggestion(summary)!);
    assert.equal(filled.vendorNameSnapshot, 'Starbucks Coffee');
    assert.equal(filled.vendorDocumentNumber, '260705-02-17420');
    assert.equal(filled.lines.length, 1);
    assert.equal(filled.lines[0]?.unitPrice, '180.00');
    assert.equal(filled.lines[0]?.description, 'Starbucks Coffee');
  });

  it('never overwrites a reviewer value or an existing line', () => {
    const typed = {
      ...emptyValues,
      vendorNameSnapshot: 'ร้านที่ผู้ตรวจพิมพ์เอง',
      lines: [{
        description: 'existing', quantity: '1', unitPrice: '99.00', discountAmount: '0', vatRate: '',
        whtRate: null, expenseCategoryId: null, accountHintKey: null, taxCategory: null,
        taxCodeDefinitionId: null, externalTaxCode: null, transactionContext: 'DOMESTIC_PURCHASE' as const,
      }],
    };
    const filled = applyExpenseAiSuggestion(typed, expenseAiSuggestion(summary)!);
    assert.equal(filled.vendorNameSnapshot, 'ร้านที่ผู้ตรวจพิมพ์เอง');
    assert.equal(filled.vendorDocumentNumber, '260705-02-17420');
    assert.deepEqual(filled.lines, typed.lines);
  });
});

describe('postingErrorText', () => {
  it('translates the ledger code the API stores', () => {
    assert.equal(
      postingErrorText('posting_rule_missing'),
      'ยังไม่ได้กำหนดกฎการลงบัญชีสำหรับเอกสารประเภทนี้ ตั้งค่ากฎการลงบัญชีก่อน',
    );
  });

  it('keeps the account id that codes carry after the colon', () => {
    assert.equal(postingErrorText('account_not_found:5100'), 'ไม่พบรหัสบัญชีที่กฎการลงบัญชีอ้างถึง ตรวจผังบัญชี (5100)');
  });

  it('passes through the Thai sentence the auto-post worker writes', () => {
    const written = 'ลงบัญชีอัตโนมัติไม่สำเร็จ (AUTO_POST_FAILED)';
    assert.equal(postingErrorText(written), written);
  });

  it('returns null when nothing is stored', () => {
    assert.equal(postingErrorText(null), null);
    assert.equal(postingErrorText(''), null);
  });
});

// Spec S1-R4: the review form must be able to tell "AI picked this and the server applied it"
// (already in `detail.expenseCategoryId`) from "AI picked this and nobody applied it" — the second
// is what this reader carries, and it is the only source for the recommended-category option.
describe('expenseAiCategorySuggestion', () => {
  const suggestion = { expenseCategoryId: 'cat-meals', confidence: 0.42, categoryName: 'ค่าอาหาร' };

  it('reads a below-threshold suggestion as well as an auto-filled one', () => {
    assert.deepEqual(expenseAiCategorySuggestion({ categorySuggestion: suggestion }), suggestion);
    assert.deepEqual(
      expenseAiCategorySuggestion({ status: 'OCR_EXTRACTED_NEEDS_REVIEW', categorySuggestion: { ...suggestion, confidence: 0.97 } }),
      { ...suggestion, confidence: 0.97 },
    );
  });

  it('shows nothing rather than guessing when the summary carries no usable suggestion', () => {
    assert.equal(expenseAiCategorySuggestion(null), null);
    assert.equal(expenseAiCategorySuggestion({ status: 'OCR_EXTRACTED_NEEDS_REVIEW' }), null);
    for (const categorySuggestion of [
      'cat-meals',
      [suggestion],
      { ...suggestion, categoryName: '  ' },
      { ...suggestion, expenseCategoryId: '' },
      { ...suggestion, confidence: '0.42' },
      { expenseCategoryId: 'cat-meals', confidence: 0.42 },
    ]) {
      assert.equal(expenseAiCategorySuggestion({ categorySuggestion }), null, `expected ${JSON.stringify(categorySuggestion)} to read as none`);
    }
  });
});

it('counts a personal source and its claim projection once, including either side alone', () => {
  const source: any = { id: 'source', status: 'READY_FOR_CONFIRMATION', grandTotalAmount: '125', vatAmount: '0', outstandingAmount: '125', paymentStatus: 'UNPAID', reimbursementProgress: { status: 'PAID' } };
  const projection: any = { id: 'projection', costSourceExpenseId: 'source', status: 'CONFIRMED', grandTotalAmount: '125', vatAmount: '0', outstandingAmount: '0', paymentStatus: 'PAID' };
  for (const rows of [[source, projection], [projection, source], [source], [projection]]) {
    const kpi = summarizeExpenseKpis(rows, '2026-09-11');
    assert.equal(kpi.total, 125);
    assert.equal(kpi.pending, 0);
    assert.equal(kpi.outstanding, 0);
    assert.equal(kpi.counted, 1);
  }
});


describe('receipt review document date', () => {
  it('does not promote an unknown storage date into a user input', () => {
    const detail = { status: 'NEEDS_REVIEW', expenseDate: '2026-09-17T00:00:00Z', lines: [], vatMode: 'NO_VAT', aiVerificationSummaryJson: { dateStatus: 'unverified' } } as unknown as ExpenseDetail;
    assert.equal(reviewValues(detail).expenseDate, '');
    assert.equal(reviewValues({ ...detail, aiVerificationSummaryJson: { dateStatus: 'verified' } }).expenseDate, '2026-09-17');
    assert.equal(reviewValues({ ...detail, aiVerificationSummaryJson: null }).expenseDate, '2026-09-17', 'legacy known dates remain unchanged');
  });
});

// Correction & replacement plan §5.2/§5.3: mirrors accounts-payable.model.ts's own tests for the
// same two predicates — a thin per-module copy, same behavior.
describe('canCorrectWhtCertificate / canIssueWhtReplacementCopy (Expenses)', () => {
  const issued = { status: 'SYSTEM_ISSUED', certificateId: 'cert-1', systemCorrectionOpen: true, systemReplacementOpen: true };

  it('canCorrectWhtCertificate needs SYSTEM_ISSUED + certificateId + systemCorrectionOpen + the permission', () => {
    assert.equal(canCorrectWhtCertificate(issued, ['wht.certificate.correct']), true);
    assert.equal(canCorrectWhtCertificate(issued, []), false);
    assert.equal(canCorrectWhtCertificate({ ...issued, systemCorrectionOpen: false }, ['wht.certificate.correct']), false);
    assert.equal(canCorrectWhtCertificate({ ...issued, certificateId: null }, ['wht.certificate.correct']), false);
  });

  it('canIssueWhtReplacementCopy needs SYSTEM_ISSUED + certificateId + systemReplacementOpen + the permission', () => {
    assert.equal(canIssueWhtReplacementCopy(issued, ['wht.certificate.correct']), true);
    assert.equal(canIssueWhtReplacementCopy(issued, []), false);
    assert.equal(canIssueWhtReplacementCopy({ ...issued, systemReplacementOpen: false }, ['wht.certificate.correct']), false);
  });

  it('never shows for a status other than SYSTEM_ISSUED', () => {
    for (const status of ['REQUIRED', 'EXTERNAL_LINKED', 'CANCELLED']) {
      assert.equal(canCorrectWhtCertificate({ ...issued, status }, ['wht.certificate.correct']), false, status);
      assert.equal(canIssueWhtReplacementCopy({ ...issued, status }, ['wht.certificate.correct']), false, status);
    }
  });
});


describe('receipt document evidence answer', () => {
  for (const type of Object.keys(expenseModel.SOURCE_DOCUMENT_TYPE_LABELS)) {
    it(`${type} preserves the saved evidence answer without a browser preset`, () => {
      const checks = expenseModel.deriveExpenseAuditChecks({ sourceDocumentType: type, taxEvidenceStatus: 'NOT_TAX_EVIDENCE',
        lines: [], vatMode: 'NO_VAT', vatAmount: '0', taxableAmount: '0', duplicateStatus: 'NO_MATCH', aiVerificationSummaryJson: null } as any);
      assert.equal(checks.find(check => check.key === 'tax_evidence')?.label, 'หลักฐานรายจ่าย: ใช้ไม่ได้');
    });
  }
});

describe('receipt uploader missing fields', () => {
  const detail = { status: 'NEEDS_REVIEW', createdByUserId: 'sender', vendorNameSnapshot: null, expenseDate: '2026-10-13', aiVerificationSummaryJson: { missingFields: ['vendorName', 'expenseDate', 'amount'] }, lines: [], vatMode: 'NO_VAT' } as any;
  it('only lets an originating sender with draft-update rights fill missing source fields', () => {
    assert.deepEqual(expenseModel.receiptDraftMissingFields(detail, 'sender', { canUpdate: true }), { vendor: true, date: true, amount: true });
    for (const [userId, canUpdate, status] of [['other', true, 'NEEDS_REVIEW'], ['sender', false, 'NEEDS_REVIEW'], ['sender', true, 'CONFIRMED']]) {
      assert.equal(expenseModel.receiptDraftMissingFields({ ...detail, status } as any, userId as string, { canUpdate: canUpdate as boolean }), null);
    }
    assert.equal(expenseModel.receiptDraftMissingFields({ ...detail, vendorNameSnapshot: 'ร้าน', lines: [{ unitPrice: '20' }], aiVerificationSummaryJson: null }, 'sender', { canUpdate: true }), null);
  });
  it('patches only the missing source fields and uses the existing line calculation contract', () => {
    assert.deepEqual(expenseModel.receiptDraftFillPayload(detail, { vendor: true, date: true, amount: true }, { vendor: 'ร้าน', date: '2026-10-12', amount: '120.50' }), {
      vendorNameSnapshot: 'ร้าน', expenseDate: '2026-10-12',
      lines: [{ lineNumber: 1, description: 'ค่าใช้จ่ายตามใบเสร็จ', chargeKind: null, quantity: '1', unitPrice: '120.50', discountAmount: '0' }],
    });
    assert.deepEqual(expenseModel.receiptDraftFillPayload(detail, { vendor: true, date: false, amount: false }, { vendor: 'ร้าน', date: 'wrong', amount: '999' }), { vendorNameSnapshot: 'ร้าน' });
  });
});


describe('no receipt presentation', () => {
  for (const receiptProblem of ['NOT_AVAILABLE', 'LOST'] as const) it(`shows ${receiptProblem} without an invented tax choice or document number demand`, () => {
    const source: any = { sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'MANUAL_OVERRIDE', lines: [],
      aiVerificationSummaryJson: { documentReview: { assessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem, reason: 'ไม่มีใบเสร็จ', attachmentIds: [] } } } };
    const checks = expenseModel.deriveExpenseAuditChecks(source);
    assert.equal(expenseModel.expenseSourceDocumentLabel(source), 'ไม่มีใบเสร็จ');
    assert.equal(checks.find(row => row.key === 'receipt')?.label, receiptProblem === 'LOST' ? 'ใบเสร็จหาย' : 'ไม่มีใบเสร็จ');
    assert.equal(checks.find(row => row.key === 'receipt')?.detail, 'ยังไม่ได้ทำใบรับรองแทนใบเสร็จ');
    assert.ok(!checks.some(row => ['tax_evidence', 'document_number'].includes(row.key)));
    assert.notEqual(expenseModel.expenseSourceDocumentLabel({ ...source, aiVerificationSummaryJson: null }), 'ไม่มีใบเสร็จ');
  });
});

describe('LIST-1 expense list status', () => {
  it('shows one work status for every expense/payment state', () => {
    for (const status of ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'VOIDED'] as const) {
      for (const paymentStatus of ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOIDED'] as const) {
        const expected = status === 'VOIDED' ? 'ยกเลิก' : status === 'REJECTED' ? 'ปฏิเสธ' : status !== 'CONFIRMED' ? 'รอตรวจ'
          : paymentStatus === 'PAID' ? 'จ่ายแล้ว' : paymentStatus === 'PARTIALLY_PAID' ? 'จ่ายบางส่วน' : 'รอจ่าย';
        assert.equal(expenseModel.expenseListStatus({ status, paymentStatus }).label, expected);
      }
    }
  });
  it('opens a legacy day link in that month and ignores an invalid day', () => {
    assert.equal(expenseModel.expenseListMonth('2026-09-30', '2026-10'), '2026-09');
    assert.equal(expenseModel.expenseListMonth('2024-02-29', '2026-10'), '2024-02');
    for (const day of [null, '', '2026-02-30', 'bad']) assert.equal(expenseModel.expenseListMonth(day, '2026-10'), '2026-10');
  });
});

it('LIST-1 keeps the overpayment warning and claim progress instead of inventing another action', () => {
  assert.equal(expenseModel.expenseListStatus({ status: 'CONFIRMED', paymentStatus: 'PAID', paidAmount: '700', netPayableAmount: '500' }).label, 'จ่ายเกินยอดสุทธิ');
  assert.equal(expenseModel.expenseListStatus({ status: 'DRAFT', paymentStatus: 'UNPAID', reimbursementProgress: { status: 'PAID' } }).label, 'จ่ายคืนแล้ว');
});
