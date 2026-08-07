import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetBarClass,
  budgetBarWidth,
  budgetPercent,
  budgetTextClass,
  parseBudgetBahtInput,
  satangToBaht,
  satangToBahtInput,
} from './ai-budget.logic';

describe('satangToBaht', () => {
  it('renders satang as baht with exactly two decimals', () => {
    assert.equal(satangToBaht(0), '฿0.00');
    assert.equal(satangToBaht(1), '฿0.01');
    assert.equal(satangToBaht(123_456), '฿1,234.56');
  });

  it('gives the input field plain baht without separators', () => {
    assert.equal(satangToBahtInput(500_000), '5000');
    // Satang are shown, never rounded away, so an override round-trips through the field intact.
    assert.equal(satangToBahtInput(150), '1.50');
    assert.equal(satangToBahtInput(200_050), '2000.50');
  });
});

describe('parseBudgetBahtInput', () => {
  it('treats an empty field as "clear the override"', () => {
    for (const raw of ['', '   ']) {
      assert.deepEqual(parseBudgetBahtInput(raw), { ok: true, monthlyBudgetSatang: null });
    }
  });

  it('converts whole baht to satang', () => {
    assert.deepEqual(parseBudgetBahtInput('5000'), { ok: true, monthlyBudgetSatang: 500_000 });
    assert.deepEqual(parseBudgetBahtInput(' 1 '), { ok: true, monthlyBudgetSatang: 100 });
  });

  it('accepts up to two decimals, exactly — no float drift on the way to satang', () => {
    assert.deepEqual(parseBudgetBahtInput('2000.50'), { ok: true, monthlyBudgetSatang: 200_050 });
    assert.deepEqual(parseBudgetBahtInput('2000.5'), { ok: true, monthlyBudgetSatang: 200_050 });
    assert.deepEqual(parseBudgetBahtInput('1.01'), { ok: true, monthlyBudgetSatang: 101 });
    assert.deepEqual(parseBudgetBahtInput('1.10'), { ok: true, monthlyBudgetSatang: 110 });
    // The classic binary-float traps: 1.005*100 = 100.49999999999999, 8.2*100 = 819.9999999999999.
    assert.deepEqual(parseBudgetBahtInput('1.99'), { ok: true, monthlyBudgetSatang: 199 });
    assert.deepEqual(parseBudgetBahtInput('8.20'), { ok: true, monthlyBudgetSatang: 820 });
    assert.deepEqual(parseBudgetBahtInput('10000.07'), { ok: true, monthlyBudgetSatang: 1_000_007 });
  });

  it('rejects a third decimal rather than rounding it away silently', () => {
    const parsed = parseBudgetBahtInput('2000.505');
    assert.equal(parsed.ok, false);
    assert.match((parsed as { message: string }).message, /at most two decimals/);
  });

  it('rejects zero without pretending AI can be switched off here', () => {
    const parsed = parseBudgetBahtInput('0');
    assert.equal(parsed.ok, false);
    assert.match((parsed as { message: string }).message, /feature entitlement/);
  });

  it('rejects anything that is not a plain baht amount', () => {
    for (const raw of ['-1', 'abc', '1e', '1e3', '1,000', '๑๐๐', '0.5', '.5', '5.']) {
      assert.equal(parseBudgetBahtInput(raw).ok, false, `expected "${raw}" to be rejected`);
    }
  });
});

describe('budgetPercent', () => {
  it('rounds the month-to-date share and never clamps the number itself', () => {
    assert.equal(budgetPercent(0, 500_000), 0);
    assert.equal(budgetPercent(250_000, 500_000), 50);
    assert.equal(budgetPercent(700_000, 500_000), 140);
  });

  it('returns 0 rather than Infinity/NaN for a non-positive budget', () => {
    assert.equal(budgetPercent(100, 0), 0);
    assert.equal(budgetPercent(100, Number.NaN), 0);
  });

  it('clamps only the bar width', () => {
    assert.equal(budgetBarWidth(140), 100);
    assert.equal(budgetBarWidth(-5), 0);
    assert.equal(budgetBarWidth(42), 42);
  });
});

describe('budget colour thresholds', () => {
  it('goes amber above 80% and red at the cap', () => {
    assert.equal(budgetBarClass(80), 'bg-brand-600');
    assert.equal(budgetBarClass(81), 'bg-yellow-500');
    assert.equal(budgetBarClass(99), 'bg-yellow-500');
    assert.equal(budgetBarClass(100), 'bg-red-500');
    assert.equal(budgetTextClass(50), 'text-gray-500');
    assert.equal(budgetTextClass(90), 'text-yellow-600');
    assert.equal(budgetTextClass(120), 'text-red-600');
  });
});
