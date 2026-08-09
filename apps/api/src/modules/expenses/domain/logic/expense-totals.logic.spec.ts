import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcLineTotals, calcDocumentTotals, calcPaymentAmounts, derivePaymentStatus } from './expense-totals.logic';

describe('calcLineTotals', () => {
  it('NO_VAT line', () => {
    const r = calcLineTotals({ quantity: '2', unitPrice: '100', vatMode: 'NO_VAT' });
    assert.equal(r.lineSubtotalAmount, '200.0000');
    assert.equal(r.vatAmount, '0.0000');
    assert.equal(r.taxableAmount, '200.0000');
    assert.equal(r.lineTotalAmount, '200.0000');
  });

  it('VAT_EXCLUDED line at 7%', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '100', vatMode: 'VAT_EXCLUDED', vatRate: '0.07' });
    assert.equal(r.taxableAmount, '100.0000');
    assert.equal(r.vatAmount, '7.0000');
    assert.equal(r.lineTotalAmount, '107.0000');
  });

  it('VAT_INCLUDED line at 7%', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '107', vatMode: 'VAT_INCLUDED', vatRate: '0.07' });
    // 107 / 1.07 = 100 taxable, 7 VAT
    assert.ok(Math.abs(parseFloat(r.taxableAmount) - 100) < 0.01, `taxable=${r.taxableAmount}`);
    assert.ok(Math.abs(parseFloat(r.vatAmount) - 7) < 0.01, `vat=${r.vatAmount}`);
  });

  // Spec §19g decision 1: this used to default to 0.07, so a document whose rate was never read
  // silently recorded 7% VAT on the server while the web preview showed none.
  it('treats an absent or blank VAT rate as unknown, never as 7%', () => {
    for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      const absent = calcLineTotals({ quantity: '1', unitPrice: '180', vatMode });
      assert.equal(absent.vatAmount, '0.0000', `${vatMode} absent rate must not invent VAT`);
      assert.equal(absent.taxableAmount, '180.0000');

      const blank = calcLineTotals({ quantity: '1', unitPrice: '180', vatMode, vatRate: '  ' });
      assert.equal(blank.vatAmount, '0.0000', `${vatMode} blank rate must not invent VAT`);
    }
  });

  it('preserves an explicit zero VAT rate in VAT modes', () => {
    const excluded = calcLineTotals({ quantity: '1', unitPrice: '100', vatMode: 'VAT_EXCLUDED', vatRate: '0' });
    const included = calcLineTotals({ quantity: '1', unitPrice: '100', vatMode: 'VAT_INCLUDED', vatRate: '0' });
    assert.equal(excluded.taxableAmount, '100.0000');
    assert.equal(excluded.vatAmount, '0.0000');
    assert.equal(included.taxableAmount, '100.0000');
    assert.equal(included.vatAmount, '0.0000');
  });

  it('WHT applied on taxable', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '100', vatMode: 'NO_VAT', whtRate: '0.03' });
    assert.equal(r.whtAmount, '3.0000');
  });

  it('discount reduces taxable base', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '200', discountAmount: '50', vatMode: 'NO_VAT' });
    assert.equal(r.taxableAmount, '150.0000');
    assert.equal(r.discountAmount, '50.0000');
  });

  it('EXEMPT mode yields zero VAT', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '100', vatMode: 'EXEMPT' });
    assert.equal(r.vatAmount, '0.0000');
  });

  // §19d satang policy: stored VAT must equal the printed document (BENLAI slip:
  // TAX Exclude 542.06 / TAX AMT 37.94 / paid 580.00 — never 37.9442/580.0042).
  it('VAT_EXCLUDED rounds VAT to satang (§19d)', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '542.06', vatMode: 'VAT_EXCLUDED', vatRate: '0.07' });
    assert.equal(r.taxableAmount, '542.0600');
    assert.equal(r.vatAmount, '37.9400');
    assert.equal(r.lineTotalAmount, '580.0000');
  });

  it('VAT_INCLUDED rounds taxable to satang and keeps gross intact (§19d)', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '580', vatMode: 'VAT_INCLUDED', vatRate: '0.07' });
    assert.equal(r.taxableAmount, '542.0600');
    assert.equal(r.vatAmount, '37.9400');
    assert.equal(r.lineTotalAmount, '580.0000');
  });

  it('WHT rounds to satang (§19d)', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '542.06', vatMode: 'NO_VAT', whtRate: '0.03' });
    assert.equal(r.whtAmount, '16.2600');
  });

  it('keeps the Decimal(18,4) upper satang boundary exact without Number precision loss', () => {
    const r = calcLineTotals({ quantity: '1', unitPrice: '99999999999999.99', vatMode: 'NO_VAT' });
    assert.equal(r.lineSubtotalAmount, '99999999999999.9900');
    assert.equal(r.lineTotalAmount, '99999999999999.9900');
  });
});

