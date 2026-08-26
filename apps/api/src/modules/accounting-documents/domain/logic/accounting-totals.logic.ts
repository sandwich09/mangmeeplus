/**
 * Pure domain logic for accounting document totals and money calculations.
 * All amounts stored/returned as string to avoid float drift.
 *
 * Satang policy (LED-FIN-01, income-expense-ledger spec §7): every money component is
 * computed with decimal.js and rounded to 2dp ROUND_HALF_UP at compute time — the same
 * policy as expense-totals.logic.ts. JS float math is forbidden in this file: float
 * round2 loses exact half-satang values (Math.round(1.005 * 100) / 100 === 1), which
 * decimal arithmetic keeps.
 */

import Decimal from 'decimal.js';
import type { AccountingVatMode } from '@watchdog-bms/contracts';

export type LineInput = {
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string;
  vatMode: AccountingVatMode;
  whtRate?: string;
};

export type LineResult = {
  lineSubtotalAmount: string; // quantity * unitPrice
  discountAmount: string;
  taxableAmount: string; // lineSubtotal - discount (pre-VAT base)
  vatAmount: string;
  whtAmount: string;
  lineTotalAmount: string; // taxableAmount + vatAmount (when VAT_EXCLUDED)
};

export type DocumentTotals = {
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
};

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

function toDecimal(v: string | undefined | null): Decimal {
  if (v === undefined || v === null || v === '') return ZERO;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : ZERO;
  } catch {
    return ZERO;
  }
}

function round2(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function fmt(v: Decimal): string {
  return v.toFixed(2);
}

export function calculateLine(input: LineInput): LineResult {
  const qty = toDecimal(input.quantity);
  const price = toDecimal(input.unitPrice);
  const disc = toDecimal(input.discountAmount);
  const vatRate = toDecimal(input.vatRate);
  const whtRate = toDecimal(input.whtRate);
  const mode = input.vatMode;

  const lineSubtotal = round2(qty.mul(price));
  const lineDiscount = round2(Decimal.min(disc, lineSubtotal));
  const afterDiscount = round2(lineSubtotal.minus(lineDiscount));

  let taxable = afterDiscount;
  let vatAmount = ZERO;

  if (mode === 'VAT_EXCLUDED') {
    taxable = afterDiscount;
    vatAmount = round2(taxable.mul(vatRate).div(HUNDRED));
  } else if (mode === 'VAT_INCLUDED') {
    // back-calculate: taxable = total / (1 + rate%)
    taxable = round2(afterDiscount.mul(HUNDRED).div(HUNDRED.plus(vatRate)));
    vatAmount = round2(afterDiscount.minus(taxable));
  } else {
    // NO_VAT or EXEMPT
    taxable = afterDiscount;
    vatAmount = ZERO;
  }

  const whtAmount = round2(taxable.mul(whtRate).div(HUNDRED));
  const lineTotal = mode === 'VAT_EXCLUDED'
    ? round2(taxable.plus(vatAmount))
    : afterDiscount; // VAT_INCLUDED total stays the same

  return {
    lineSubtotalAmount: fmt(lineSubtotal),
    discountAmount: fmt(lineDiscount),
    taxableAmount: fmt(taxable),
    vatAmount: fmt(vatAmount),
    whtAmount: fmt(whtAmount),
    lineTotalAmount: fmt(lineTotal),
  };
}

export function calculateDocumentTotals(
  lines: Array<{ lineSubtotalAmount: string; discountAmount: string; taxableAmount: string; vatAmount: string; whtAmount: string; lineTotalAmount: string }>,
): DocumentTotals {
  let subtotal = ZERO;
  let discount = ZERO;
  let taxable = ZERO;
  let vat = ZERO;
  let wht = ZERO;

  for (const l of lines) {
    subtotal = subtotal.plus(toDecimal(l.lineSubtotalAmount));
    discount = discount.plus(toDecimal(l.discountAmount));
    taxable = taxable.plus(toDecimal(l.taxableAmount));
    vat = vat.plus(toDecimal(l.vatAmount));
    wht = wht.plus(toDecimal(l.whtAmount));
  }

  const grand = round2(taxable.plus(vat));

  return {
    subtotalAmount: fmt(round2(subtotal)),
    discountAmount: fmt(round2(discount)),
    taxableAmount: fmt(round2(taxable)),
    vatAmount: fmt(round2(vat)),
    whtAmount: fmt(round2(wht)),
    grandTotalAmount: fmt(grand),
  };
}

export function calculatePaymentStatus(
  grandTotal: string,
  paidAmount: string,
): 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' {
  const grand = toDecimal(grandTotal);
  const paid = toDecimal(paidAmount);
  if (paid.lte(0)) return 'UNPAID';
  if (paid.gte(grand)) return 'PAID';
  return 'PARTIALLY_PAID';
}

export function calculateOutstandingAmount(grandTotal: string, paidAmount: string): string {
  const outstanding = round2(Decimal.max(0, toDecimal(grandTotal).minus(toDecimal(paidAmount))));
  return fmt(outstanding);
}

export function calculateUnappliedCredit(paymentAmount: string, allocatedAmount: string): string {
  const unapplied = round2(Decimal.max(0, toDecimal(paymentAmount).minus(toDecimal(allocatedAmount))));
  return fmt(unapplied);
}
