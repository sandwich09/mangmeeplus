import type { ExpenseLineChargeKind, ExpenseVatMode } from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';

function d4(value: Decimal): string { return value.toFixed(4); }
function decimal(s: string | undefined | null): Decimal {
  if (typeof s !== 'string' || s.trim() === '') return new Decimal(0);
  try {
    const value = new Decimal(s);
    return value.isFinite() ? value : new Decimal(0);
  } catch {
    // The arithmetic helpers remain tolerant for OCR/review previews. The create use-case applies
    // strict boundary validation before calling them for a persisted expense.
    return new Decimal(0);
  }
}
// Satang policy (spec §19d): every money component is rounded to 2dp at compute
// time so stored totals equal the printed document (542.06 × 0.07 → 37.94, not
// 37.9442). Columns stay Decimal(18,4); only the value is satang.
function round2(value: Decimal): Decimal { return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP); }
// Spec §19g decision 1: an absent rate is unknown, not 7%. This used to default to 0.07, which
// recorded a guessed VAT on documents whose rate was never read and disagreed with the web preview
// that shows none. Unknown contributes no VAT here; `hasUnknownVatRateLine` at confirmation, not a
// silent default, is what stops an unknown rate from becoming final.
function taxRate(value: string | null | undefined): Decimal {
  return decimal(value);
}
// Pre-§19d rows store 4dp totals (e.g. 580.0042); paying the printed 580.00 must
// settle them. Half a satang forgives only sub-satang residue — a real 0.01
// shortfall stays PARTIALLY_PAID.
export const SETTLE_EPSILON = new Decimal('0.005');

export type LineTotalsInput = {
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string | null;
  whtRate?: string | null;
  vatMode: ExpenseVatMode;
};

export type LineTotalsResult = {
  lineSubtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  lineTotalAmount: string;
};

export function calcLineTotals(input: LineTotalsInput): LineTotalsResult {
  const qty = decimal(input.quantity);
  const price = decimal(input.unitPrice);
  const discount = decimal(input.discountAmount);
  const lineSubtotal = round2(qty.mul(price));
  // Clamp against zero, not against the subtotal: a ROUNDING charge line is negative, and
  // `min(0, -0.50)` would have turned its own amount into a discount and zeroed the row.
  const discountClamped = round2(Decimal.min(discount, Decimal.max(lineSubtotal, 0)));
  const afterDiscount = round2(lineSubtotal.minus(discountClamped));

  let taxable: Decimal;
  let vat: Decimal;

  if (input.vatMode === 'VAT_INCLUDED') {
    const rate = taxRate(input.vatRate);
    // taxable rounds; VAT is the exact remainder so the gross survives intact.
    taxable = rate.gt(0) ? round2(afterDiscount.div(rate.plus(1))) : afterDiscount;
    vat = round2(afterDiscount.minus(taxable));
  } else if (input.vatMode === 'VAT_EXCLUDED') {
    const rate = taxRate(input.vatRate);
    taxable = afterDiscount;
    vat = round2(taxable.mul(rate));
  } else {
    taxable = afterDiscount;
    vat = new Decimal(0);
  }

  const whtRate = decimal(input.whtRate);
  const wht = round2(taxable.mul(whtRate));
  const lineTotal = round2(taxable.plus(vat));

  return {
    lineSubtotalAmount: d4(lineSubtotal),
    discountAmount: d4(discountClamped),
    taxableAmount: d4(taxable),
    vatAmount: d4(vat),
    whtAmount: d4(wht),
    lineTotalAmount: d4(lineTotal),
  };
}

/** `LineTotalsResult` stays pure money — several call sites sweep every value in it as an amount and
 *  write it straight to Prisma — so the charge flag arrives alongside it, not inside it. */
export type DocumentTotalsLine = LineTotalsResult & {
  /** Non-null keeps this row out of `subtotalAmount` — see `calcDocumentTotals`. */
  chargeKind?: ExpenseLineChargeKind | null;
};

export type DocumentTotalsInput = {
  lines: Array<DocumentTotalsLine>;
  extraDiscountAmount?: string;
};

export type DocumentTotalsResult = {
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
};

/** Spec §5.1: `subtotalAmount` is the goods and services total, so an additional charge is counted
 *  once — in the tax base — instead of appearing both as "รวมสินค้า" and again as a charge. Every
 *  other aggregate keeps summing all rows, which is what makes the identity below hold. */
export function calcDocumentTotals(input: DocumentTotalsInput): DocumentTotalsResult {
  let subtotal = new Decimal(0), discount = new Decimal(0), taxable = new Decimal(0), vat = new Decimal(0), wht = new Decimal(0);
  for (const line of input.lines) {
    if (line.chargeKind == null) subtotal = subtotal.plus(decimal(line.lineSubtotalAmount));
    discount = discount.plus(decimal(line.discountAmount));
    taxable = taxable.plus(decimal(line.taxableAmount));
    vat = vat.plus(decimal(line.vatAmount));
    wht = wht.plus(decimal(line.whtAmount));
  }
  const extraDiscount = round2(decimal(input.extraDiscountAmount));
  discount = round2(discount.plus(extraDiscount));
  taxable = round2(taxable.minus(extraDiscount));
  vat = round2(vat);
  wht = round2(wht);
  const grandTotal = round2(taxable.plus(vat));
  const netPayable = round2(grandTotal.minus(wht));
  return { subtotalAmount: d4(round2(subtotal)), discountAmount: d4(discount), taxableAmount: d4(taxable), vatAmount: d4(vat), whtAmount: d4(wht), grandTotalAmount: d4(grandTotal), netPayableAmount: d4(netPayable) };
}