describe('calcDocumentTotals', () => {
  it('sums lines correctly', () => {
    const lines = [
      { taxableAmount: '100.0000', vatAmount: '7.0000', whtAmount: '0.0000', lineSubtotalAmount: '100.0000', discountAmount: '0.0000', lineTotalAmount: '107.0000' },
      { taxableAmount: '200.0000', vatAmount: '14.0000', whtAmount: '0.0000', lineSubtotalAmount: '200.0000', discountAmount: '0.0000', lineTotalAmount: '214.0000' },
    ];
    const r = calcDocumentTotals({ lines });
    assert.equal(r.taxableAmount, '300.0000');
    assert.equal(r.vatAmount, '21.0000');
    assert.equal(r.grandTotalAmount, '321.0000');
    assert.equal(r.netPayableAmount, '321.0000');
  });

  it('satang line yields satang document totals (§19d)', () => {
    const lines = [
      { taxableAmount: '542.0600', vatAmount: '37.9400', whtAmount: '0.0000', lineSubtotalAmount: '542.0600', discountAmount: '0.0000', lineTotalAmount: '580.0000' },
    ];
    const r = calcDocumentTotals({ lines });
    assert.equal(r.vatAmount, '37.9400');
    assert.equal(r.grandTotalAmount, '580.0000');
    assert.equal(r.netPayableAmount, '580.0000');
  });

  it('WHT reduces netPayable not grandTotal', () => {
    const lines = [
      { taxableAmount: '100.0000', vatAmount: '7.0000', whtAmount: '3.0000', lineSubtotalAmount: '100.0000', discountAmount: '0.0000', lineTotalAmount: '107.0000' },
    ];
    const r = calcDocumentTotals({ lines });
    assert.equal(r.grandTotalAmount, '107.0000');
    assert.equal(r.whtAmount, '3.0000');
    assert.equal(r.netPayableAmount, '104.0000');
  });

  it('sums decimal fractions without binary floating-point drift', () => {
    const lines = ['0.1000', '0.2000'].map((amount) => ({
      taxableAmount: amount, vatAmount: '0.0000', whtAmount: '0.0000',
      lineSubtotalAmount: amount, discountAmount: '0.0000', lineTotalAmount: amount,
    }));
    const r = calcDocumentTotals({ lines });
    assert.equal(r.subtotalAmount, '0.3000');
    assert.equal(r.grandTotalAmount, '0.3000');
  });
});

describe('calcPaymentAmounts', () => {
  it('outstanding = net - paid', () => {
    const { outstandingAmount } = calcPaymentAmounts('107.0000', '50.0000');
    assert.equal(outstandingAmount, '57.0000');
  });

  it('outstanding cannot go below 0', () => {
    const { outstandingAmount } = calcPaymentAmounts('100.0000', '200.0000');
    assert.equal(outstandingAmount, '0.0000');
  });

  it('sub-satang residue on pre-§19d rows clamps to zero', () => {
    const { outstandingAmount } = calcPaymentAmounts('580.0042', '580.00');
    assert.equal(outstandingAmount, '0.0000');
  });

  it('a real one-satang shortfall is kept', () => {
    const { outstandingAmount } = calcPaymentAmounts('580.01', '580.00');
    assert.equal(outstandingAmount, '0.0100');
  });

  it('keeps one satang exact at the Decimal(18,4) upper boundary', () => {
    const { outstandingAmount } = calcPaymentAmounts('99999999999999.99', '99999999999999.98');
    assert.equal(outstandingAmount, '0.0100');
  });
});

describe('derivePaymentStatus', () => {
  it('UNPAID when paid is 0', () => {
    assert.equal(derivePaymentStatus('100', '0'), 'UNPAID');
  });
  it('PAID when paid >= net', () => {
    assert.equal(derivePaymentStatus('100', '100'), 'PAID');
  });
  it('PARTIALLY_PAID when paid < net', () => {
    assert.equal(derivePaymentStatus('100', '50'), 'PARTIALLY_PAID');
  });
  it('PAID when only sub-satang residue remains (pre-§19d stored totals)', () => {
    assert.equal(derivePaymentStatus('580.0042', '580.00'), 'PAID');
  });
  it('PARTIALLY_PAID on a real one-satang shortfall', () => {
    assert.equal(derivePaymentStatus('580.01', '580.00'), 'PARTIALLY_PAID');
  });
  it('PARTIALLY_PAID on an exact half-satang boundary', () => {
    assert.equal(derivePaymentStatus('580.0050', '580.0000'), 'PARTIALLY_PAID');
  });
  it('does not collapse a one-satang shortfall at the Decimal(18,4) upper boundary', () => {
    assert.equal(derivePaymentStatus('99999999999999.99', '99999999999999.98'), 'PARTIALLY_PAID');
  });
});
