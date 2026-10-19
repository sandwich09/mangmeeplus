import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcLineTotals, calcDocumentTotals } from '../../../../api/src/modules/expenses/domain/logic/expense-totals.logic';
import { buildManualExpenseLines, calculateManualExpenseTotals } from './expenses.model';
import { manualLineAmount } from './substitute-receipt-wizard.model';
import type { ExpenseVatMode } from '@watchdog-bms/contracts';

const modes: ExpenseVatMode[] = ['NO_VAT', 'VAT_EXCLUDED', 'VAT_INCLUDED', 'EXEMPT', 'NEEDS_REVIEW'];
let seed = 12345;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const decimal = (max: number, dp: number) => ((next() % max) / 10 ** dp).toFixed(dp);
function compare(quantity: string, unitPrice: string, discountAmount: string, vatMode: ExpenseVatMode, vatRate = '0.07') {
  const input = { quantity, unitPrice, discountAmount, vatMode, vatRate };
  const saved = calcDocumentTotals({ lines: [calcLineTotals(input)] });
  const preview = calculateManualExpenseTotals(input);
  assert.deepEqual(preview, { subtotal: Number(saved.taxableAmount), vat: Number(saved.vatAmount), grandTotal: Number(saved.grandTotalAmount) }, JSON.stringify(input));
}
test('manual preview matches server half-up for the audit counterexamples', () => {
  assert.deepEqual(calculateManualExpenseTotals({ quantity: '1', unitPrice: '9.50', vatRate: '0.07', vatMode: 'VAT_EXCLUDED' }), { subtotal: 9.5, vat: 0.67, grandTotal: 10.17 });
  for (const [q, p, total] of [['7', '17.50', 131.08], ['1', '100.074', 107.07]] as const) {
    compare(q, p, '0', 'VAT_EXCLUDED');
    assert.equal(calculateManualExpenseTotals({ quantity: q, unitPrice: p, vatMode: 'VAT_EXCLUDED', vatRate: '0.07' }).grandTotal, total);
  }
});
test('manual preview agrees with line and document totals in 6000 seeded cases across VAT modes', () => {
  for (let i = 0; i < 6000; i++) compare(decimal(100000, 3), decimal(100000000, 4), decimal(10000, 4), modes[i % modes.length]!, ['0', '0.07', '0.10'][i % 3]!);
});
test('substitute preview follows server half-up at 1.005 and in 3000 seeded lines', () => {
  assert.equal(manualLineAmount({ quantity: '1', unitPrice: '1.005' }), 1.01);
  for (let i = 0; i < 3000; i++) {
    const quantity = decimal(10000, 2) || '1'; const unitPrice = decimal(10000000, 4);
    const saved = calcLineTotals({ quantity, unitPrice, vatMode: 'NO_VAT' });
    assert.equal(manualLineAmount({ quantity, unitPrice }), Number(saved.lineTotalAmount));
  }
});
test('manual service charge stays out of goods subtotal for 1000 + 100 and 3000 seeded bills', () => {
  for (let i = 0; i < 3001; i++) {
    const goods = i ? decimal(10000000, 2) : '1000'; const charge = i ? decimal(100000, 2) : '100';
    const lines = buildManualExpenseLines({ items: [{ description: 'สินค้า', quantity: '1', unitPrice: goods, discountAmount: '0' }], serviceChargeAmount: charge, serviceChargeDescription: 'ค่าบริการ', vatRate: '0.07' });
    const saved = calcDocumentTotals({ lines: lines.map(line => ({ ...calcLineTotals({ ...line, vatMode: 'VAT_EXCLUDED' }), chargeKind: line.chargeKind })) });
    assert.equal(Number(saved.subtotalAmount), Number(goods));
    assert.equal(Number(saved.taxableAmount).toFixed(2), (Number(goods) + Number(charge)).toFixed(2));
  }
});
