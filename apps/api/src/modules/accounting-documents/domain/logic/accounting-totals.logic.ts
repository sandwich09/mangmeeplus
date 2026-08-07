/**
 * Pure domain logic for accounting document totals and money calculations.
 * All amounts stored/returned as string to avoid float drift.
 */

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

function toDecimal(v: string | undefined | null): number {
  const n = parseFloat(v ?? '0');
  return isNaN(n) ? 0 : n;
}

function fmt(v: number): string {
  return v.toFixed(2);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calculateLine(input: LineInput): LineResult {
  const qty = toDecimal(input.quantity);
  const price = toDecimal(input.unitPrice);
  const disc = toDecimal(input.discountAmount);
  const vatRate = toDecimal(input.vatRate);
  const whtRate = toDecimal(input.whtRate);
  const mode = input.vatMode;

  const lineSubtotal = round2(qty * price);
  const lineDiscount = round2(Math.min(disc, lineSubtotal));
  const afterDiscount = round2(lineSubtotal - lineDiscount);

  let taxable = afterDiscount;
  let vatAmount = 0;

  if (mode === 'VAT_EXCLUDED') {
    taxable = afterDiscount;
    vatAmount = round2(taxable * vatRate / 100);
  } else if (mode === 'VAT_INCLUDED') {
    // back-calculate: taxable = total / (1 + rate%)
    taxable = round2(afterDiscount / (1 + vatRate / 100));
    vatAmount = round2(afterDiscount - taxable);
  } else {
    // NO_VAT or EXEMPT
    taxable = afterDiscount;
    vatAmount = 0;
  }

  const whtAmount = round2(taxable * whtRate / 100);
  const lineTotal = mode === 'VAT_EXCLUDED'
    ? round2(taxable + vatAmount)
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
  let subtotal = 0;
  let discount = 0;
  let taxable = 0;
  let vat = 0;
  let wht = 0;

  for (const l of lines) {
    subtotal += toDecimal(l.lineSubtotalAmount);
    discount += toDecimal(l.discountAmount);
    taxable += toDecimal(l.taxableAmount);
    vat += toDecimal(l.vatAmount);
    wht += toDecimal(l.whtAmount);
  }

  const grand = round2(taxable + vat);

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
  if (paid <= 0) return 'UNPAID';
  if (paid >= grand) return 'PAID';
  return 'PARTIALLY_PAID';
}

export function calculateOutstandingAmount(grandTotal: string, paidAmount: string): string {
  const outstanding = round2(Math.max(0, toDecimal(grandTotal) - toDecimal(paidAmount)));
  return fmt(outstanding);
}

export function calculateUnappliedCredit(paymentAmount: string, allocatedAmount: string): string {
  const unapplied = round2(Math.max(0, toDecimal(paymentAmount) - toDecimal(allocatedAmount)));
  return fmt(unapplied);
}
