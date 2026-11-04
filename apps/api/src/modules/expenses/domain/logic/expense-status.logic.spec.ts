import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  validateStatusTransition,
  validateConfirm,
  derivePostingStatus,
  buildIdempotencyKey,
  hasBlockingNonExpenseClassification,
  validateDomesticInputVatEvidence,
  hasMissingClaimableVatTaxSnapshot,
  hasUnknownVatRateLine,
  expenseTaxSourceChecksum,
  readAiCategorySuggestion,
  normalizeWhtRemittance,
  eWhtRemittanceAllowed,
} from './expense-status.logic';

describe('R19 shop e-WHT setting', () => {
  it('allows existing e-WHT after disabling and requires enablement only for a new e-WHT choice', () => {
    for (const requested of ['PAYER_FILES', null, undefined]) for (const shopUsesEWht of [true, false]) {
      assert.equal(eWhtRemittanceAllowed({ requested, stored: null, shopUsesEWht }), true);
    }
    assert.equal(eWhtRemittanceAllowed({ requested: 'E_WHT', stored: null, shopUsesEWht: false }), false);
    assert.equal(eWhtRemittanceAllowed({ requested: 'E_WHT', stored: 'PAYER_FILES', shopUsesEWht: false }), false);
    assert.equal(eWhtRemittanceAllowed({ requested: 'E_WHT', stored: null, shopUsesEWht: true }), true);
    assert.equal(eWhtRemittanceAllowed({ requested: 'E_WHT', stored: 'E_WHT', shopUsesEWht: false }), true);
  });
});

describe('normalizeWhtRemittance (R1)', () => {
  it('keeps explicit remittance and legacy null only when tax is withheld', () => {
    for (const value of ['PAYER_FILES', 'E_WHT', null, undefined]) {
      assert.equal(normalizeWhtRemittance(value, '0.0000'), null);
      assert.equal(normalizeWhtRemittance(value, '3.00'), value ?? null);
    }
  });
  it('rejects unsupported values, including on a zero-WHT expense', () => {
    for (const value of ['', 'BANK', 1, {}, ['E_WHT']]) for (const amount of ['0', '3']) {
      assert.throws(() => normalizeWhtRemittance(value, amount), (error: any) =>
        error.getStatus() === 400 && error.getResponse().code === 'expense_wht_remittance_invalid');
    }
  });
});

