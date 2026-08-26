import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLine,
  calculateDocumentTotals,
  calculatePaymentStatus,
  calculateOutstandingAmount,
  calculateUnappliedCredit,
} from './accounting-totals.logic';

// LED-FIN-01 golden set (income-expense-ledger spec §7.1).
//
// The first three cases are float tripwires: the previous implementation computed them with JS
// float `Math.round(v * 100) / 100` and produced a different satang. If any of them fails after a
// future edit, the file has regressed to float math — do not adjust the expectation.

describe('LED-FIN-01 golden: half-satang exactness (float would fail these)', () => {
  it('G1 VAT_EXCLUDED 7% of 57.50 → VAT 4.03 (float gave 4.02)', () => {
    // 57.50 × 7% = 4.025 exactly; ROUND_HALF_UP → 4.03. Float represents 4.025 as
    // 4.0249999999999995 and rounded it DOWN to 4.02 — one satang short on a real receipt.
    const r = calculateLine({ quantity: '1', unitPrice: '57.50', vatMode: 'VAT_EXCLUDED', vatRate: '7' });
    assert.equal(r.taxableAmount, '57.50');
    assert.equal(r.vatAmount, '4.03');
    assert.equal(r.lineTotalAmount, '61.53');
  });

  it('G2 WHT 3% of 33.50 → 1.01 (float gave 1.00)', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '33.50', vatMode: 'NO_VAT', whtRate: '3' });
    assert.equal(r.whtAmount, '1.01');
  });

  it('G3 line subtotal 1 × 1.005 → 1.01 (float gave 1.00)', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '1.005', vatMode: 'NO_VAT' });
    assert.equal(r.lineSubtotalAmount, '1.01');
    assert.equal(r.lineTotalAmount, '1.01');
  });
});

describe('LED-FIN-01 golden: mixed document and invariants', () => {
  it('G4 VAT line + NO_VAT line: only the VAT line enters the VAT base', () => {
    const l1 = calculateLine({ quantity: '1', unitPrice: '57.50', vatMode: 'VAT_EXCLUDED', vatRate: '7' });
    const l2 = calculateLine({ quantity: '1', unitPrice: '42.50', vatMode: 'NO_VAT' });
    const t = calculateDocumentTotals([l1, l2]);
    assert.equal(t.subtotalAmount, '100.00');
    assert.equal(t.vatAmount, '4.03');
    assert.equal(t.grandTotalAmount, '104.03');
  });

  it('G5 VAT_INCLUDED 7% back-calculation stays exact', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '107.35', vatMode: 'VAT_INCLUDED', vatRate: '7' });
    assert.equal(r.taxableAmount, '100.33');
    assert.equal(r.vatAmount, '7.02');
    assert.equal(r.lineTotalAmount, '107.35');
    // taxable + vat must reproduce the price the customer actually paid
    assert.equal((Number(r.taxableAmount) * 100 + Number(r.vatAmount) * 100) / 100, 107.35);
  });

  it('G6 paid + outstanding = grand across satang-level partial payments', () => {
    const grand = '104.03';
    assert.equal(calculatePaymentStatus(grand, '104.02'), 'PARTIALLY_PAID');
    assert.equal(calculateOutstandingAmount(grand, '104.02'), '0.01');
    assert.equal(calculatePaymentStatus(grand, '104.03'), 'PAID');
    assert.equal(calculateOutstandingAmount(grand, '104.03'), '0.00');
  });

  it('G7 unapplied credit is exact at satang level', () => {
    assert.equal(calculateUnappliedCredit('100.00', '99.99'), '0.01');
  });

  it('G8 discount clamp behaviour is unchanged by the decimal conversion', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '100', discountAmount: '9999', vatMode: 'NO_VAT' });
    assert.equal(r.taxableAmount, '0.00');
    assert.equal(r.lineTotalAmount, '0.00');
  });
});
