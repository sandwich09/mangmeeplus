import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBusinessDocumentClassification } from './business-document-classification.logic';

/** UAT 2026-08-27: Sonnet 4.6 labelled a clear receipt's evidenceRoles with document-kind
 *  synonyms ("RECEIPT", "TAX_INVOICE"); the all-or-nothing enum check voided the whole
 *  classification, which voided the whole intake plan, which stranded the media turn. The
 *  descriptive roles array now filters unknown labels; safety-bearing reason codes stay strict. */
describe('evidenceRoles tolerance', () => {
  const base = {
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'TAX_INVOICE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.97,
    evidenceSignals: [], amountSignals: [], settlementSignals: [],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };
  it('filters unknown role labels instead of rejecting the classification', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, evidenceRoles: ['RECEIPT', 'TAX_INVOICE', 'PAYMENT_PROOF'] }, '');
    assert.ok(parsed, 'classification must survive out-of-vocabulary roles');
    assert.deepEqual(parsed?.evidenceRoles, ['PAYMENT_PROOF']);
  });
  it('all-unknown roles yield an empty list, still accepted', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, evidenceRoles: ['RECEIPT'] }, '');
    assert.ok(parsed);
    assert.deepEqual(parsed?.evidenceRoles, []);
  });
  it('a non-array evidenceRoles is still rejected', () => {
    assert.equal(parseBusinessDocumentClassification({ ...base, evidenceRoles: 'PAYMENT_PROOF' }, ''), null);
  });
  it('reason-code arrays stay strict — an unknown reason still voids the classification', () => {
    assert.equal(parseBusinessDocumentClassification({ ...base, evidenceRoles: [], missingRequiredSignals: ['NOT_A_REAL_CODE'] }, ''), null);
  });
});
