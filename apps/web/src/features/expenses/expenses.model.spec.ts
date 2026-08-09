import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  postingErrorText,
  buildExpenseDraftReviewPayload,
  formatTaxId,
  taxIdDigits,
  aiGrandTotalValue,
  deriveExpenseClassificationReviewState,
  expenseAiFieldProvenance,
  expenseAiSuggestion,
  applyExpenseAiSuggestion,
  expenseRatePercent,
  hasAcknowledgedAiTotalMismatch,
  hasAiGrandTotalMismatch,
  needsAiTotalAcknowledgement,
  hasUnresolvedDuplicateWarning,
  findOpaqueBounds,
  removeLightBackground,
  allowsDomesticInputTaxCode,
  clearExpenseTaxSelections,
  calculateManualExpenseTotals,
  buildManualExpenseLines,
  vatRateFromPrintedAmount,
  vatRatePreset,
  vatRatePresetValue,
  expensePercentToRate,
  expenseRateToPercent,
  effectiveVatRateLabel,
  TAX_EVIDENCE_REASON_LABELS,
  AI_SUMMARY_STATUS_LABELS,
  AI_MISSING_FIELD_LABELS,
  ATTACHMENT_PURPOSE_LABELS,
  SUBSTITUTE_RECEIPT_STATUS_LABELS,
  expenseValueLabel,
  expenseCapabilities,
  canDeleteExpense,
  canAccessExpenseTab,
  expenseDeleteErrorMessage,
  expenseDeleteTargetLabel,
  isExpensePending,
  summarizeExpenseKpis,
  type ExpenseDraftReviewValues,
} from './expenses.model';

describe('expenses.model', () => {
  it('turns internal expense codes into meaningful Thai labels', () => {
    assert.equal(expenseValueLabel(TAX_EVIDENCE_REASON_LABELS, 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE'), 'บิลเขียนมือหรือข้อความ ต้องจัดทำใบรับรองแทนใบเสร็จรับเงิน');
    assert.equal(expenseValueLabel(AI_SUMMARY_STATUS_LABELS, 'TEXT_NOTE_SEMANTIC_CAPTURE'), 'อ่านข้อมูลจากโน้ตข้อความแล้ว รอตรวจสอบ');
    assert.equal(expenseValueLabel(AI_MISSING_FIELD_LABELS, 'receipt_evidence'), 'หลักฐานใบเสร็จหรือหลักฐานประกอบ');
    assert.equal(expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, 'expense.payment.evidence'), 'หลักฐานการจ่ายเงิน');
    assert.equal(expenseValueLabel(SUBSTITUTE_RECEIPT_STATUS_LABELS, 'PAYER_CERTIFIED'), 'ผู้จ่ายลงนามแล้ว รออนุมัติ');
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
    const summary = {
      recognizedFields: ['vendorName', 'amount', 'vatAmount'],
      missingFields: ['vendorTaxId', 'category'],
    };
    assert.deepEqual(expenseAiFieldProvenance(summary, 'vendorNameSnapshot'), { recognized: true, missing: false });
    assert.deepEqual(expenseAiFieldProvenance(summary, 'total'), { recognized: true, missing: false });
    assert.deepEqual(expenseAiFieldProvenance(summary, 'vendorTaxIdSnapshot'), { recognized: false, missing: true });
    assert.deepEqual(expenseAiFieldProvenance(summary, 'category'), { recognized: false, missing: true });
    assert.equal(expenseAiFieldProvenance(null, 'vendorNameSnapshot'), null);
  });

  it('formats fraction rates as a display-only percentage with at most two decimals', () => {
    assert.equal(expenseRatePercent('0.07'), '7');
    assert.equal(expenseRatePercent('0.07555'), '7.56');
    assert.equal(expenseRatePercent('0'), null);
    assert.equal(expenseRatePercent('abc'), null);
  });

  it('calculates manual-entry VAT and totals from the selected tax mode', () => {
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
      { lineNumber: 2, description: 'ค่าบริการ (Service charge)', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '0.07', taxCodeDefinitionId: 'tax-def-1', externalTaxCode: 'V7', transactionContext: 'DOMESTIC_PURCHASE' },
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
      vendorDocumentNumber: 'INV-1',
      expenseDate: '2026-07-10',
      vatMode: 'VAT_EXCLUDED',
      lines: [{
        lineNumber: 1, description: 'สินค้า', quantity: '2', unitPrice: '150', discountAmount: '10', vatRate: '0.07',
        whtRate: '0.03', expenseCategoryId: 'category-1', accountHintKey: 'expense.office', taxCategory: 'INPUT_VAT',
      }],
    });
    assert.equal('grandTotalAmount' in payload, false);
    assert.equal('subtotalAmount' in payload, false);
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
    assert.equal(vatRatePreset('0'), 'zero');
    assert.equal(vatRatePreset('0.065'), 'custom');

    assert.equal(vatRatePresetValue('standard', ''), '0.07');
    assert.equal(vatRatePresetValue('zero', '0.07'), '0');
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
    assert.equal(expenseCapabilities(['expense.signature.manage']).canManageSignatures, true);
    assert.equal(expenseCapabilities(['expense.signature.approve']).canApproveSignatures, true);
    // Evidence moved off expense.read onto its own key, so expense.read alone no longer grants it.
    assert.equal(expenseCapabilities(['expense.evidence.read']).canViewSharedEvidence, true);
    assert.equal(expenseCapabilities(['expense.read']).canViewSharedEvidence, false);
  });

  it('gates list and evidence tabs with their own view permissions', () => {
    assert.equal(canAccessExpenseTab('list', expenseCapabilities([])), false);
    assert.equal(canAccessExpenseTab('list', expenseCapabilities(['expense.read_own'])), true);
    assert.equal(canAccessExpenseTab('evidence', expenseCapabilities(['expense.read'])), false);
    assert.equal(canAccessExpenseTab('evidence', expenseCapabilities(['expense.evidence.read'])), true);
  });

  it('allows OCR request via expense.ocr.request or expense.review', () => {
    assert.equal(expenseCapabilities(['expense.ocr.request']).canRequestOcr, true);
    assert.equal(expenseCapabilities(['expense.review']).canRequestOcr, true);
    assert.equal(expenseCapabilities(['expense.receipt.upload']).canRequestOcr, false);
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

  it('leaves rejected and voided documents out of the total, the count, and the VAT credit', () => {
    const kpi = summarizeExpenseKpis(rows, '2026-08-05');

    assert.equal(kpi.total, 450);
    assert.equal(kpi.counted, 3);
    // The rejected receipt's ฿11.78 must not read as creditable input tax.
    assert.equal(kpi.vat, 11.78);
    assert.equal(kpi.outstanding, 450);
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
      row({ dueDate: '2026-08-04' }),
      row({ dueDate: '2026-08-05' }),
      row({ dueDate: '2026-08-01', paymentStatus: 'PAID', outstandingAmount: '0.00' }),
      row({ dueDate: '2026-08-01', status: 'VOIDED' }),
    ], '2026-08-05');

    assert.equal(kpi.overdueCount, 1);
    assert.equal(kpi.overdue, 180);
  });
});