describe('expenseTaxSourceChecksum', () => {
  it('protects WHT source units and accepted line money at confirmation', () => {
    const expense = { id: 'expense-1', expenseDate: new Date('2026-08-27'),
      whtInputJson: { inputType: 'RATE', value: '3', origin: 'REVIEWER' },
      lines: [{ id: 'line-1', lineNumber: 1, taxableAmount: '100', whtRate: '0.03', whtAmount: '3' }],
    } as any;
    const token = expenseTaxSourceChecksum(expense);
    assert.notEqual(token, expenseTaxSourceChecksum({ ...expense, whtRemittance: 'E_WHT' }));
    assert.notEqual(token, expenseTaxSourceChecksum({ ...expense, whtInputJson: { ...expense.whtInputJson, inputType: 'AMOUNT' } }));
    assert.notEqual(token, expenseTaxSourceChecksum({ ...expense, lines: [{ ...expense.lines[0], whtAmount: '3.01' }] }));
    assert.notEqual(token, expenseTaxSourceChecksum({ ...expense, lines: [{ ...expense.lines[0], whtCategoryCode: 'WHT_RENT' }] }));
  });

  it('protects zero-treatment meaning even when the numeric amounts do not change', () => {
    const expense = {
      id: 'expense-1', expenseDate: new Date('2026-08-27T00:00:00.000Z'),
      lines: [{ id: 'line-1', lineNumber: 1, taxableAmount: '100', vatRate: '0', vatAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '100' }],
    } as any;
    const legacy = expenseTaxSourceChecksum(expense);
    assert.equal(legacy, expenseTaxSourceChecksum({ ...expense, lines: [{ ...expense.lines[0], vatTreatment: null }] }));
    const checksums = ['ZERO_RATED', 'EXEMPT', 'NON_VAT'].map((vatTreatment) =>
      expenseTaxSourceChecksum({ ...expense, lines: [{ ...expense.lines[0], vatTreatment }] }));
    assert.equal(new Set([legacy, ...checksums]).size, 4);
  });

  it('changes when the verified evidence bytes checksum changes', () => {
    const expense = {
      id: 'expense-1', companyId: 'co-1', branchId: null, status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'NO_MATCH',
      expenseDate: new Date('2026-07-18T00:00:00.000Z'), currency: 'THB', sourceDocumentType: 'RECEIPT',
      taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE', primaryAttachmentId: 'att-1',
      missingReceiptReason: null, vendorTaxIdSnapshot: null, vendorDocumentNumber: null, lines: [],
      attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary', checksumSha256: 'a'.repeat(64) }],
      substituteReceiptEvidence: null,
    } as any;

    assert.notEqual(
      expenseTaxSourceChecksum(expense),
      expenseTaxSourceChecksum({
        ...expense,
        attachments: [{ ...expense.attachments[0], checksumSha256: 'b'.repeat(64) }],
      }),
    );
  });

  it('changes when VAT source reconciliation changes', () => {
    const expense = {
      id: 'expense-1', companyId: 'co-1', branchId: null, status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'NO_MATCH',
      expenseDate: new Date('2026-07-18T00:00:00.000Z'), currency: 'THB', sourceDocumentType: 'RECEIPT',
      taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE', primaryAttachmentId: null,
      missingReceiptReason: 'cash bill', vendorTaxIdSnapshot: null, vendorDocumentNumber: null, lines: [],
      attachments: [], substituteReceiptEvidence: null, vatCaptureSnapshotJson: null,
    } as any;
    assert.notEqual(
      expenseTaxSourceChecksum(expense),
      expenseTaxSourceChecksum({ ...expense, vatCaptureSnapshotJson: { version: 1, reconciliation: { status: 'MATCHED' } } }),
    );
  });
});

