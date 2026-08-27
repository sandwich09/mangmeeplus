import Decimal from 'decimal.js';
import type { ExpenseWhtInput } from '@watchdog-bms/contracts';
import { calcDocumentTotals, type DocumentTotalsResult, type LineTotalsResult } from './expense-totals.logic';

/** Convert explicit percent once; amount-only source has no asserted tax rate. */
export function expenseWhtLineRate(input: ExpenseWhtInput | null | undefined, legacyRate?: string | null): string | null {
  if (!input) return legacyRate?.trim() || null;
  return input.inputType === 'RATE' ? new Decimal(input.value).div(100).toFixed(4) : null;
}

/** Apply WHT only after VAT reconciliation has fixed the accepted pre-VAT bases.
 * Mutates the prepared accounting result, keeping one accepted set of money fields. */
export function applyExpenseWhtInput(
  result: { lines: Array<{ lineNumber: number; totals: LineTotalsResult }>; totals: DocumentTotalsResult },
  input: ExpenseWhtInput | null | undefined,
): string | null {
  if (!input) return null;
  const value = new Decimal(input.value);
  const base = new Decimal(result.totals.taxableAmount);
  if (input.inputType === 'AMOUNT' && value.gt(base)) return 'WHT amount cannot exceed the accepted pre-VAT amount.';
  if (input.inputType === 'RATE') {
    for (const line of result.lines) {
      line.totals.whtAmount = new Decimal(line.totals.taxableAmount).mul(value).div(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4);
    }
  } else {
    // Largest remainder allocates exact satang without inventing a four-decimal rate.
    const shares = result.lines.map((line) => {
      const raw = base.gt(0) ? value.mul(100).mul(line.totals.taxableAmount).div(base) : new Decimal(0);
      return { line, cents: raw.floor(), remainder: raw.minus(raw.floor()) };
    });
    let remaining = value.mul(100).minus(shares.reduce((sum, share) => sum.plus(share.cents), new Decimal(0))).toNumber();
    shares.sort((a, b) => b.remainder.cmp(a.remainder) || a.line.lineNumber - b.line.lineNumber);
    for (const share of shares) {
      if (remaining > 0) { share.cents = share.cents.plus(1); remaining -= 1; }
      share.line.totals.whtAmount = share.cents.div(100).toFixed(4);
    }
  }
  result.totals = calcDocumentTotals({ lines: result.lines.map((line) => line.totals) });
  return null;
}
