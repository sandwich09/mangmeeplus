import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcLineTotals, calcDocumentTotals, calcPaymentAmounts, derivePaymentStatus, expenseTotalsIdentityError } from './expense-totals.logic';
import { acceptExpenseVatSource, reconcileExpenseVat, validateExpenseVatSourceInput, vatSourceFromSnapshot } from './expense-vat-reconciliation.logic';
import { expenseVatReconciliationMessage } from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';
import { applyExpenseWhtInput, expenseWhtLineRate } from './expense-wht-input.logic';
it('MONEY-T1 rounds 208220.45 at 2 percent once to 4164.41, with or without an explicit base', () => {
  for (const baseAmount of [undefined, '208220.45']) {
    const result = bill(['104110.22', '104110.23']);
    assert.equal(applyExpenseWhtInput(result, { inputType: 'RATE', value: '2', ...(baseAmount && { baseAmount }) }), null);
    assert.equal(result.totals.whtAmount, '4164.4100');
    assert.equal(result.lines.reduce((sum, line) => sum.plus(line.totals.whtAmount), new Decimal(0)).toFixed(4), '4164.4100');
  }
});
it('MONEY-T1 seeded percent cases equal summed base times rate and preserve allocated satang', () => {
  let seed = 777;
  const pick = (max: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % max);
  for (let i = 0; i < 3000; i++) {
    const prices = Array.from({ length: 1 + pick(8) }, () => new Decimal(1 + pick(10000000)).div(100).toFixed(2));
    const rate = ['1', '2', '3', '5'][pick(4)]!;
    const result = bill(prices, ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED'][pick(3)] as any);
    const base = result.totals.taxableAmount;
    assert.equal(applyExpenseWhtInput(result, { inputType: 'RATE', value: rate }), null);
    const expected = new Decimal(base).mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    assert.equal(result.totals.whtAmount, expected.toFixed(4), `seed case ${i}`);
    assert.equal(result.lines.reduce((sum, line) => sum.plus(line.totals.whtAmount), new Decimal(0)).toFixed(4), expected.toFixed(4));
    const explicit = bill(prices, 'NO_VAT');
    const single = bill([explicit.totals.taxableAmount]);
    applyExpenseWhtInput(explicit, { inputType: 'RATE', value: rate, baseAmount: explicit.totals.taxableAmount });
    applyExpenseWhtInput(single, { inputType: 'RATE', value: rate });
    assert.equal(explicit.totals.whtAmount, single.totals.whtAmount);
  }
});
function bill(prices: string[], vatMode: 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' = 'NO_VAT') {
  return reconcileExpenseVat({ vatMode, lines: prices.map((unitPrice, index) => ({
    lineNumber: index + 1, quantity: '1', unitPrice, vatRate: index === 0 ? '0.07' : '0',
  })) });
}

function sourceDecisionExpense(vatMode: 'VAT_INCLUDED' | 'VAT_EXCLUDED' = 'VAT_INCLUDED', sourceVat = '8', whtInput?: { inputType: 'RATE' | 'AMOUNT'; value: string }) {
  const units = [
    { lineNumber: 1, quantity: '2', unitPrice: vatMode === 'VAT_INCLUDED' ? '58.50' : '55', discountAmount: '10', vatRate: '0.07', whtRate: expenseWhtLineRate(whtInput, '0.03') },
    ...(['EXEMPT', 'ZERO_RATED', 'NON_VAT'] as const).map((vatTreatment, index) => ({
      lineNumber: index + 2, quantity: '1', unitPrice: '50', discountAmount: '0', vatRate: '0', vatTreatment, whtRate: expenseWhtLineRate(whtInput, '0.03'),
    })),
  ];
  const vat = reconcileExpenseVat({ vatMode, lines: units, source: { inputType: 'AMOUNT', vatAmount: sourceVat } });
  assert.equal(applyExpenseWhtInput(vat, whtInput), null);
  return { vatMode, ...vat.totals, whtInputJson: whtInput, vatCaptureSnapshotJson: vat.snapshot,
    lines: units.map((line, index) => ({ ...line, ...vat.lines[index]!.totals })) } as any;
}

describe('explicit document VAT acceptance arithmetic', () => {
  for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
    for (const whtInput of [undefined, { inputType: 'RATE', value: '3' }, { inputType: 'AMOUNT', value: '7.51' }] as const) {
      for (const source of ['8', '6']) {
        it(`${vatMode} source ${source} preserves discount/zero treatment and ${whtInput?.inputType ?? 'legacy'} WHT`, () => {
          const expense = sourceDecisionExpense(vatMode, source, whtInput);
          const before = structuredClone(expense);
          const accepted = acceptExpenseVatSource(expense, { reason: 'Printed total checked', vatLineNumber: 1 });
          assert.deepEqual(expense, before, 'the preparation helper never mutates the saved source');
          assert.equal(accepted.totals.vatAmount, `${source}.0000`);
          assert.equal(accepted.totals.discountAmount, '10.0000');
          assert.equal(Number(accepted.totals.grandTotalAmount), vatMode === 'VAT_INCLUDED' ? 257 : 250 + Number(source));
          assert.equal(Number(accepted.totals.taxableAmount), vatMode === 'VAT_INCLUDED' ? 257 - Number(source) : 250);
          for (const line of accepted.lines.slice(1)) assert.equal(line.totals.vatAmount, '0.0000');
          const expectedWht = whtInput?.inputType === 'AMOUNT' ? '7.5100'
            : calcDocumentTotals({ lines: accepted.lines.map((line) => ({ ...line.totals,
              whtAmount: new Decimal(line.totals.taxableAmount).mul('0.03').toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4),
            })) }).whtAmount;
          assert.equal(accepted.totals.whtAmount, expectedWht);
          assert.equal(accepted.totals.netPayableAmount, new Decimal(accepted.totals.grandTotalAmount).minus(expectedWht).toFixed(4));
          assert.equal(accepted.snapshot.calculation.vatAmount, '7.0000');
          assert.equal(accepted.snapshot.calculation.lineResults[0]!.residualAdjustment, source === '8' ? '1.0000' : '-1.0000');
        });
      }
    }
  }

  it('requires a bounded reason and refuses every explicit zero treatment as a carrier', () => {
    const expense = sourceDecisionExpense('VAT_EXCLUDED');
    for (const vatLineNumber of [2, 3, 4, 99]) {
      assert.throws(() => acceptExpenseVatSource(expense, { reason: 'Checked', vatLineNumber }), /VAT|selected line/);
    }
    assert.throws(() => acceptExpenseVatSource(expense, { reason: ' ', vatLineNumber: 1 }), /reason/);
    assert.throws(() => acceptExpenseVatSource(expense, { reason: 'x'.repeat(501), vatLineNumber: 1 }), /reason/);
  });

  it('applies a mixed-positive-rate difference only to the explicitly selected line', () => {
    const units = [
      { lineNumber: 1, quantity: '1', unitPrice: '100', vatRate: '0.07' },
      { lineNumber: 2, quantity: '1', unitPrice: '100', vatRate: '0.05' },
    ];
    for (const sourceVat of ['15', '4']) {
      const vat = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines: units, source: { inputType: 'AMOUNT', vatAmount: sourceVat } });
      const expense: any = { vatMode: 'VAT_EXCLUDED', ...vat.totals, vatCaptureSnapshotJson: vat.snapshot,
        lines: units.map((line, index) => ({ ...line, ...vat.lines[index]!.totals })) };
      if (sourceVat === '4') {
        assert.throws(() => acceptExpenseVatSource(expense, { reason: 'Checked', vatLineNumber: 2 }), /negative/);
      } else {
        const accepted = acceptExpenseVatSource(expense, { reason: 'Checked', vatLineNumber: 2 });
        assert.equal(accepted.lines[0]!.totals.vatAmount, '7.0000');
        assert.equal(accepted.lines[1]!.totals.vatAmount, '8.0000');
        assert.equal(accepted.totals.vatAmount, '15.0000');
      }
    }
  });

  it('rejects missing, malformed, rate-conflicting, unknown and stale source evidence', () => {
    const mutations: Array<(expense: any) => void> = [
      (e) => { e.vatCaptureSnapshotJson = null; },
      (e) => { e.vatCaptureSnapshotJson.source.vatAmount = null; },
      (e) => { e.vatCaptureSnapshotJson.source.vatAmount = '-1'; },
      (e) => { e.vatCaptureSnapshotJson.source.vatAmount = '8.001'; },
      (e) => { e.vatCaptureSnapshotJson.source.vatAmount = '100000000000000'; },
      (e) => { e.vatCaptureSnapshotJson.source.lineSources = [{ lineNumber: 1, inputType: 'AMOUNT', vatAmount: '8' }]; },
      (e) => { e.vatCaptureSnapshotJson.source.inputType = 'BOTH'; e.vatCaptureSnapshotJson.source.vatRatePercent = '8'; },
      (e) => { e.lines[1].vatRate = null; e.lines[1].vatTreatment = null; },
      (e) => { e.lines[0].unitPrice = '60'; },
      (e) => { e.vatCaptureSnapshotJson.calculation.vatAmount = '6'; },
      (e) => { e.vatAmount = '6'; },
    ];
    for (const mutate of mutations) {
      const expense = sourceDecisionExpense();
      mutate(expense);
      assert.throws(() => acceptExpenseVatSource(expense, { reason: 'Checked', vatLineNumber: 1 }));
    }
  });

  it('rejects negative carriers, WHT beyond the accepted base and aggregate overflow', () => {
    assert.throws(() => acceptExpenseVatSource(sourceDecisionExpense('VAT_INCLUDED', '108'), { reason: 'Checked', vatLineNumber: 1 }), /negative/);
    const wht = sourceDecisionExpense('VAT_INCLUDED', '8', { inputType: 'AMOUNT', value: '250' });
    assert.throws(() => acceptExpenseVatSource(wht, { reason: 'Checked', vatLineNumber: 1 }), /WHT amount/);
    const units = [{ lineNumber: 1, quantity: '1', unitPrice: '90000000000000', vatRate: '0.07' }];
    const result = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines: units, source: { inputType: 'AMOUNT', vatAmount: '20000000000000' } });
    const expense: any = { vatMode: 'VAT_EXCLUDED', ...result.totals, vatCaptureSnapshotJson: result.snapshot,
      lines: [{ ...units[0], ...result.lines[0]!.totals }] };
    assert.throws(() => acceptExpenseVatSource(expense, { reason: 'Checked', vatLineNumber: 1 }), /Decimal\(18,4\)/);
  });
});

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
  it('keeps an explicit withholding base separate from a coupon-discounted total', () => {
    const result = bill(['70.50']);
    assert.equal(applyExpenseWhtInput(result, { inputType: 'RATE', value: '1', baseAmount: '270.50' }), null);
    assert.equal(result.totals.whtAmount, '2.7100');
    assert.equal(result.totals.grandTotalAmount, '70.5000');
    assert.equal(result.totals.netPayableAmount, '67.7900');
    assert.equal(applyExpenseWhtInput(result, { inputType: 'AMOUNT', value: '2.71', baseAmount: '270.50' }), null);
    assert.equal(result.totals.whtAmount, '2.7100');
    assert.notEqual(applyExpenseWhtInput(result, { inputType: 'RATE', value: '100', baseAmount: '270.50' }), null);
  });
  it('never gives a settlement rounding row a withholding allocation', () => {
    const result = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines: [
      { lineNumber: 1, quantity: '1', unitPrice: '1000', vatRate: '0.07' },
      { lineNumber: 2, quantity: '1', unitPrice: '-0.50', vatRate: '0', chargeKind: 'ROUNDING' },
    ] });
    assert.equal(applyExpenseWhtInput(result, { inputType: 'RATE', value: '3', baseAmount: '1000' }), null);
    assert.equal(result.lines[1]!.totals.whtAmount, '0.0000');
    assert.equal(result.totals.grandTotalAmount, '1069.5000');
    assert.equal(result.totals.netPayableAmount, '1039.5000');
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
  it('rounds rate-based withholding once per base and keeps zero and base caps across pricing modes', () => {
    for (const mode of ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      const result = bill(['107', '50'], mode);
      applyExpenseWhtInput(result, { inputType: 'RATE', value: '3' });
      const expected = new Decimal(result.totals.taxableAmount).mul('0.03').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
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

/** Spec §5.1: an additional charge is one printed amount that belongs in the tax base and NOT in
 *  the goods subtotal. The UAT 2026-09-03 BHC bill is the worked example throughout. */
describe('additional charge lines in the document totals', () => {
  const food = calcLineTotals({ quantity: '1', unitPrice: '1520', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' });
  const serviceCharge = calcLineTotals({ quantity: '1', unitPrice: '152', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' });
  const bill = [{ ...food, chargeKind: null }, { ...serviceCharge, chargeKind: 'SERVICE_CHARGE' as const }];

  it('keeps the charge out of subtotal and inside taxable, VAT and grand total', () => {
    const r = calcDocumentTotals({ lines: bill });
    assert.equal(r.subtotalAmount, '1520.0000');
    assert.equal(r.taxableAmount, '1672.0000');
    assert.equal(r.vatAmount, '117.0400');
    assert.equal(r.grandTotalAmount, '1789.0400');
    assert.equal(expenseTotalsIdentityError({ vatMode: 'VAT_EXCLUDED', lines: bill, totals: r }), null);
  });

  it('counts a row with no charge kind as goods, exactly as before', () => {
    const asProducts = bill.map((line) => ({ ...line, chargeKind: null }));
    assert.equal(calcDocumentTotals({ lines: asProducts }).subtotalAmount, '1672.0000');
  });

  it('carries a negative ROUNDING row without eating it as a discount', () => {
    const rounding = calcLineTotals({ quantity: '1', unitPrice: '-0.50', vatMode: 'NO_VAT' });
    assert.equal(rounding.lineSubtotalAmount, '-0.5000');
    assert.equal(rounding.discountAmount, '0.0000');
    assert.equal(rounding.lineTotalAmount, '-0.5000');
    const lines = [{ ...calcLineTotals({ quantity: '1', unitPrice: '100.50', vatMode: 'NO_VAT' }), chargeKind: null },
      { ...rounding, chargeKind: 'ROUNDING' as const }];
    const r = calcDocumentTotals({ lines });
    assert.equal(r.subtotalAmount, '100.5000');
    assert.equal(r.grandTotalAmount, '100.0000');
    assert.equal(expenseTotalsIdentityError({ vatMode: 'NO_VAT', lines, totals: r }), null);
  });
});

/**
 * Finding F8. `reconcileExpenseVat` is where every header re-derivation starts, so the charge flag
 * has to survive the rows it hands back. Two call sites rebuild the totals from exactly those rows —
 * `acceptExpenseVatSource` (the reviewer's "ใช้ยอดตามเอกสาร") and `applyExpenseWhtInput` (every
 * printed WHT: the OCR apply and both draft use-case paths) — and while `chargeKind` was dropped
 * they counted a service charge into `subtotalAmount` and failed the §5.1 identity.
 */
describe('reconciled rows carry the charge flag into every header re-derivation', () => {
  // The Owner's UAT check bill: 270+160+190+30+50+25 = 725 of goods, a 72.00 gratuity, a printed
  // VAT box of 56 against a computed 55.79, printed total 853.
  const checkBill = () => [
    ...['270', '160', '190', '30', '50', '25'].map((unitPrice, index) => ({
      lineNumber: index + 1, quantity: '1', unitPrice, vatRate: '0.07', chargeKind: null,
    })),
    { lineNumber: 7, quantity: '1', unitPrice: '72', vatRate: '0.07', chargeKind: 'SERVICE_CHARGE' as const },
  ];
  // 1000 of goods + a 100 service charge, VAT 77 printed on top, WHT withheld at 3%.
  const whtBill = () => [
    { lineNumber: 1, quantity: '1', unitPrice: '1000', vatRate: '0.07', chargeKind: null },
    { lineNumber: 2, quantity: '1', unitPrice: '100', vatRate: '0.07', chargeKind: 'SERVICE_CHARGE' as const },
  ];
  // The identity is checked against the PERSISTED rows, which keep their own `chargeKind` — the
  // shape `assertExpenseTotalsIdentity` and `ExpenseDetail.totalsIdentity` both compare against.
  const identityError = (
    vatMode: 'VAT_EXCLUDED',
    result: { lines: Array<{ totals: any }>; totals: any },
    inputs: ReadonlyArray<{ chargeKind: string | null }>,
  ) => expenseTotalsIdentityError({
    vatMode,
    totals: result.totals,
    lines: result.lines.map((line, index) => ({ ...line.totals, chargeKind: inputs[index]!.chargeKind as any })),
  });

  it('returns the charge kind on the rows it reconciled', () => {
    const lines = checkBill();
    const vat = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines });
    assert.deepEqual(vat.lines.map((line) => line.chargeKind ?? null),
      [null, null, null, null, null, null, 'SERVICE_CHARGE']);
    // …which is what keeps a re-derivation from those rows alone honest.
    assert.equal(calcDocumentTotals({ lines: vat.lines.map((line) => ({ ...line.totals, chargeKind: line.chargeKind })) })
      .subtotalAmount, '725.0000');
  });

  it('lands the accepted document VAT on the printed 725 / 797 / 56 / 853', () => {
    const lines = checkBill();
    const vat = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines, source: { inputType: 'AMOUNT', vatAmount: '56' } });
    assert.equal(vat.snapshot.reconciliation.status, 'MISMATCH', 'the whole-baht VAT box is 0.21 off the computed 55.79');
    const expense = {
      vatMode: 'VAT_EXCLUDED', whtInputJson: null, ...vat.totals, vatCaptureSnapshotJson: vat.snapshot,
      lines: lines.map((line, index) => ({ ...line, ...vat.lines[index]!.totals })),
    } as any;

    const accepted = acceptExpenseVatSource(expense, { reason: 'ตรวจกับใบเสร็จแล้ว', vatLineNumber: 1 });

    assert.equal(accepted.totals.subtotalAmount, '725.0000', 'the gratuity is a charge, not goods');
    assert.equal(accepted.totals.taxableAmount, '797.0000');
    assert.equal(accepted.totals.vatAmount, '56.0000');
    assert.equal(accepted.totals.grandTotalAmount, '853.0000');
    assert.equal(identityError('VAT_EXCLUDED', accepted, lines), null);
  });

  // `applyExpenseWhtInput` applies a RATE once to the summed base of WITHHELD
  // row's own `taxableAmount`, and uses the base — `totals.taxableAmount` when nothing is excluded,
  // otherwise the withheld rows' taxable sum — to cap and allocate an AMOUNT. Both call shapes in
  // the codebase are pinned: the OCR apply excludes the charge rows (§5.1), the draft use-cases
  // withhold against the whole document.
  it('keeps the goods subtotal when a printed WHT recomputes the header', () => {
    for (const [label, excluded, expectedWht, expectedLineWht] of [
      ['charges excluded (receipt-ocr-apply)', new Set([2]), '30.0000', ['30.0000', '0.0000']],
      ['whole document (expense-draft use-cases)', new Set<number>(), '33.0000', ['30.0000', '3.0000']],
    ] as const) {
      const lines = whtBill();
      const vat = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines, source: { inputType: 'AMOUNT', vatAmount: '77' } });
      assert.equal(applyExpenseWhtInput(vat, { inputType: 'RATE', value: '3' }, excluded), null, label);

      assert.equal(vat.totals.subtotalAmount, '1000.0000', `${label}: the goods are the goods`);
      assert.equal(vat.totals.taxableAmount, '1100.0000', `${label}: the charge is in the tax base`);
      assert.equal(vat.totals.vatAmount, '77.0000', label);
      assert.equal(vat.totals.grandTotalAmount, '1177.0000', label);
      assert.equal(vat.totals.whtAmount, expectedWht, `${label}: the WHT base is unchanged by the subtotal`);
      assert.deepEqual(vat.lines.map((line) => line.totals.whtAmount), [...expectedLineWht], label);
      assert.equal(vat.totals.netPayableAmount,
        new Decimal('1177').minus(expectedWht).toFixed(4), label);
      assert.equal(identityError('VAT_EXCLUDED', vat, lines), null, label);
    }
  });

  // A baht WHT is the one input the base actually divides, so it is what pins "the base is the
  // withheld rows' taxable, charges included unless the caller excluded them".
  it('allocates a baht WHT over the withheld rows, charge row included', () => {
    const lines = whtBill();
    const vat = reconcileExpenseVat({ vatMode: 'VAT_EXCLUDED', lines, source: { inputType: 'AMOUNT', vatAmount: '77' } });
    assert.equal(applyExpenseWhtInput(vat, { inputType: 'AMOUNT', value: '33' }), null);
    assert.deepEqual(vat.lines.map((line) => line.totals.whtAmount), ['30.0000', '3.0000']);
    assert.equal(vat.totals.whtAmount, '33.0000');
    assert.equal(vat.totals.subtotalAmount, '1000.0000');
    assert.equal(identityError('VAT_EXCLUDED', vat, lines), null);
  });
});

describe('expenseTotalsIdentityError', () => {
  const food = { ...calcLineTotals({ quantity: '1', unitPrice: '1520', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' }), chargeKind: null };
  const charge = { ...calcLineTotals({ quantity: '1', unitPrice: '152', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' }), chargeKind: 'SERVICE_CHARGE' as const };
  const lines = [food, charge];
  const good = calcDocumentTotals({ lines });
  const check = (totals: Partial<typeof good>, vatMode: 'VAT_EXCLUDED' | 'VAT_INCLUDED' = 'VAT_EXCLUDED') =>
    expenseTotalsIdentityError({ vatMode, lines, totals: { ...good, ...totals } });

  it('accepts totals that satisfy every equation', () => {
    assert.equal(check({}), null);
  });

  it('rejects a subtotal that swallowed the charge', () => {
    assert.match(check({ subtotalAmount: '1672.0000' })!, /subtotal/);
  });

  it('rejects VAT that is not the sum of the line VAT', () => {
    assert.match(check({ vatAmount: '100.0000' })!, /VAT/);
  });

  it('rejects a grand total that is not taxable plus VAT', () => {
    assert.match(check({ grandTotalAmount: '1800.0000' })!, /grand total/);
  });

  it('rejects a tax base that dropped the charge', () => {
    assert.match(check({ taxableAmount: '1520.0000', grandTotalAmount: '1637.0400' })!, /additional charges/);
  });

  it('leaves the base equation alone under VAT_INCLUDED, where subtotal is the gross figure', () => {
    // The other three still bind, which is what keeps the charge rows pinned into the record.
    assert.equal(check({ taxableAmount: '1520.0000', grandTotalAmount: '1637.0400' }, 'VAT_INCLUDED'), null);
    assert.match(check({ subtotalAmount: '1672.0000' }, 'VAT_INCLUDED')!, /subtotal/);
  });

  it('forgives satang inside the recorded VAT capture tolerance', () => {
    assert.equal(check({ subtotalAmount: '1520.0400' }), null);
    assert.match(check({ subtotalAmount: '1520.0600' })!, /subtotal/);
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
      + 'ตรวจรายการที่ 1 หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล',
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

it('R11 T1: whole-document VAT rounding needs the complete base, single known rate and exact printed gross', () => {
  const lines = Array.from({ length: 70 }, (_, index) => ({ lineNumber: index + 1, quantity: '1', unitPrice: '100.25', vatRate: '0.07' }));
  const input = { vatMode: 'VAT_EXCLUDED' as const, lines, source: { inputType: 'BOTH' as const, vatRatePercent: '7', vatAmount: '491.23' },
    sourceTaxableAmount: '7017.50', sourceGrossAmount: '7508.73' };
  const result = reconcileExpenseVat(input);
  assert.equal(result.snapshot.reconciliation.status, 'MATCHED');
  assert.equal(result.snapshot.calculation.vatAmount, '491.4000');
  assert.equal(result.totals.vatAmount, '491.2300'); assert.equal(result.totals.grandTotalAmount, '7508.7300');
  assert.equal(result.lines.length, 70);
  for (const defective of [
    { ...input, sourceTaxableAmount: '7017.49' },
    { ...input, sourceGrossAmount: '7508.74' },
    { ...input, source: { ...input.source, vatAmount: '491.24' } },
    { ...input, lines: lines.slice(1) },
    { ...input, sourceTaxableAmount: undefined },
  ]) assert.equal(reconcileExpenseVat(defective).snapshot.reconciliation.status, 'MISMATCH');
});

it('per-row VAT source accepts every one of 200 bill rows and refuses 201', () => {
  const lines = Array.from({ length: 200 }, (_, i) => ({ lineNumber: i + 1, inputType: 'AMOUNT', vatAmount: '7' }));
  assert.equal(validateExpenseVatSourceInput({ inputType: 'NONE', lines }, 'VAT_EXCLUDED', lines.map(line => line.lineNumber)), null);
  assert.match(validateExpenseVatSourceInput({ inputType: 'NONE', lines: [...lines, { ...lines[0]!, lineNumber: 201 }] }, 'VAT_EXCLUDED', Array.from({ length: 201 }, (_, i) => i + 1))!, /1 to 200/);
});
