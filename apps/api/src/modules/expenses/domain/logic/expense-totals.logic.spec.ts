import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcLineTotals, calcDocumentTotals, calcPaymentAmounts, derivePaymentStatus } from './expense-totals.logic';
import { reconcileExpenseVat, validateExpenseVatSourceInput, vatSourceFromSnapshot } from './expense-vat-reconciliation.logic';
import { expenseVatReconciliationMessage } from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';
import { applyExpenseWhtInput, expenseWhtLineRate } from './expense-wht-input.logic';
function bill(prices: string[], vatMode: 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' = 'NO_VAT') {
  return reconcileExpenseVat({ vatMode, lines: prices.map((unitPrice, index) => ({
    lineNumber: index + 1, quantity: '1', unitPrice, vatRate: index === 0 ? '0.07' : '0',
  })) });
}

describe('authoritative whole-bill WHT', () => {
  it('never lets a within-tolerance VAT source create a negative base or WHT carrier', () => {
    for (const source of [{ inputType: 'AMOUNT', vatAmount: '0.05' },
      { inputType: 'NONE', lines: [{ lineNumber: 1, inputType: 'AMOUNT', vatAmount: '0.05' }] }] as const) {
      const result = reconcileExpenseVat({ vatMode: 'VAT_INCLUDED', source: source as any, lines: [
        { lineNumber: 1, quantity: '1', unitPrice: '0.01', vatRate: '0.07' },
        { lineNumber: 2, quantity: '1', unitPrice: '100', vatRate: '0' },
      ] });
      assert.equal(result.snapshot.reconciliation.status, 'MISMATCH');
      assert.equal(result.snapshot.reconciliation.acceptedSource, 'CALCULATED');
      assert.deepEqual(result.snapshot.reconciliation.attentionLineNumbers, [1]);
      assert.equal(applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: '99.96' }), null);
      for (const line of result.lines) {
        assert.ok(new Decimal(line.totals.taxableAmount).gte(0));
        assert.ok(new Decimal(line.totals.whtAmount).gte(0));
      }
      assert.equal(result.totals.whtAmount, '99.9600');
      assert.equal(result.lines[1]!.totals.vatAmount, '0.0000');
    }
  });

  it('converts percent only once and preserves legacy/amount-only rate meaning', () => {
    assert.equal(expenseWhtLineRate({ inputType: 'RATE', value: '3' }), '0.0300');
    assert.equal(expenseWhtLineRate({ inputType: 'AMOUNT', value: '30' }, '0.03'), null);
    assert.equal(expenseWhtLineRate(undefined, '0.05'), '0.05');
    assert.equal(expenseWhtLineRate(undefined, ''), null);
  });
  it('does not round a printed amount through an inferred rate', () => {
    const result = bill(['1234.56']);
    assert.equal(applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: '30.01' }), null);
    assert.equal(result.totals.whtAmount, '30.0100');
    assert.equal(result.totals.grandTotalAmount, '1234.5600');
    assert.equal(result.totals.netPayableAmount, '1204.5500');
  });
  it('allocates exact residual satang by largest remainder and stable line number', () => {
    const result = bill(['1', '1', '1', '0']);
    applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: '0.02' });
    assert.deepEqual(result.lines.map((line) => line.totals.whtAmount), ['0.0100', '0.0100', '0.0000', '0.0000']);
    assert.equal(result.totals.whtAmount, '0.0200');
  });
  it('keeps a baht amount exact after included VAT residuals and discounts', () => {
    const result = reconcileExpenseVat({ vatMode: 'VAT_INCLUDED',
      source: { inputType: 'AMOUNT', vatAmount: '7.01' },
      lines: [{ lineNumber: 1, quantity: '1', unitPrice: '117', discountAmount: '10', vatRate: '0.07' },
        { lineNumber: 2, quantity: '1', unitPrice: '50', vatRate: '0' }],
    });
    applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: '4.51' });
    assert.equal(result.totals.taxableAmount, '149.9900');
    assert.equal(result.lines[1]!.totals.vatAmount, '0.0000');
    assert.equal(result.totals.whtAmount, '4.5100');
    assert.equal(result.totals.grandTotalAmount, '157.0000');
    assert.equal(result.totals.netPayableAmount, '152.4900');
  });
  it('keeps rate-based line rounding, zero and base cap across pricing modes', () => {
    for (const mode of ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      const result = bill(['107', '50'], mode);
      applyExpenseWhtInput(result, { inputType: 'RATE', value: '3' });
      const expected = result.lines.reduce((sum, line) => sum.plus(new Decimal(line.totals.taxableAmount).mul('0.03').toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), new Decimal(0));
      assert.equal(result.totals.whtAmount, expected.toFixed(4));
      assert.notEqual(applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: '999' }), null);
      applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: '0' });
      assert.equal(result.totals.netPayableAmount, result.totals.grandTotalAmount);
    }
  });
  it('preserves header/line sums and non-negative balances for small and large inputs', () => {
    for (const prices of [['0'], ['0.01', '0.02'], ['7.31', '2.62', '4.07'], ['99999999999998.98', '1.01']]) {
      for (const amount of ['0', prices[0]!]) {
        const result = bill(prices);
        applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: amount });
        assert.equal(result.totals.whtAmount, new Decimal(amount).toFixed(4));
        const sum = result.lines.reduce((total, line) => total.plus(line.totals.whtAmount), new Decimal(0));
        assert.equal(sum.toFixed(4), result.totals.whtAmount);
        for (const line of result.lines) assert.ok(new Decimal(line.totals.whtAmount).lte(line.totals.taxableAmount));
        assert.equal(new Decimal(result.totals.netPayableAmount).plus(result.totals.whtAmount).toFixed(4), result.totals.grandTotalAmount);
      }
    }
  });
});