describe('validateDomesticInputVatEvidence', () => {
  const validTaxInvoice = {
    sourceDocumentType: 'TAX_INVOICE',
    taxEvidenceStatus: 'USABLE_FOR_TAX',
    inputVatClaimStatus: 'CLAIMABLE',
    primaryAttachmentId: 'att-tax-invoice',
    vendorTaxIdSnapshot: '0100000000001',
    vendorDocumentNumber: 'TAX-INV-1',
    lines: [{ taxCodeDefinitionId: 'tax-o7', transactionContext: 'DOMESTIC_PURCHASE' }],
  };

  it('allows domestic input VAT only with a reviewed usable tax invoice', () => {
    assert.equal(validateDomesticInputVatEvidence(validTaxInvoice), null);
  });

  it('blocks Tax Codes on receipts, substitute receipts, and supporting-only evidence', () => {
    assert.match(validateDomesticInputVatEvidence({
      ...validTaxInvoice,
      sourceDocumentType: 'RECEIPT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
    }) ?? '', /cannot retain a Tax Code/);
    assert.match(validateDomesticInputVatEvidence({
      ...validTaxInvoice,
      sourceDocumentType: 'SUPPLIER_BILL',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      inputVatClaimStatus: 'NON_CLAIMABLE',
    }) ?? '', /cannot retain a Tax Code/);
  });

  // Spec §19h: the block is on the document TYPE, so it survives a reviewer who moves the evidence
  // status. This fixture is the reported Starbucks slip with every full-form field present — it
  // would pass every other gate — and it must still be refused.
  it('blocks a Tax Code on an abbreviated tax invoice even when marked usable for tax', () => {
    assert.match(validateDomesticInputVatEvidence({
      ...validTaxInvoice,
      sourceDocumentType: 'ABBREVIATED_TAX_INVOICE',
      taxEvidenceStatus: 'USABLE_FOR_TAX',
    }) ?? '', /cannot retain a Tax Code/);
  });

  it('refuses to claim domestic input VAT on an abbreviated tax invoice with no Tax Code', () => {
    assert.match(validateDomesticInputVatEvidence({
      ...validTaxInvoice,
      sourceDocumentType: 'ABBREVIATED_TAX_INVOICE',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      lines: [],
    }) ?? '', /requires a reviewed TAX_INVOICE/);
  });

  it('requires the attachment, supplier tax ID, and tax invoice number', () => {
    assert.match(validateDomesticInputVatEvidence({
      ...validTaxInvoice,
      vendorTaxIdSnapshot: null,
    }) ?? '', /supplier tax ID/);
  });

  // A company that answered "not registered" cannot claim input VAT, however perfect its evidence.
  it('refuses an input VAT claim from a company answered NOT_REGISTERED', () => {
    assert.equal(
      validateDomesticInputVatEvidence({ ...validTaxInvoice, vatStatus: 'NOT_REGISTERED' }),
      'input_vat_not_available_company_not_vat_registered',
    );
  });

  // No UI writes a registration fact yet, so every company in production reads UNKNOWN. Rejecting
  // here would block them all — absence of a fact is not a fact.
  it('requires the shop VAT answer only for claiming', () => {
    assert.equal(validateDomesticInputVatEvidence({ ...validTaxInvoice, vatStatus: 'UNKNOWN' }), 'input_vat_company_registration_unanswered');
    assert.equal(validateDomesticInputVatEvidence({ ...validTaxInvoice, vatStatus: 'REGISTERED' }), null);
    assert.equal(validateDomesticInputVatEvidence(validTaxInvoice), null);
  });

  // The guard is about claiming, not about recording. A non-registered company still records what
  // the receipt printed.
  it('does not block a NOT_REGISTERED company from a non-claimable expense', () => {
    assert.equal(validateDomesticInputVatEvidence({
      ...validTaxInvoice,
      inputVatClaimStatus: 'NON_CLAIMABLE',
      lines: [],
      vatStatus: 'NOT_REGISTERED',
    }), null);
  });

  it('does not apply the domestic tax-invoice rule to an import Tax Code', () => {
    assert.equal(validateDomesticInputVatEvidence({
      ...validTaxInvoice,
      sourceDocumentType: 'SUPPLIER_BILL',
      taxEvidenceStatus: 'NEEDS_REVIEW',
      lines: [{ taxCodeDefinitionId: 'tax-import', transactionContext: 'IMPORT_GOODS' }],
    }), null);
  });
});

describe('hasMissingClaimableVatTaxSnapshot', () => {
  const vatLine = { vatAmount: '7.00', taxSnapshot: null, taxComponents: [] };

  it('does not require a Tax Code snapshot for printed VAT that is non-claimable', () => {
    assert.equal(hasMissingClaimableVatTaxSnapshot('NON_CLAIMABLE', [vatLine]), false);
  });

  it('still requires a complete server-resolved snapshot for claimable VAT', () => {
    assert.equal(hasMissingClaimableVatTaxSnapshot('CLAIMABLE', [vatLine]), true);
    assert.equal(hasMissingClaimableVatTaxSnapshot('CLAIMABLE', [{
      ...vatLine,
      taxSnapshot: { taxCodeDefinitionId: 'tax-o7' },
      taxComponents: [{}],
    }]), false);
  });
});

