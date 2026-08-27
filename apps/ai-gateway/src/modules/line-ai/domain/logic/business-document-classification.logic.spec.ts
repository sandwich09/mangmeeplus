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
});

/** UAT 2026-08-27 (evening): a PTT fuel card slip the model read perfectly was thrown away because
 *  it wrote a free sentence into the code-only `missingRequiredSignals`. An undecodable reason must
 *  reach a human, not delete the turn. */
describe('reason-code tolerance', () => {
  const base = {
    contentKind: 'DOCUMENT', documentFamily: 'PAYMENT_EVIDENCE', documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', confidence: 0.93,
    evidenceSignals: [], amountSignals: [], settlementSignals: [], evidenceRoles: ['PAYMENT_PROOF'],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  };

  it('keeps the classification and escalates to a person when a reason code cannot be decoded', () => {
    const parsed = parseBusinessDocumentClassification(
      { ...base, missingRequiredSignals: ['itemised fuel quantity/litres not shown on this slip'] },
      '',
    );
    assert.ok(parsed, 'the read survives — the slip is not discarded over one field');
    assert.equal(parsed?.documentKind, 'RECEIPT');
    assert.deepEqual(parsed?.missingRequiredSignals, ['HUMAN_REVIEW_REQUIRED']);
    assert.equal(parsed?.requiresClarification, true);
  });

  it('keeps the codes it does understand alongside the escalation', () => {
    const parsed = parseBusinessDocumentClassification(
      { ...base, missingRequiredSignals: ['PAYMENT_EVIDENCE_ONLY', 'something the model made up'] },
      '',
    );
    assert.deepEqual(parsed?.missingRequiredSignals, ['PAYMENT_EVIDENCE_ONLY', 'HUMAN_REVIEW_REQUIRED']);
    assert.equal(parsed?.requiresClarification, true);
  });

  it('an all-known reason array is untouched — no spurious review flag', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, missingRequiredSignals: ['PAYMENT_EVIDENCE_ONLY'] }, '');
    assert.deepEqual(parsed?.missingRequiredSignals, ['PAYMENT_EVIDENCE_ONLY']);
    assert.equal(parsed?.requiresClarification, false);
  });

  it('an undecodable CONTRADICTION also escalates instead of voiding', () => {
    const parsed = parseBusinessDocumentClassification({ ...base, contradictionSignals: ['dates disagree somehow'] }, '');
    assert.ok(parsed);
    assert.deepEqual(parsed?.contradictionSignals, []);
    assert.ok(parsed?.missingRequiredSignals.includes('HUMAN_REVIEW_REQUIRED'));
    assert.equal(parsed?.requiresClarification, true);
  });

  it('a non-array reason field is still invalid SHAPE and still voids the classification', () => {
    assert.equal(parseBusinessDocumentClassification({ ...base, missingRequiredSignals: 'PAYMENT_EVIDENCE_ONLY' }, ''), null);
  });
});