describe('expenseDeleteErrorMessage', () => {
  const blockers = [
    ['PAYMENT', 'ข้อมูลการชำระเงิน', 'recorded payment'],
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
        `ลบรายการนี้ไม่ได้ เนื่องจากมีข้อมูลเชื่อมโยง: ${thaiLabel}`,
      );
      assert.equal(
        expenseDeleteErrorMessage(error, 'en'),
        `This expense cannot be deleted because it has linked data: ${englishLabel}.`,
      );
    }
  });

  it('names an unknown blocker and preserves unrelated error fallbacks', () => {
    assert.equal(
      expenseDeleteErrorMessage({
        details: { code: 'EXPENSE_HAS_LINKED_DATA', blocker: 'FUTURE_LINK' },
      }, 'en'),
      'This expense cannot be deleted because it has linked data: FUTURE_LINK.',
    );
    assert.equal(expenseDeleteErrorMessage(new Error('Retention locked.'), 'th'), 'Retention locked.');
    assert.equal(expenseDeleteErrorMessage(null, 'th'), 'เกิดข้อผิดพลาด');
    assert.equal(expenseDeleteErrorMessage(null, 'en'), 'An error occurred.');
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
      'ยังไม่ได้กำหนดกฎการลงบัญชีสำหรับเอกสารประเภทนี้ กรุณาตั้งค่ากฎการลงบัญชีก่อน',
    );
  });

  it('keeps the account id that codes carry after the colon', () => {
    assert.equal(postingErrorText('account_not_found:5100'), 'ไม่พบรหัสบัญชีที่กฎการลงบัญชีอ้างถึง กรุณาตรวจผังบัญชี (5100)');
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
