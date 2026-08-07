import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDraftEditable,
  isTerminalStatus,
  isIssued,
  validateStatusTransition,
  validateIssuableLines,
  validateQuotationApproval,
  initialPostingStatus,
  isEligibleForCorrection,
  validateVoid,
  documentSequenceKey,
  deriveCompatibleOutputTaxCode,
  validateOutputTaxDocument,
  validateCumulativeCreditNote,
} from './accounting-status.logic';

describe('validateOutputTaxDocument', () => {
  it('keeps a plain receipt payment-only', () => {
    assert.match(validateOutputTaxDocument({ documentType: 'RECEIPT', outputTaxCode: 'O7', vatMode: 'VAT_EXCLUDED' }) ?? '', /cannot carry/);
    assert.equal(validateOutputTaxDocument({ documentType: 'RECEIPT', vatMode: 'VAT_INCLUDED', vatAmount: '7.00' }), null);
  });

  it('requires code and amount consistency for tax invoices', () => {
    assert.match(validateOutputTaxDocument({ documentType: 'TAX_INVOICE', outputTaxCode: 'BAD' as any, vatMode: 'NO_VAT' }) ?? '', /Unsupported/);
    assert.match(validateOutputTaxDocument({ documentType: 'TAX_INVOICE', vatMode: 'NO_VAT' }) ?? '', /requires an output Tax Code/);
    assert.equal(validateOutputTaxDocument({ documentType: 'TAX_INVOICE', outputTaxCode: 'O7', vatMode: 'VAT_EXCLUDED', vatAmount: '7.00' }), null);
    assert.match(validateOutputTaxDocument({ documentType: 'TAX_INVOICE', outputTaxCode: 'O7', vatMode: 'VAT_EXCLUDED', vatAmount: '0' }) ?? '', /positive VAT/);
  });

  it('accepts an S/4 or custom line definition without a legacy header code', () => {
    assert.equal(validateOutputTaxDocument({
      documentType: 'TAX_INVOICE', vatMode: 'VAT_EXCLUDED', vatAmount: '7.00',
      lines: [{ taxCodeDefinitionId: 's4-o1-definition', externalTaxCode: 'O1' }],
    }), null);
  });

  it('rejects a legacy header that disagrees with authoritative line Tax Codes', () => {
    assert.equal(validateOutputTaxDocument({
      documentType: 'TAX_INVOICE', outputTaxCode: 'O7', vatMode: 'VAT_EXCLUDED', vatAmount: '7.00',
      lines: [{ taxCodeDefinitionId: 's4-o1-definition', externalTaxCode: 'O1' }],
    }), 'output_tax_code_line_mismatch');
    assert.equal(validateOutputTaxDocument({
      documentType: 'TAX_INVOICE', outputTaxCode: 'O7', vatMode: 'VAT_EXCLUDED', vatAmount: '7.00',
      lines: [{ taxSnapshot: { taxCodeDefinitionId: 's4-o1-definition', externalTaxCode: 'O1' } }],
    }), 'output_tax_code_line_mismatch');
  });

  it('derives a compatibility header only when every line has the same legacy code', () => {
    assert.equal(deriveCompatibleOutputTaxCode([
      { taxCodeDefinitionId: 'legacy-o7-a', externalTaxCode: 'O7' },
      { taxCodeDefinitionId: 'legacy-o7-b', externalTaxCode: 'O7' },
    ]), 'O7');
    assert.equal(deriveCompatibleOutputTaxCode([
      { taxCodeDefinitionId: 's4-o1', externalTaxCode: 'O1' },
    ]), undefined);
    assert.equal(deriveCompatibleOutputTaxCode([
      { taxCodeDefinitionId: 'legacy-o7', externalTaxCode: 'O7' },
      { taxCodeDefinitionId: 'legacy-ox', externalTaxCode: 'OX' },
    ]), undefined);
  });

  it('keeps a plain invoice outside transaction-tax lines', () => {
    assert.match(validateOutputTaxDocument({
      documentType: 'INVOICE', vatMode: 'VAT_EXCLUDED',
      lines: [{ taxCodeDefinitionId: 's4-o1-definition', externalTaxCode: 'O1' }],
    }) ?? '', /plain invoice/i);
  });

  it('rejects line Tax Codes on receipt-like non-tax documents', () => {
    for (const documentType of ['RECEIPT', 'QUOTATION', 'BILLING_NOTE'] as const) {
      assert.match(validateOutputTaxDocument({
        documentType, vatMode: 'NO_VAT', lines: [{ taxCodeDefinitionId: 'forged-definition' }],
      }) ?? '', /cannot carry/);
    }
  });

  it('allows a receipt/tax invoice only through an issued receipt source', () => {
    assert.equal(validateOutputTaxDocument(
      { documentType: 'TAX_INVOICE', outputTaxCode: 'O0', vatMode: 'NO_VAT', vatAmount: '0', sourceDocumentId: 'receipt-1', sourceDocumentType: 'RECEIPT' },
      { documentType: 'RECEIPT', status: 'ISSUED' },
    ), null);
  });

  it('binds credit notes to the issued original tax invoice with the same code', () => {
    const credit = { documentType: 'CREDIT_NOTE' as const, outputTaxCode: 'O7' as const, vatMode: 'VAT_EXCLUDED' as const, vatAmount: '7', sourceDocumentId: 'tax-1', sourceDocumentType: 'TAX_INVOICE' };
    assert.equal(validateOutputTaxDocument(credit, { documentType: 'TAX_INVOICE', status: 'ISSUED', outputTaxCode: 'O7' }), null);
    assert.match(validateOutputTaxDocument(credit, { documentType: 'TAX_INVOICE', status: 'ISSUED', outputTaxCode: 'OX' }) ?? '', /must match/);
    assert.match(validateOutputTaxDocument({ ...credit, sourceDocumentType: 'CREDIT_NOTE' }, { documentType: 'CREDIT_NOTE', status: 'ISSUED', outputTaxCode: 'O7' }) ?? '', /original TAX_INVOICE/);
  });
});

