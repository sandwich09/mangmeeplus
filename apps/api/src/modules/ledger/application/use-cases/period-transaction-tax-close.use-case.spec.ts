import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transactionTaxCloseIssueCount } from './period.use-case.js';

const eventAt = new Date('2026-07-10T00:00:00Z');
const events = [{ componentKey: 'VAT', branchId: null, updatedAt: eventAt }];

describe('transaction-tax period close gate', () => {
  it('blocks when an applicable form has no reconciliation', () => {
    assert.equal(transactionTaxCloseIssueCount(events, []), 1);
  });

  it('blocks a generated but unreviewed reconciliation', () => {
    assert.equal(transactionTaxCloseIssueCount(events, [{
      formType: 'PP30', branchId: null, status: 'GENERATED', blockingIssueCount: 0, createdAt: new Date('2026-07-11T00:00:00Z'),
    }]), 1);
  });

  it('accepts a fresh reviewed company-wide reconciliation', () => {
    assert.equal(transactionTaxCloseIssueCount(events, [{
      formType: 'PP30', branchId: null, status: 'REVIEWED', blockingIssueCount: 0, createdAt: new Date('2026-07-11T00:00:00Z'),
    }]), 0);
  });

  it('blocks a reviewed run that predates the latest tax event', () => {
    assert.equal(transactionTaxCloseIssueCount(events, [{
      formType: 'PP30', branchId: null, status: 'REVIEWED', blockingIssueCount: 0, createdAt: new Date('2026-07-01T00:00:00Z'),
    }]), 1);
  });

  it('requires reviewed coverage for every branch unless a company-wide run covers all', () => {
    const branchEvents = [
      { componentKey: 'VAT', branchId: 'b1', updatedAt: eventAt },
      { componentKey: 'VAT', branchId: 'b2', updatedAt: eventAt },
    ];
    const b1Only = [{ formType: 'PP30', branchId: 'b1', status: 'REVIEWED', blockingIssueCount: 0, createdAt: new Date('2026-07-11T00:00:00Z') }];
    assert.equal(transactionTaxCloseIssueCount(branchEvents, b1Only), 1);
    assert.equal(transactionTaxCloseIssueCount(branchEvents, [{ ...b1Only[0]!, branchId: null }]), 0);
  });

  it('blocks a paid PP36 source even before its event or journal has been generated', () => {
    const paidSourceFacts = [
      { componentKey: 'PP36_OUTPUT', branchId: 'b1', updatedAt: new Date('2026-08-15T00:00:00Z') },
      { componentKey: 'PP36_INPUT', branchId: 'b1', updatedAt: new Date('2026-08-15T00:00:00Z') },
    ];
    assert.equal(transactionTaxCloseIssueCount(paidSourceFacts, []), 2);
  });

  it('requires customs-support reconciliation for assessed import components', () => {
    const customs = [{ componentKey: 'CUSTOMS_DUTY', branchId: null, updatedAt: eventAt }];
    assert.equal(transactionTaxCloseIssueCount(customs, []), 1);
    assert.equal(transactionTaxCloseIssueCount(customs, [{ formType: 'CUSTOMS_SUPPORT', branchId: null, status: 'REVIEWED', blockingIssueCount: 0, createdAt: new Date('2026-07-11T00:00:00Z') }]), 0);
  });
});