// Spec §19g decision 1: without this gate the reported Starbucks draft confirms and posts with its
// VAT silently absorbed into the tax base — the OCR grand-total gate cannot see it, because the
// gross is correct and only the split is wrong.
describe('hasUnknownVatRateLine', () => {
  it('blocks a VAT-mode document whose line has no rate', () => {
    assert.equal(hasUnknownVatRateLine('VAT_INCLUDED', [{ vatRate: null }]), true);
    assert.equal(hasUnknownVatRateLine('VAT_EXCLUDED', [{ vatRate: '  ' }]), true);
    assert.equal(hasUnknownVatRateLine('VAT_INCLUDED', [{}]), true);
    assert.equal(hasUnknownVatRateLine('VAT_INCLUDED', [{ vatRate: '0.07' }, { vatRate: null }]), true);
  });

  it('allows an explicit zero rate — a zero-rated supply is a known rate (§19f decision 3)', () => {
    assert.equal(hasUnknownVatRateLine('VAT_EXCLUDED', [{ vatRate: '0' }]), false);
    assert.equal(hasUnknownVatRateLine('VAT_INCLUDED', [{ vatRate: '0.07' }]), false);
  });

  it('does not apply to modes that never assert VAT', () => {
    assert.equal(hasUnknownVatRateLine('NO_VAT', [{ vatRate: null }]), false);
    assert.equal(hasUnknownVatRateLine('EXEMPT', [{ vatRate: null }]), false);
    assert.equal(hasUnknownVatRateLine('NEEDS_REVIEW', [{ vatRate: null }]), false);
  });

  it('is vacuously satisfied by a document with no lines', () => {
    assert.equal(hasUnknownVatRateLine('VAT_INCLUDED', []), false);
  });
});