describe('validateIssuableLines', () => {
  it('rejects a document with zero lines', () =>
    assert.equal(validateIssuableLines(0), 'Cannot issue a document with no line items'));
  it('allows a document with at least one line', () =>
    assert.equal(validateIssuableLines(1), null));
});

describe('isDraftEditable', () => {
  it('true for DRAFT', () => assert.equal(isDraftEditable('DRAFT'), true));
  it('false for ISSUED', () => assert.equal(isDraftEditable('ISSUED'), false));
  it('false for PENDING_APPROVAL', () => assert.equal(isDraftEditable('PENDING_APPROVAL'), false));
});

describe('isTerminalStatus', () => {
  it('true for VOIDED', () => assert.equal(isTerminalStatus('VOIDED'), true));
  it('true for CLOSED', () => assert.equal(isTerminalStatus('CLOSED'), true));
  it('false for ISSUED', () => assert.equal(isTerminalStatus('ISSUED'), false));
});

describe('isIssued', () => {
  it('true for ISSUED', () => assert.equal(isIssued('ISSUED'), true));
  it('true for CREDITED', () => assert.equal(isIssued('CREDITED'), true));
  it('false for DRAFT', () => assert.equal(isIssued('DRAFT'), false));
});

describe('validateStatusTransition', () => {
  it('allows DRAFT -> PENDING_APPROVAL for quotation', () => {
    assert.equal(validateStatusTransition('DRAFT', 'PENDING_APPROVAL', 'QUOTATION'), null);
  });
  it('allows APPROVED -> ISSUED for quotation', () => {
    assert.equal(validateStatusTransition('APPROVED', 'ISSUED', 'QUOTATION'), null);
  });
  it('blocks DRAFT -> ISSUED for quotation (must go through approval)', () => {
    assert.ok(validateStatusTransition('DRAFT', 'ISSUED', 'QUOTATION') !== null);
  });
  it('allows DRAFT -> ISSUED for invoice (no approval needed)', () => {
    assert.equal(validateStatusTransition('DRAFT', 'ISSUED', 'INVOICE'), null);
  });
  it('blocks non-quotation from PENDING_APPROVAL status', () => {
    assert.ok(validateStatusTransition('DRAFT', 'PENDING_APPROVAL', 'INVOICE') !== null);
  });
  it('blocks transition from VOIDED', () => {
    assert.ok(validateStatusTransition('VOIDED', 'DRAFT', 'INVOICE') !== null);
  });
  it('allows ISSUED -> VOIDED', () => {
    assert.equal(validateStatusTransition('ISSUED', 'VOIDED', 'INVOICE'), null);
  });
  it('allows REJECTED -> DRAFT (revise and resubmit)', () => {
    assert.equal(validateStatusTransition('REJECTED', 'DRAFT', 'QUOTATION'), null);
  });
});

