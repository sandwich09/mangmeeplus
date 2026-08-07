import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLine,
  calculateDocumentTotals,
  calculatePaymentStatus,
  calculateOutstandingAmount,
  calculateUnappliedCredit,
} from './accounting-totals.logic';

describe('calculateLine', () => {
  it('VAT_EXCLUDED: adds VAT on top of taxable amount', () => {
    const r = calculateLine({ quantity: '2', unitPrice: '100', discountAmount: '0', vatRate: '7', vatMode: 'VAT_EXCLUDED', whtRate: '0' });
    assert.equal(r.taxableAmount, '200.00');
    assert.equal(r.vatAmount, '14.00');
    assert.equal(r.lineTotalAmount, '214.00');
  });

  it('VAT_INCLUDED: back-calculates taxable from total', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '107', vatRate: '7', vatMode: 'VAT_INCLUDED' });
    assert.equal(r.taxableAmount, '100.00');
    assert.equal(r.vatAmount, '7.00');
    assert.equal(r.lineTotalAmount, '107.00');
  });

  it('NO_VAT: zero VAT', () => {
    const r = calculateLine({ quantity: '3', unitPrice: '50', vatMode: 'NO_VAT' });
    assert.equal(r.vatAmount, '0.00');
    assert.equal(r.lineTotalAmount, '150.00');
  });

  it('applies discount before VAT', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '200', discountAmount: '50', vatRate: '7', vatMode: 'VAT_EXCLUDED' });
    assert.equal(r.taxableAmount, '150.00');
    assert.equal(r.vatAmount, '10.50');
    assert.equal(r.lineTotalAmount, '160.50');
  });

  it('calculates WHT on taxable amount', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '1000', vatMode: 'VAT_EXCLUDED', vatRate: '7', whtRate: '3' });
    assert.equal(r.whtAmount, '30.00');
  });

  it('discount cannot exceed line subtotal', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '100', discountAmount: '9999', vatMode: 'NO_VAT' });
    assert.equal(r.taxableAmount, '0.00');
    assert.equal(r.lineTotalAmount, '0.00');
  });
});

describe('calculateDocumentTotals', () => {
  it('sums multiple lines correctly', () => {
    const lines = [
      { lineSubtotalAmount: '200.00', discountAmount: '0.00', taxableAmount: '200.00', vatAmount: '14.00', whtAmount: '0.00', lineTotalAmount: '214.00' },
      { lineSubtotalAmount: '100.00', discountAmount: '10.00', taxableAmount: '90.00', vatAmount: '6.30', whtAmount: '0.00', lineTotalAmount: '96.30' },
    ];
    const t = calculateDocumentTotals(lines);
    assert.equal(t.subtotalAmount, '300.00');
    assert.equal(t.discountAmount, '10.00');
    assert.equal(t.taxableAmount, '290.00');
    assert.equal(t.vatAmount, '20.30');
    assert.equal(t.grandTotalAmount, '310.30');
  });

  it('returns zeros for empty lines', () => {
    const t = calculateDocumentTotals([]);
    assert.equal(t.grandTotalAmount, '0.00');
  });
});

describe('calculatePaymentStatus', () => {
  it('returns UNPAID when paid is 0', () => assert.equal(calculatePaymentStatus('1000.00', '0'), 'UNPAID'));
  it('returns PAID when fully paid', () => assert.equal(calculatePaymentStatus('500.00', '500.00'), 'PAID'));
  it('returns PARTIALLY_PAID when underpaid', () => assert.equal(calculatePaymentStatus('500.00', '250.00'), 'PARTIALLY_PAID'));
  it('returns PAID on overpayment scenario', () => assert.equal(calculatePaymentStatus('500.00', '600.00'), 'PAID'));
});

describe('calculateOutstandingAmount', () => {
  it('outstanding = grand - paid', () => assert.equal(calculateOutstandingAmount('1000.00', '300.00'), '700.00'));
  it('clamps at 0 when overpaid', () => assert.equal(calculateOutstandingAmount('100.00', '200.00'), '0.00'));
});

describe('calculateUnappliedCredit', () => {
  it('unapplied = payment - allocated', () => assert.equal(calculateUnappliedCredit('500.00', '300.00'), '200.00'));
  it('returns 0 when fully allocated', () => assert.equal(calculateUnappliedCredit('300.00', '300.00'), '0.00'));
  it('returns 0 when over-allocated (should not happen but clamps)', () => assert.equal(calculateUnappliedCredit('100.00', '200.00'), '0.00'));
});
