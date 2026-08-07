import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeVatTotals, buildVatReportLines } from './vat-report.logic';
import type { TaxSourceRef } from '@watchdog-bms/contracts';

const baseSourceRef: TaxSourceRef = {
  sourceType: 'accounting.document',
  sourceId: 'doc1',
  permissionChecked: true,
};

const outputLine = {
  taxEventId: '1',
  eventType: 'VAT_OUTPUT' as const,
  eventDate: '2026-01-10',
  counterpartyName: 'Acme Co.',
  counterpartyTaxId: '0105512345678',
  taxInvoiceNumber: 'TAX-0001',
  taxableBase: '10000.0000',
  taxAmount: '700.0000',
  outputTaxCode: 'O7' as const,
  included: true,
  reviewNote: null,
  sourceRef: baseSourceRef,
};

const inputLine = {
  taxEventId: '2',
  eventType: 'VAT_INPUT' as const,
  eventDate: '2026-01-05',
  counterpartyName: 'Supplier B',
  counterpartyTaxId: '0125512345678',
  taxInvoiceNumber: 'S-TAX-0001',
  taxableBase: '5000.0000',
  taxAmount: '350.0000',
  outputTaxCode: null,
  included: true,
  reviewNote: null,
  sourceRef: baseSourceRef,
};

const reviewLine = {
  taxEventId: '3',
  eventType: 'VAT_REVIEW' as const,
  eventDate: '2026-01-12',
  counterpartyName: null,
  counterpartyTaxId: null,
  taxInvoiceNumber: null,
  taxableBase: '2000.0000',
  taxAmount: '140.0000',
  outputTaxCode: null,
  included: false,
  reviewNote: 'Missing tax ID',
  sourceRef: baseSourceRef,
};

describe('computeVatTotals', () => {
  it('computes output minus input as net payable', () => {
    const totals = computeVatTotals([outputLine, inputLine]);
    assert.equal(totals.outputVatTotal, '700.0000');
    assert.equal(totals.inputVatTotal, '350.0000');
    assert.equal(totals.netVatPayable, '350.0000');
    assert.equal(totals.reviewIssueCount, 0);
  });

  it('excludes VAT_REVIEW from net total and counts as review issue', () => {
    const totals = computeVatTotals([outputLine, inputLine, reviewLine]);
    assert.equal(totals.reviewNeededTotal, '140.0000');
    assert.equal(totals.reviewIssueCount, 1);
    assert.equal(totals.netVatPayable, '350.0000');
  });

  it('handles zero lines gracefully', () => {
    const totals = computeVatTotals([]);
    assert.equal(totals.outputVatTotal, '0.0000');
    assert.equal(totals.netVatPayable, '0.0000');
    assert.equal(totals.lineCount, 0);
  });
});

describe('buildVatReportLines', () => {
  it('marks VAT_EXEMPT as not included', () => {
    const events = [{
      id: 'e1',
      eventType: 'VAT_EXEMPT' as const,
      eventDate: '2026-01-01',
      taxableBase: '1000.0000',
      taxAmount: '0.0000',
      vatMode: 'EXEMPT',
      outputTaxCode: 'OX' as const,
      taxInvoiceNumber: null,
      payeeSnapshot: { name: 'Someone', taxId: '1234567890123', address: null, branchCode: null },
      sourceType: 'accounting.document',
      sourceId: 'doc2',
      sourceEventType: null,
      reviewNote: null,
    }];
    const lines = buildVatReportLines(events);
    assert.equal(lines[0]!.included, false);
  });

  it('marks VAT_OUTPUT as included', () => {
    const events = [{
      id: 'e2',
      eventType: 'VAT_OUTPUT' as const,
      eventDate: '2026-01-01',
      taxableBase: '10000.0000',
      taxAmount: '700.0000',
      vatMode: 'VAT_EXCLUDED',
      outputTaxCode: 'O7' as const,
      taxInvoiceNumber: 'TAX-001',
      payeeSnapshot: { name: 'Customer', taxId: '1234567890000', address: null, branchCode: null },
      sourceType: 'accounting.document',
      sourceId: 'doc3',
      sourceEventType: null,
      reviewNote: null,
    }];
    const lines = buildVatReportLines(events);
    assert.equal(lines[0]!.included, true);
    assert.equal(lines[0]!.outputTaxCode, 'O7');
    assert.equal(lines[0]!.sourceRef.permissionChecked, true);
  });
});