describe('validateQuotationApproval', () => {
  it('returns error if same user', () => {
    assert.ok(validateQuotationApproval('user1', 'user1') !== null);
  });
  it('returns null if different users', () => {
    assert.equal(validateQuotationApproval('user1', 'user2'), null);
  });
});

describe('initialPostingStatus', () => {
  it('not_required for quotation', () => {
    assert.equal(initialPostingStatus('QUOTATION', 'ISSUED'), 'not_required');
  });
  it('not_required for unissued document', () => {
    assert.equal(initialPostingStatus('INVOICE', 'DRAFT'), 'not_required');
  });
  it('pending for issued invoice', () => {
    assert.equal(initialPostingStatus('INVOICE', 'ISSUED'), 'pending');
  });
  it('pending for issued receipt', () => {
    assert.equal(initialPostingStatus('RECEIPT', 'ISSUED'), 'pending');
  });
  it('pending for credit note', () => {
    assert.equal(initialPostingStatus('CREDIT_NOTE', 'ISSUED'), 'pending');
  });
});

describe('isEligibleForCorrection', () => {
  it('true for ISSUED', () => assert.equal(isEligibleForCorrection('ISSUED'), true));
  it('true for CREDITED', () => assert.equal(isEligibleForCorrection('CREDITED'), true));
  it('false for DRAFT', () => assert.equal(isEligibleForCorrection('DRAFT'), false));
  it('false for VOIDED', () => assert.equal(isEligibleForCorrection('VOIDED'), false));
});

describe('validateCumulativeCreditNote', () => {
  const original = [{ lineNumber: 1, taxBaseAmount: '100', transactionTaxAmount: '7' }];
  it('allows only the remaining original amount after earlier credits', () => {
    const history = [{ documentType: 'CREDIT_NOTE' as const, lines: [{ lineNumber: 1, taxBaseAmount: '-40', transactionTaxAmount: '-2.8' }] }];
    assert.equal(validateCumulativeCreditNote(original, [{ lineNumber: 1, taxBaseAmount: '-60', transactionTaxAmount: '-4.2' }], history), null);
    assert.match(validateCumulativeCreditNote(original, [{ lineNumber: 1, taxBaseAmount: '-61', transactionTaxAmount: '-4.2' }], history) ?? '', /exceeds/);
  });
  it('adds issued debit-note increases to the available credit capacity', () => {
    const history = [{ documentType: 'DEBIT_NOTE' as const, lines: [{ lineNumber: 1, taxBaseAmount: '20', transactionTaxAmount: '1.4' }] }];
    assert.equal(validateCumulativeCreditNote(original, [{ lineNumber: 1, taxBaseAmount: '-120', transactionTaxAmount: '-8.4' }], history), null);
  });
});

describe('validateVoid', () => {
  it('returns error for short reason', () => assert.ok(validateVoid('ISSUED', 'ab') !== null));
  it('returns null for valid reason on issued', () => assert.equal(validateVoid('ISSUED', 'mistake made'), null));
  it('returns error for VOIDED document', () => assert.ok(validateVoid('VOIDED', 'reason') !== null));
  it('returns error for CLOSED document', () => assert.ok(validateVoid('CLOSED', 'reason') !== null));
});

describe('documentSequenceKey', () => {
  it('returns correct key for QUOTATION', () => assert.equal(documentSequenceKey('QUOTATION'), 'accounting.quotation'));
  it('returns correct key for TAX_INVOICE', () => assert.equal(documentSequenceKey('TAX_INVOICE'), 'tax.invoice'));
  it('returns correct key for CREDIT_NOTE', () => assert.equal(documentSequenceKey('CREDIT_NOTE'), 'accounting.credit_note'));
});
