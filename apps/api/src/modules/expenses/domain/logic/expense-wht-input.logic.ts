import Decimal from 'decimal.js';
import type { ExpenseLineChargeKind, ExpenseWhtInput } from '@watchdog-bms/contracts';
import { calcDocumentTotals, documentTotalsLines, type DocumentTotalsResult, type LineTotalsResult } from './expense-totals.logic';

/** Convert explicit percent once; amount-only source has no asserted tax rate. */
export function expenseWhtLineRate(input: ExpenseWhtInput | null | undefined, legacyRate?: string | null): string | null {
  if (!input) return legacyRate?.trim() || null;
  return input.inputType === 'RATE' ? new Decimal(input.value).div(100).toFixed(4) : null;
}

/** Apply WHT only after VAT reconciliation has fixed the accepted pre-VAT bases.
 * Mutates the prepared accounting result, keeping one accepted set of money fields. */
export function applyExpenseWhtInput(
  result: { lines: Array<{ lineNumber: number; chargeKind?: ExpenseLineChargeKind | null; totals: LineTotalsResult }>; totals: DocumentTotalsResult },
  input: ExpenseWhtInput | null | undefined,
  /** Spec §5.1 (`line-ai-draft-control-spec-th.md`): rows the document did not withhold against —
   *  additional charges such as a service charge or a rounding row. They take no share of the
   *  printed WHT, and they do not dilute the allocation of it across the rows that did. Empty by
   *  default, which is the whole-document behaviour every existing caller relies on. */
  excludedLineNumbers: ReadonlySet<number> = new Set(),
): string | null {
  if (!input) return null;
  const value = new Decimal(input.value);
  const excluded = new Set([...excludedLineNumbers, ...result.lines
    .filter((line) => line.chargeKind === 'ROUNDING' || new Decimal(line.totals.taxableAmount).lte(0))
    .map((line) => line.lineNumber)]);
  const withheld = result.lines.filter((line) => !excluded.has(line.lineNumber));
  for (const line of result.lines) {
    if (excluded.has(line.lineNumber)) line.totals.whtAmount = '0.0000';
  }
  const base = withheld.length === result.lines.length
    ? new Decimal(result.totals.taxableAmount)
    : withheld.reduce((sum, line) => sum.plus(line.totals.taxableAmount), new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const sourceBase = input.baseAmount === undefined ? base : new Decimal(input.baseAmount);
  const amount = input.inputType === 'AMOUNT' ? value
    : input.baseAmount === undefined
      ? withheld.reduce((sum, line) => sum.plus(new Decimal(line.totals.taxableAmount).mul(value).div(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), new Decimal(0))
      : sourceBase.mul(value).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (input.inputType === 'AMOUNT' && amount.gt(sourceBase)) return 'WHT amount cannot exceed the accepted pre-VAT amount.';
  if (amount.gt(result.totals.grandTotalAmount) || (amount.gt(0) && base.lte(0))) {
    return 'WHT amount cannot exceed the document total or leave a negative payable.';
  }
  if (input.inputType === 'RATE' && input.baseAmount === undefined) {
    for (const line of withheld) {
      line.totals.whtAmount = new Decimal(line.totals.taxableAmount).mul(value).div(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4);
    }
  } else {
    // Largest remainder allocates exact satang without inventing a four-decimal rate.
    const shares = withheld.map((line) => {
      const raw = base.gt(0) ? amount.mul(100).mul(line.totals.taxableAmount).div(base) : new Decimal(0);
      return { line, cents: raw.floor(), remainder: raw.minus(raw.floor()) };
    });
    let remaining = amount.mul(100).minus(shares.reduce((sum, share) => sum.plus(share.cents), new Decimal(0))).toNumber();
    shares.sort((a, b) => b.remainder.cmp(a.remainder) || a.line.lineNumber - b.line.lineNumber);
    for (const share of shares) {
      if (remaining > 0) { share.cents = share.cents.plus(1); remaining -= 1; }
      share.line.totals.whtAmount = share.cents.div(100).toFixed(4);
    }
  }
  result.totals = calcDocumentTotals({ lines: documentTotalsLines(result.lines) });
  return null;
}
