import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaxReviewIssues, calcDocumentTotals, calcLineTotals, calcNetPayable, matchLine } from './procurement.logic';

describe('procurement money logic', () => {
  it('does not add VAT twice for VAT_INCLUDED lines', () => {
    const result = calcLineTotals({
      quantity: '1',
      unitPrice: '107',
      vatMode: 'VAT_INCLUDED',
      vatRate: '7',
    });

    assert.equal(result.lineSubtotalAmount, '100.0000');
    assert.equal(result.vatAmount, '7.0000');
    assert.equal(result.lineTotalAmount, '107.0000');
  });

  it('adds VAT on top for VAT_EXCLUDED lines', () => {
    const result = calcLineTotals({
      quantity: '1',
      unitPrice: '100',
      vatMode: 'VAT_EXCLUDED',
      vatRate: '7',
    });

    assert.equal(result.lineSubtotalAmount, '100.0000');
    assert.equal(result.vatAmount, '7.0000');
    assert.equal(result.lineTotalAmount, '107.0000');
  });
});

describe('procurement satang rounding (spec §19d)', () => {
  it('rounds VAT_EXCLUDED line money to satang at compute time', () => {
    const result = calcLineTotals({ quantity: '1', unitPrice: '542.06', vatMode: 'VAT_EXCLUDED', vatRate: '7' });

    assert.equal(result.lineSubtotalAmount, '542.0600');
    assert.equal(result.vatAmount, '37.9400');
    assert.equal(result.lineTotalAmount, '580.0000');
  });

  it('preserves the printed gross for VAT_INCLUDED lines', () => {
    const result = calcLineTotals({ quantity: '1', unitPrice: '580', vatMode: 'VAT_INCLUDED', vatRate: '7' });

    assert.equal(result.lineSubtotalAmount, '542.0600');
    assert.equal(result.vatAmount, '37.9400');
    assert.equal(result.lineTotalAmount, '580.0000');
  });

  it('re-rounds document totals and net payable over pre-policy 4dp lines', () => {
    const totals = calcDocumentTotals([{
      lineSubtotalAmount: '542.0600', vatAmount: '37.9442', lineTotalAmount: '580.0042',
      whtAmount: '16.2618', vatMode: 'VAT_EXCLUDED',
    }]);

    assert.equal(totals.vatAmount, '37.9400');
    assert.equal(totals.grandTotalAmount, '580.0000');
    assert.equal(totals.whtEstimateAmount, '16.2600');
    assert.equal(calcNetPayable('580.0042', '16.2618'), '563.7400');
  });
});

describe('procurement matching logic', () => {
  it('blocks three-way matching when receipt quantity is missing', () => {
    const result = matchLine({
      poQuantity: '10',
      poUnitPrice: '100',
      billQuantity: '10',
      billUnitPrice: '100',
      lineType: 'STOCK',
      matchingMode: 'THREE_WAY_PO_RECEIPT_BILL',
    });

    assert.equal(result.status, 'NOT_MATCHED');
    assert.equal(result.quantityVariance, '10.0000');
    assert.equal(result.amountVariance, '1000.0000');
  });

  it('uses accepted receipt quantity for three-way amount variance', () => {
    const result = matchLine({
      poQuantity: '10',
      poUnitPrice: '100',
      billQuantity: '8',
      billUnitPrice: '100',
      grAcceptedQuantity: '8',
      lineType: 'STOCK',
      matchingMode: 'THREE_WAY_PO_RECEIPT_BILL',
    });

    assert.equal(result.status, 'MATCHED');
    assert.equal(result.quantityVariance, '0.0000');
    assert.equal(result.amountVariance, '0.0000');
  });
});

describe('vendor bill domestic VAT evidence', () => {
  it('fails closed until supplier VAT identity, tax invoice, active attachment, and review are complete', () => {
    assert.deepEqual(buildTaxReviewIssues({
      vatAmount: '7', pp36Candidate: false, inputVatClaimStatus: 'NEEDS_REVIEW', taxEvidenceRequired: true,
      taxEvidenceReviewStatus: 'REVIEW_REQUIRED',
    }), [
      'missing_supplier_tax_id',
      'supplier_vat_registration_not_confirmed',
      'missing_tax_invoice_number',
      'missing_tax_invoice_date',
      'missing_active_tax_invoice_attachment',
      'tax_evidence_review_required',
    ]);

    assert.deepEqual(buildTaxReviewIssues({
      taxId: '0100000000001', vatRegistered: true, taxInvoiceNumber: 'TAX-001', taxInvoiceDate: new Date('2026-07-14'),
      attachmentActive: true, vatAmount: '7', pp36Candidate: false, inputVatClaimStatus: 'CLAIMABLE',
      taxEvidenceRequired: true, taxEvidenceReviewStatus: 'VERIFIED',
    }), []);
  });
});