const vatSourceLine = (unitPrice: string, vatRate: string | null = null, whtRate: string | null = null) => ({
  lineNumber: 1,
  quantity: '1',
  unitPrice,
  discountAmount: '0',
  vatRate,
  whtRate,
});

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

describe('reconcileExpenseVat', () => {
  it('derives an amount-only included rate and preserves printed VAT exactly', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_INCLUDED',
      lines: [vatSourceLine('414')],
      source: { inputType: 'AMOUNT', vatAmount: '27.08' },
      capturedAt: '2026-08-20T00:00:00.000Z',
    });
    assert.equal(result.lines[0]?.vatRate, '0.0700');
    assert.equal(result.totals.taxableAmount, '386.9200');
    assert.equal(result.totals.vatAmount, '27.0800');
    assert.equal(result.totals.grandTotalAmount, '414.0000');
    assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
    assert.equal(result.snapshot.source.vatAmount, '27.0800');
    assert.deepEqual(result.snapshot.calculation.lineResults[0], {
      lineNumber: 1,
      vatRatePercent: '7.0000',
      calculatedTaxableAmount: '386.9200',
      acceptedTaxableAmount: '386.9200',
      calculatedVatAmount: '27.0800',
      acceptedVatAmount: '27.0800',
      residualAdjustment: '0.0000',
    });
  });

  it('keeps an explicit zero rate distinct from an unknown rate', () => {
    const zero = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [vatSourceLine('100', '0')],
      source: { inputType: 'RATE', vatRatePercent: '0' },
    });
    const unknown = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines: [vatSourceLine('100')] });
    assert.equal(zero.snapshot.calculation.formula, 'ZERO');
    assert.equal(zero.snapshot.calculation.vatRatePercent, '0.0000');
    assert.equal(unknown.snapshot.calculation.formula, 'EXCLUDED');
    assert.equal(unknown.snapshot.calculation.vatRatePercent, null);
  });

  it('recomputes the taxable base and WHT when an included residual is accepted', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_INCLUDED',
      lines: [vatSourceLine('107', '0.0700', '0.0300')],
      source: { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '6.99' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
    assert.equal(result.totals.vatAmount, '6.9900');
    assert.equal(result.totals.taxableAmount, '100.0100');
    assert.equal(result.totals.whtAmount, '3.0000');
    assert.equal(result.totals.netPayableAmount, '104.0000');
  });

  it('keeps the calculated amount and reports an outside-tolerance mismatch', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [vatSourceLine('100', '0.0700')],
      source: { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '8.00' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MISMATCH');
    assert.equal(result.snapshot.reconciliation.acceptedSource, 'CALCULATED');
    assert.equal(result.totals.vatAmount, '7.0000');
  });

  it('uses an inclusive five-satang tolerance boundary in both directions', () => {
    for (const [vatAmount, status] of [
      ['7.05', 'MATCHED'],
      ['6.95', 'MATCHED'],
      ['7.06', 'MISMATCH'],
      ['6.94', 'MISMATCH'],
    ] as const) {
      const result = reconcileExpenseVat({
        vatMode: 'VAT_EXCLUDED',
        lines: [vatSourceLine('100', '0.0700')],
        source: { inputType: 'AMOUNT', vatAmount },
      });
      assert.equal(result.snapshot.reconciliation.status, status, vatAmount);
    }
  });

  it('allocates a residual to the largest taxable line with a stable line-number tie-break', () => {
    const largest = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100', '0.0700'),
        { ...vatSourceLine('200', '0.0700'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '21.01' },
    });
    assert.deepEqual(largest.snapshot.calculation.lineResults.map((line) => line.residualAdjustment), ['0.0000', '0.0100']);

    const tied = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100', '0.0700'),
        { ...vatSourceLine('100', '0.0700'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '14.01' },
    });
    assert.deepEqual(tied.snapshot.calculation.lineResults.map((line) => line.residualAdjustment), ['0.0100', '0.0000']);
  });

  it('blocks a printed rate that contradicts an otherwise matching amount', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [vatSourceLine('100', '0.0680')],
      source: { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '6.80' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MISMATCH');
    assert.equal(result.totals.grandTotalAmount, '106.8000');
  });

  // Plan 13.11.B golden example 1: VAT excluded, 7% goods beside a no-VAT line.
  it('accepts an exact mixed-document VAT total without inventing an allocation', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100', '0.0700'),
        { ...vatSourceLine('50', '0.0000'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '7.00' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
    assert.equal(result.snapshot.calculation.vatBaseAmount, '100.0000');
    assert.equal(result.totals.grandTotalAmount, '157.0000');
    assert.ok(result.snapshot.calculation.lineResults.every((lineResult) => lineResult.residualAdjustment === '0.0000'));
    assert.equal(result.snapshot.reconciliation.attentionLineNumbers, undefined);
  });

  // Plan 13.11.B golden example 2: the same receipt printed VAT-inclusive.
  it('accepts an exact mixed VAT-included document on the VAT base alone', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_INCLUDED',
      lines: [
        vatSourceLine('107', '0.0700'),
        { ...vatSourceLine('50', '0.0000'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '7.00' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
    assert.equal(result.snapshot.calculation.vatBaseAmount, '100.0000');
    assert.equal(result.totals.vatAmount, '7.0000');
    assert.equal(result.totals.grandTotalAmount, '157.0000');
    assert.equal(result.lines[1]?.totals.vatAmount, '0.0000');
  });

  // Plan 13.11.B golden example 3: a mixed document inside the rounding tolerance is allocated
  // deterministically to the VAT line; the no-VAT line stays at exactly zero.
  it('allocates an accepted mixed-document residual to the VAT line only', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100', '0.0700'),
        { ...vatSourceLine('50', '0.0000'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '7.01' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
    assert.deepEqual(result.snapshot.calculation.lineResults.map((line) => line.residualAdjustment), ['0.0100', '0.0000']);
    assert.equal(result.lines[1]?.totals.vatAmount, '0.0000');
    assert.equal(result.totals.vatAmount, '7.0100');

    // The table's own figures: 99.99 at 7% rounds to the printed 7.00 with nothing left over.
    const printed = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('99.99', '0.0700'),
        { ...vatSourceLine('50', '0.0000'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '7.00' },
    });
    assert.equal(printed.snapshot.reconciliation.status, 'MATCHED');
    assert.equal(printed.lines[0]?.totals.vatAmount, '7.0000');
    assert.equal(printed.lines[1]?.totals.vatAmount, '0.0000');
  });

  it('never lets a no-VAT line absorb the residual, even when it is the largest line', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('50', '0.0700'),
        { ...vatSourceLine('400', '0.0000'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '3.52' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
    assert.deepEqual(result.snapshot.calculation.lineResults.map((line) => line.residualAdjustment), ['0.0200', '0.0000']);
    assert.equal(result.lines[1]?.totals.vatAmount, '0.0000');
  });

  // Plan 13.11.B golden example 4: a real mismatch is never auto-accepted, and it names the line.
  it('blocks an over-tolerance mixed document and points at the VAT line', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100', '0.0700'),
        { ...vatSourceLine('50', '0.0000'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '8.00' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MISMATCH');
    assert.equal(result.snapshot.reconciliation.differenceAmount, '1.0000');
    assert.deepEqual(result.snapshot.reconciliation.attentionLineNumbers, [1]);
    assert.equal(result.totals.vatAmount, '7.0000');
    assert.equal(
      expenseVatReconciliationMessage(result.snapshot),
      'VAT จากเอกสาร 8.00 บาท แต่จากรายการที่เลือก ระบบคำนวณได้ 7.00 บาท ต่างกัน 1.00 บาท '
      + 'กรุณาตรวจรายการที่ 1 หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล',
    );
  });

  it('still refuses to allocate when several positive rates share one document total', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100', '0.0700'),
        { ...vatSourceLine('100', '0.1000'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '17.01' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'NEEDS_REVIEW');
    assert.ok(result.snapshot.calculation.lineResults.every((line) => line.residualAdjustment === '0.0000'));
  });

  it('compares line source differences only within the sourced line group', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100', '0.0700'),
        { ...vatSourceLine('50', '0.0700'), lineNumber: 2 },
      ],
      source: {
        inputType: 'NONE',
        lines: [{ lineNumber: 1, inputType: 'AMOUNT', vatAmount: '7.00' }],
      },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
    assert.equal(result.snapshot.reconciliation.differenceAmount, '0.0000');
    assert.equal(result.totals.vatAmount, '10.5000');
    assert.equal(result.snapshot.source.vatAmount, null);
    const restored = vatSourceFromSnapshot(result.snapshot)!;
    assert.equal(validateExpenseVatSourceInput(restored, 'VAT_EXCLUDED', [1, 2]), null);
    assert.deepEqual(restored.lines, [{ lineNumber: 1, inputType: 'AMOUNT', vatAmount: '7.00' }]);
  });

  // Plan 13.11.B golden example 5: an unknown treatment is never guessed at 0% or 7%; the draft
  // still holds the values and the first line to check is named.
  it('preserves explicit line treatments when an amount-only document needs allocation', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [
        vatSourceLine('100'),
        { ...vatSourceLine('50', '0'), lineNumber: 2 },
      ],
      source: { inputType: 'AMOUNT', vatAmount: '7.00' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'NEEDS_REVIEW');
    assert.equal(result.lines[0]?.vatRate, null);
    assert.equal(result.lines[1]?.vatRate, '0');
    assert.deepEqual(result.snapshot.reconciliation.attentionLineNumbers, [1]);
  });

  it('does not accept positive source VAT against an explicit zero rate', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [vatSourceLine('100', '0')],
      source: { inputType: 'AMOUNT', vatAmount: '0.01' },
    });
    assert.equal(result.snapshot.reconciliation.status, 'MISMATCH');
    assert.equal(result.totals.vatAmount, '0.0000');
  });

  it('keeps stale line evidence for review without partially applying it', () => {
    const result = reconcileExpenseVat({
      vatMode: 'VAT_EXCLUDED',
      lines: [vatSourceLine('100', '0.0700')],
      source: {
        inputType: 'NONE',
        lines: [
          { lineNumber: 1, inputType: 'AMOUNT', vatAmount: '7.01' },
          { lineNumber: 2, inputType: 'AMOUNT', vatAmount: '3.50' },
        ],
      },
    });
    assert.equal(result.snapshot.reconciliation.status, 'NEEDS_REVIEW');
    assert.equal(result.snapshot.reconciliation.acceptedSource, 'CALCULATED');
    assert.equal(result.totals.vatAmount, '7.0000');
  });

  it('rejects derived source fields and unit/type mismatches at runtime', () => {
    assert.match(validateExpenseVatSourceInput({ inputType: 'AMOUNT', vatAmount: '27.08', calculation: {} }, 'VAT_INCLUDED', [1]) ?? '', /server-owned/);
    assert.match(validateExpenseVatSourceInput({ inputType: 'RATE', vatRatePercent: '0.00001' }, 'VAT_INCLUDED', [1]) ?? '', /matching/);
    assert.equal(validateExpenseVatSourceInput({ inputType: 'RATE', vatRatePercent: '7' }, 'VAT_INCLUDED', [1]), null);
    assert.match(validateExpenseVatSourceInput({ inputType: 'RATE', vatRatePercent: '7' }, 'NO_VAT', [1]) ?? '', /cannot contain/);
  });
});
