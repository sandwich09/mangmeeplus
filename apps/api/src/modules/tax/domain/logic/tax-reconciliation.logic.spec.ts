import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { primaryTaxReportAmount, reconcileTaxFact, taxComponentInForm, unionReconciliationFacts } from './tax-reconciliation.logic';

const base = {
  componentKey: 'VAT' as const, externalTaxCode: 'O1', evidenceStatus: 'VERIFIED', accountAssignmentsPresent: true,
  reportMappingPresent: true, sourceBaseAmount: '100', sourceTaxAmount: '7', eventBaseAmount: '100', eventTaxAmount: '7', journalTaxAmount: '7', reportAmount: '7',
};

describe('tax reconciliation', () => {
  it('matches source, event, journal and report', () => {
    assert.deepEqual(reconcileTaxFact(base), { sourceEventDelta: '0.0000', eventJournalDelta: '0.0000', eventReportDelta: '0.0000', issueCode: 'MATCHED', blocking: false });
  });

  it('compares zero-rated/exempt report base without requiring a journal tax line', () => {
    assert.equal(reconcileTaxFact({ ...base, externalTaxCode: 'O0', sourceTaxAmount: '0', eventTaxAmount: '0', journalTaxAmount: '0', reportAmount: '100' }).issueCode, 'MATCHED');
  });

  it('prioritizes fail-closed configuration and evidence issues', () => {
    assert.equal(reconcileTaxFact({ ...base, accountAssignmentsPresent: false }).issueCode, 'MISSING_ACCOUNT_RULE');
    assert.equal(reconcileTaxFact({ ...base, evidenceStatus: 'REVIEW_REQUIRED' }).issueCode, 'EVIDENCE_PENDING');
    assert.equal(reconcileTaxFact({ ...base, reportMappingPresent: false }).issueCode, 'MISSING_REPORT_RULE');
  });

  it('classifies every amount mismatch and uses a 0.01 tolerance', () => {
    assert.equal(reconcileTaxFact({ ...base, sourceTaxAmount: '7.02' }).issueCode, 'SOURCE_EVENT_MISMATCH');
    assert.equal(reconcileTaxFact({ ...base, journalTaxAmount: '6.98' }).issueCode, 'EVENT_JOURNAL_MISMATCH');
    assert.equal(reconcileTaxFact({ ...base, reportAmount: '6.98' }).issueCode, 'REPORT_MISMATCH');
    assert.equal(reconcileTaxFact({ ...base, sourceTaxAmount: '7.01', journalTaxAmount: '6.99', reportAmount: '7.01' }).issueCode, 'MATCHED');
  });

  it('uses the tolerance snapshotted from the Tax Code profile', () => {
    assert.equal(reconcileTaxFact({ ...base, sourceTaxAmount: '7.04', taxAmountTolerance: '0.05' }).issueCode, 'MATCHED');
    assert.equal(reconcileTaxFact({ ...base, sourceTaxAmount: '7.06', taxAmountTolerance: '0.05' }).issueCode, 'SOURCE_EVENT_MISMATCH');
  });

  it('matches signed credit and debit corrections', () => {
    assert.equal(reconcileTaxFact({ ...base, sourceBaseAmount: '-100', sourceTaxAmount: '-7', eventBaseAmount: '-100', eventTaxAmount: '-7', journalTaxAmount: '-7', reportAmount: '-7' }).issueCode, 'MATCHED');
  });

  it('does not require SAP codes for customs and excise statutory components', () => {
    for (const componentKey of ['CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX'] as const) {
      assert.equal(reconcileTaxFact({ ...base, componentKey, externalTaxCode: null }).issueCode, 'MATCHED');
    }
  });

  it('keeps PP36 output and input as separately reconcilable components', () => {
    const output = reconcileTaxFact({ ...base, componentKey: 'PP36_OUTPUT', sourceTaxAmount: '7', eventTaxAmount: '7', journalTaxAmount: '7', reportAmount: '7' });
    const input = reconcileTaxFact({ ...base, componentKey: 'PP36_INPUT', sourceTaxAmount: '7', eventTaxAmount: '7', journalTaxAmount: '7', reportAmount: '7' });
    assert.equal(output.issueCode, 'MATCHED');
    assert.equal(input.issueCode, 'MATCHED');
  });

  it('unions missing events and orphan journal components by source line', () => {
    const source = { sourceType: 'accounting.document', sourceId: 'doc-1', sourceLineKey: 'line-1', componentKey: 'VAT' as const };
    const event = { ...source, sourceLineKey: 'line-2' };
    const journal = { ...source, sourceLineKey: 'line-3' };
    assert.deepEqual(unionReconciliationFacts([source], [event], [journal]).map((fact) => fact.sourceLineKey), ['line-1', 'line-2', 'line-3']);
  });

  it('keeps multiple lines isolated and preserves negative zero-tax report sign', () => {
    const lines = unionReconciliationFacts(
      [{ sourceType: 'accounting.document', sourceId: 'doc-1', sourceLineKey: 'line-1', componentKey: 'VAT' }],
      [{ sourceType: 'accounting.document', sourceId: 'doc-1', sourceLineKey: 'line-2', componentKey: 'VAT' }],
    );
    assert.equal(lines.length, 2);
    assert.equal(primaryTaxReportAmount([
      { formType: 'PP30', boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE', amount: '-100' },
      { formType: 'PP30', boxKey: 'box_2_zero_rated_sales', amountSource: 'TAX_BASE', amount: '-100' },
    ], '0'), '-100.0000');
  });

  it('keeps customs and excise out of PP30 and in customs support', () => {
    assert.equal(taxComponentInForm('CUSTOMS_DUTY', 'PP30'), false);
    assert.equal(taxComponentInForm('CUSTOMS_DUTY', 'CUSTOMS_SUPPORT'), true);
    assert.equal(taxComponentInForm('IMPORT_VAT', 'PP30'), true);
  });
});