describe('hasBlockingNonExpenseClassification', () => {
  it('blocks only an unresolved non-expense classification', () => {
    assert.equal(hasBlockingNonExpenseClassification({ status: 'NOT_EXPENSE_DOCUMENT' }), true);
    assert.equal(hasBlockingNonExpenseClassification({ status: 'HUMAN_OVERRIDDEN' }), true);
    assert.equal(hasBlockingNonExpenseClassification({
      status: 'NOT_EXPENSE_DOCUMENT',
      classification: { documentKind: 'QUOTATION' },
      classificationResolution: {
        outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE',
        acknowledged: true,
        reason: 'Verified against the final bill.',
        sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
        resolvedByUserId: 'user-1',
        resolvedAt: '2026-07-13T10:00:00.000Z',
      },
    }), false);
    assert.equal(hasBlockingNonExpenseClassification({
      status: 'NOT_EXPENSE_DOCUMENT',
      classificationResolution: { outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE' },
    }), true);
    assert.equal(hasBlockingNonExpenseClassification({ status: 'OCR_EXTRACTED_NEEDS_REVIEW' }), false);
    assert.equal(hasBlockingNonExpenseClassification(null), false);
  });

  it('unblocks only a complete substitute route bound to a check bill', () => {
    const validCheckBillRoute = {
      status: 'NOT_EXPENSE_DOCUMENT',
      classification: { documentKind: 'ORDER_OR_CHECK_BILL' },
      classificationResolution: {
        outcome: 'ROUTED_TO_SUBSTITUTE_RECEIPT',
        acknowledgedPaidWithoutFinalReceipt: true,
        sourceDocumentKind: 'ORDER_OR_CHECK_BILL',
        resolvedByUserId: 'user-1',
        resolvedAt: '2026-08-25T10:00:00.000Z',
      },
    };

    assert.equal(hasBlockingNonExpenseClassification(validCheckBillRoute), false);
    assert.equal(hasBlockingNonExpenseClassification({
      ...validCheckBillRoute,
      classification: { documentKind: 'QUOTATION' },
    }), true);
    assert.equal(hasBlockingNonExpenseClassification({
      ...validCheckBillRoute,
      classificationResolution: {
        ...validCheckBillRoute.classificationResolution,
        acknowledgedPaidWithoutFinalReceipt: false,
      },
    }), true);
  });
});

describe('canTransition', () => {
  it('DRAFT -> NEEDS_REVIEW allowed', () => {
    assert.equal(canTransition('DRAFT', 'NEEDS_REVIEW'), true);
  });
  it('DRAFT -> CONFIRMED not allowed', () => {
    assert.equal(canTransition('DRAFT', 'CONFIRMED'), false);
  });
  it('CONFIRMED -> VOIDED allowed', () => {
    assert.equal(canTransition('CONFIRMED', 'VOIDED'), true);
  });
  it('CONFIRMED -> DRAFT not allowed', () => {
    assert.equal(canTransition('CONFIRMED', 'DRAFT'), false);
  });
  it('REJECTED reopens to NEEDS_REVIEW only', () => {
    assert.equal(canTransition('REJECTED', 'NEEDS_REVIEW'), true);
    assert.equal(canTransition('REJECTED', 'DRAFT'), false);
    assert.equal(canTransition('REJECTED', 'READY_FOR_CONFIRMATION'), false);
    assert.equal(canTransition('REJECTED', 'CONFIRMED'), false);
  });
  it('VOIDED -> anything not allowed', () => {
    assert.equal(canTransition('VOIDED', 'DRAFT'), false);
  });
});

describe('validateStatusTransition', () => {
  it('returns null when allowed', () => {
    assert.equal(validateStatusTransition('DRAFT', 'NEEDS_REVIEW'), null);
  });
  it('returns error message when denied', () => {
    const err = validateStatusTransition('CONFIRMED', 'DRAFT');
    assert.ok(err !== null);
    assert.ok(err!.includes('Cannot transition'));
  });
});

describe('validateConfirm', () => {
  const validInput = {
    status: 'READY_FOR_CONFIRMATION' as const,
    duplicateStatus: 'NO_MATCH' as const,
    primaryAttachmentId: 'att-1',
    missingReceiptReason: null,
    vendorNameSnapshot: 'Test Vendor',
    vendorDocumentNumber: 'INV-001',
    expenseDate: '2025-01-01',
    grandTotalAmount: '100.0000',
    whtAmount: '0.0000',
    vendorEntityKindSnapshot: null,
    whtCategoryCode: null,
    vatMode: 'NO_VAT',
    inputVatClaimStatus: 'NON_CLAIMABLE',
    hasMissingReceiptPermission: false,
  };

  it('returns null for valid input', () => {
    assert.equal(validateConfirm(validInput), null);
  });

  /**
   * Audit H-11: zero used to pass. The way it arrives is a receipt the AI could not read — the
   * total stays 0 and the OCR cross-check has nothing to compare against, so it never objects. That
   * produced a CONFIRMED ฿0 expense and an auto-posted journal of nothing, and CONFIRMED only moves
   * to VOIDED, so nothing downstream gets a second chance to notice.
   */
  it('blocks a zero total, and says what to do about it', () => {
    const reason = validateConfirm({ ...validInput, grandTotalAmount: '0.0000' });
    assert.ok(reason !== null);
    assert.match(reason!, /greater than zero/);
  });

  it('blocks the other spellings of zero too', () => {
    for (const grandTotalAmount of ['0', '0.00', '-0.0000']) {
      assert.ok(validateConfirm({ ...validInput, grandTotalAmount }) !== null, grandTotalAmount);
    }
  });

  // The smallest real amount still confirms: the rule is "not nothing", not a minimum worth having.
  it('still allows the smallest satang', () => {
    assert.equal(validateConfirm({ ...validInput, grandTotalAmount: '0.0100' }), null);
  });

  it('blocks confirm from wrong status', () => {
    assert.ok(validateConfirm({ ...validInput, status: 'DRAFT' }) !== null);
  });

  it('warns but does not block confirm on the system\'s own duplicate guess', () => {
    // Buying the same thing twice from the same shop on one day is the daily retail pattern, not a
    // duplicate; the warning stays on the record as an OPEN candidate instead of stopping the work.
    assert.equal(validateConfirm({ ...validInput, duplicateStatus: 'POSSIBLE_DUPLICATE' }), null);
  });

  it('blocks confirm only once a person has marked it a duplicate', () => {
    const err = validateConfirm({ ...validInput, duplicateStatus: 'CONFIRMED_DUPLICATE' });
    assert.ok(err !== null && err.includes('duplicate'));
  });

  it('blocks confirm without attachment and no reason', () => {
    const err = validateConfirm({ ...validInput, primaryAttachmentId: null });
    assert.ok(err !== null && err.includes('receipt'));
  });

  it('allows confirm without attachment when missingReceiptReason present and permission granted', () => {
    const r = validateConfirm({ ...validInput, primaryAttachmentId: null, missingReceiptReason: 'lost receipt', hasMissingReceiptPermission: true });
    assert.equal(r, null);
  });

  it('blocks confirm without expenseDate', () => {
    const err = validateConfirm({ ...validInput, expenseDate: null });
    assert.ok(err !== null && err.includes('date'));
  });

  it('blocks a withholding expense whose payee taxpayer class was never captured, and allows it once picked', () => {
    const withheld = { ...validInput, whtAmount: '30.0000' };
    assert.match(validateConfirm(withheld) ?? '', /payee taxpayer class/);
    assert.equal(validateConfirm({ ...withheld, vendorEntityKindSnapshot: 'INDIVIDUAL', whtCategoryCode: 'CAT1' }), null);
    assert.equal(validateConfirm({ ...withheld, vendorEntityKindSnapshot: 'JURISTIC', whtCategoryCode: 'CAT1' }), null);
  });

  // WHT certificate system issuance plan §1.2 (S2): the same last-moment rule, for the income
  // category a 50 ทวิ certificate needs to print.
  it('blocks a withholding expense whose income category was never captured, and allows it once picked', () => {
    const withheld = { ...validInput, whtAmount: '30.0000', vendorEntityKindSnapshot: 'INDIVIDUAL' as const };
    assert.match(validateConfirm(withheld) ?? '', /income category/);
    assert.equal(validateConfirm({ ...withheld, whtCategoryCode: 'CAT1' }), null);
  });

  it('blocks an OCR total mismatch until Finance acknowledges the difference', () => {
    const mismatch = {
      ...validInput,
      grandTotalAmount: '1177.00',
      aiVerifiedFieldsJson: { grandTotalAmount: '1200.00' },
    };
    assert.match(validateConfirm(mismatch) ?? '', /differs from the receipt OCR total/);
    assert.equal(validateConfirm({
      ...mismatch,
      aiVerificationSummaryJson: { totalMismatchResolution: { acknowledged: true, acknowledgedTotalAmount: '1177.0000' } },
    }), null, 'the acknowledged figure matches the stored total at 4dp');
  });

  // The whole point of binding the acknowledgement to a figure: a generic "finance saved this"
  // signal can never expire, so the total could be edited again after acceptance and still confirm.
  it('re-arms the gate when the total moves after it was acknowledged', () => {
    const acknowledged = {
      ...validInput,
      aiVerifiedFieldsJson: { grandTotalAmount: '1200.00' },
      aiVerificationSummaryJson: { totalMismatchResolution: { acknowledged: true, acknowledgedTotalAmount: '1177.00' } },
    };
    assert.equal(validateConfirm({ ...acknowledged, grandTotalAmount: '1177.00' }), null);
    assert.match(validateConfirm({ ...acknowledged, grandTotalAmount: '1099.00' }) ?? '', /differs from the receipt OCR total/);
  });

  it('ignores an unacknowledged or malformed resolution', () => {
    const mismatch = {
      ...validInput,
      grandTotalAmount: '1177.00',
      aiVerifiedFieldsJson: { grandTotalAmount: '1200.00' },
    };
    for (const totalMismatchResolution of [
      { acknowledged: false, acknowledgedTotalAmount: '1177.00' },
      { acknowledged: true, acknowledgedTotalAmount: '' },
      { acknowledged: true },
      'yes',
    ]) {
      assert.match(validateConfirm({ ...mismatch, aiVerificationSummaryJson: { totalMismatchResolution } }) ?? '',
        /differs from the receipt OCR total/, `expected ${JSON.stringify(totalMismatchResolution)} to stay blocked`);
    }
  });

  it('does not treat formatting-only or satang-tolerance differences as mismatches', () => {
    assert.equal(validateConfirm({
      ...validInput,
      grandTotalAmount: '1,200.0000'.replace(',', ''),
      aiVerifiedFieldsJson: { grandTotalAmount: '1,200.04' },
    }), null);
  });
});

describe('derivePostingStatus', () => {
  it('confirmed expense has posting status pending', () => {
    assert.equal(derivePostingStatus('CONFIRMED', 'NO_MATCH'), 'pending');
  });

  it('confirmed duplicate has posting status not_required', () => {
    assert.equal(derivePostingStatus('CONFIRMED', 'CONFIRMED_DUPLICATE'), 'not_required');
  });

  it('draft/rejected/voided has posting status not_required', () => {
    assert.equal(derivePostingStatus('DRAFT', 'NOT_CHECKED'), 'not_required');
    assert.equal(derivePostingStatus('REJECTED', 'NOT_CHECKED'), 'not_required');
    assert.equal(derivePostingStatus('VOIDED', 'NO_MATCH'), 'not_required');
  });
});

describe('buildIdempotencyKey', () => {
  it('builds stable key for event type', () => {
    const key = buildIdempotencyKey('exp-123', 'confirmed');
    assert.equal(key, 'expense:confirmed:exp-123');
  });

  it('differs by event type', () => {
    const k1 = buildIdempotencyKey('exp-123', 'confirmed');
    const k2 = buildIdempotencyKey('exp-123', 'voided');
    assert.notEqual(k1, k2);
  });
});

// Spec S1-R4: the persisted suggestion is the only thing that tells the review form (and the
// override telemetry) what AI proposed. A malformed or missing one must read as "no suggestion",
// never as a partial object a caller could half-trust.
describe('readAiCategorySuggestion', () => {
  const suggestion = { expenseCategoryId: 'cat-meals', confidence: 0.42, categoryName: 'ค่าอาหาร' };

  it('reads a stored suggestion whatever the confidence', () => {
    assert.deepEqual(readAiCategorySuggestion({ categorySuggestion: suggestion }), suggestion);
    assert.deepEqual(
      readAiCategorySuggestion({ categorySuggestion: { ...suggestion, confidence: 0.97 } }),
      { ...suggestion, confidence: 0.97 },
    );
  });

  it('reads nothing from a summary that has none, or from a malformed one', () => {
    assert.equal(readAiCategorySuggestion(null), null);
    assert.equal(readAiCategorySuggestion({}), null);
    for (const categorySuggestion of [
      'cat-meals',
      [suggestion],
      { ...suggestion, expenseCategoryId: '' },
      { ...suggestion, confidence: '0.42' },
      { ...suggestion, confidence: Number.NaN },
      { expenseCategoryId: 'cat-meals', confidence: 0.42 },
    ]) {
      assert.equal(readAiCategorySuggestion({ categorySuggestion }), null, `expected ${JSON.stringify(categorySuggestion)} to read as none`);
    }
  });
});

describe('confirmed expense correction transition', () => {
  it('returns only to review; confirmation and draft remain inaccessible without the correction endpoint gates', () => {
    assert.equal(canTransition('CONFIRMED', 'NEEDS_REVIEW'), true);
    assert.equal(canTransition('CONFIRMED', 'DRAFT'), false);
    assert.equal(canTransition('CONFIRMED', 'READY_FOR_CONFIRMATION'), false);
  });
});

it('accepts the two additional claimable papers with all domestic evidence checks', () => {
 for (const sourceDocumentType of ['CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT']) {
 const facts = { sourceDocumentType, taxEvidenceStatus: 'USABLE_FOR_TAX', inputVatClaimStatus: 'CLAIMABLE', primaryAttachmentId: 'a', vendorTaxIdSnapshot: '1234567890123', vendorDocumentNumber: '1', lines: [], vatStatus: 'REGISTERED' as const };
 assert.equal(validateDomesticInputVatEvidence(facts), null);
 assert.ok(validateDomesticInputVatEvidence({ ...facts, primaryAttachmentId: null }));
 }
});