/** Flatten reconciled rows into what `calcDocumentTotals` reads, carrying the charge flag that lives
 *  beside the money rather than in it. Every re-derivation of the document totals goes through this,
 *  which is what keeps an additional charge out of `subtotalAmount` on all of them. */
export function documentTotalsLines(
  lines: readonly { chargeKind?: ExpenseLineChargeKind | null; totals: LineTotalsResult }[],
): DocumentTotalsLine[] {
  return lines.map((line) => ({ ...line.totals, chargeKind: line.chargeKind ?? null }));
}

/** The satang tolerance the VAT capture snapshot records as `toleranceAmount`. Lives here so the
 *  reconciliation and the totals identity compare against the same number. */
export const EXPENSE_TOTALS_TOLERANCE = new Decimal('0.05');

/**
 * Spec §5.1 totals identity, checked on the figures that are about to be stored:
 *
 *   subtotalAmount   = Σ product lineSubtotal
 *   taxableAmount    = subtotalAmount − discountAmount + Σ charge lineSubtotal
 *   vatAmount        = Σ line vat
 *   grandTotalAmount = taxableAmount + vatAmount
 *
 * Returns the reason it does not hold, or null. A record that fails is refused rather than written:
 * the whole point of giving charges their own field is that the tax base counts them exactly once,
 * and a total that no longer adds up is an accounting record nobody can defend.
 *
 * The second equation is skipped under VAT_INCLUDED, where `subtotalAmount` is the VAT-inclusive
 * figure the document printed and the base is derived by dividing it out — the other three still
 * bind, and they are what pin the charge rows into the base.
 */
export function expenseTotalsIdentityError(input: {
  vatMode: ExpenseVatMode;
  lines: readonly DocumentTotalsLine[];
  totals: Pick<DocumentTotalsResult, 'subtotalAmount' | 'discountAmount' | 'taxableAmount' | 'vatAmount' | 'grandTotalAmount'>;
}): string | null {
  const sum = (pick: (line: DocumentTotalsLine) => string, of: (line: DocumentTotalsLine) => boolean): Decimal =>
    input.lines.reduce((total, line) => (of(line) ? total.plus(decimal(pick(line))) : total), new Decimal(0));
  const isCharge = (line: DocumentTotalsLine): boolean => line.chargeKind != null;
  const off = (actual: Decimal, expected: Decimal): boolean =>
    actual.minus(expected).abs().gt(EXPENSE_TOTALS_TOLERANCE);

  const productSubtotal = sum((line) => line.lineSubtotalAmount, (line) => !isCharge(line));
  if (off(decimal(input.totals.subtotalAmount), productSubtotal)) {
    return `Totals identity: subtotal ${input.totals.subtotalAmount} is not the ${productSubtotal.toFixed(2)} the product lines add up to.`;
  }
  if (off(decimal(input.totals.vatAmount), sum((line) => line.vatAmount, () => true))) {
    return `Totals identity: VAT ${input.totals.vatAmount} is not the sum of the line VAT.`;
  }
  if (off(decimal(input.totals.grandTotalAmount), decimal(input.totals.taxableAmount).plus(decimal(input.totals.vatAmount)))) {
    return `Totals identity: grand total ${input.totals.grandTotalAmount} is not taxable plus VAT.`;
  }
  if (input.vatMode !== 'VAT_INCLUDED') {
    const expectedTaxable = productSubtotal
      .minus(decimal(input.totals.discountAmount))
      .plus(sum((line) => line.lineSubtotalAmount, isCharge));
    if (off(decimal(input.totals.taxableAmount), expectedTaxable)) {
      return `Totals identity: taxable ${input.totals.taxableAmount} is not subtotal minus discount plus the additional charges (${expectedTaxable.toFixed(2)}).`;
    }
  }
  return null;
}

export function calcPaymentAmounts(netPayableAmount: string, paidAmount: string): { outstandingAmount: string } {
  const outstanding = round2(Decimal.max(decimal(netPayableAmount).minus(decimal(paidAmount)), 0));
  return { outstandingAmount: d4(outstanding) };
}

export function derivePaymentStatus(netPayableAmount: string, paidAmount: string): 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' {
  const paid = decimal(paidAmount);
  if (paid.lte(0)) return 'UNPAID';
  if (decimal(netPayableAmount).minus(paid).lt(SETTLE_EPSILON)) return 'PAID';
  return 'PARTIALLY_PAID';
}
