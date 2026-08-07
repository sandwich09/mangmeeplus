import type { ExpenseVatMode } from '@watchdog-bms/contracts';

function d4(n: number): string { return n.toFixed(4); }
function n(s: string | undefined | null): number { return parseFloat(s || '0') || 0; }
// Satang policy (spec §19d): every money component is rounded to 2dp at compute
// time so stored totals equal the printed document (542.06 × 0.07 → 37.94, not
// 37.9442). Columns stay Decimal(18,4); only the value is satang.
function round2(v: number): number { return Math.round(v * 100) / 100; }
// Spec §19g decision 1: an absent rate is unknown, not 7%. This used to default to 0.07, which
// recorded a guessed VAT on documents whose rate was never read and disagreed with the web preview
// that shows none. Unknown contributes no VAT here; `hasUnknownVatRateLine` at confirmation, not a
// silent default, is what stops an unknown rate from becoming final.
function taxRate(value: string | null | undefined): number {
  return n(value);
}
// Pre-§19d rows store 4dp totals (e.g. 580.0042); paying the printed 580.00 must
// settle them. Half a satang forgives only sub-satang residue — a real 0.01
// shortfall stays PARTIALLY_PAID.
const SETTLE_EPSILON = 0.005;

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
  const qty = n(input.quantity);
  const price = n(input.unitPrice);
  const discount = n(input.discountAmount);
  const lineSubtotal = round2(qty * price);
  const discountClamped = round2(Math.min(discount, lineSubtotal));
  const afterDiscount = round2(lineSubtotal - discountClamped);

  let taxable: number;
  let vat: number;

  if (input.vatMode === 'VAT_INCLUDED') {
    const rate = taxRate(input.vatRate);
    // taxable rounds; VAT is the exact remainder so the gross survives intact.
    taxable = rate > 0 ? round2(afterDiscount / (1 + rate)) : afterDiscount;
    vat = round2(afterDiscount - taxable);
  } else if (input.vatMode === 'VAT_EXCLUDED') {
    const rate = taxRate(input.vatRate);
    taxable = afterDiscount;
    vat = round2(taxable * rate);
  } else {
    taxable = afterDiscount;
    vat = 0;
  }

  const whtRate = n(input.whtRate);
  const wht = round2(taxable * whtRate);
  const lineTotal = round2(taxable + vat);

  return {
    lineSubtotalAmount: d4(lineSubtotal),
    discountAmount: d4(discountClamped),
    taxableAmount: d4(taxable),
    vatAmount: d4(vat),
    whtAmount: d4(wht),
    lineTotalAmount: d4(lineTotal),
  };
}

export type DocumentTotalsInput = {
  lines: Array<{ taxableAmount: string; vatAmount: string; whtAmount: string; lineSubtotalAmount: string; discountAmount: string; lineTotalAmount: string }>;
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

export function calcDocumentTotals(input: DocumentTotalsInput): DocumentTotalsResult {
  let subtotal = 0, discount = 0, taxable = 0, vat = 0, wht = 0;
  for (const line of input.lines) {
    subtotal += n(line.lineSubtotalAmount);
    discount += n(line.discountAmount);
    taxable += n(line.taxableAmount);
    vat += n(line.vatAmount);
    wht += n(line.whtAmount);
  }
  const extraDiscount = round2(n(input.extraDiscountAmount));
  discount = round2(discount + extraDiscount);
  taxable = round2(taxable - extraDiscount);
  vat = round2(vat);
  wht = round2(wht);
  const grandTotal = round2(taxable + vat);
  const netPayable = round2(grandTotal - wht);
  return { subtotalAmount: d4(round2(subtotal)), discountAmount: d4(discount), taxableAmount: d4(taxable), vatAmount: d4(vat), whtAmount: d4(wht), grandTotalAmount: d4(grandTotal), netPayableAmount: d4(netPayable) };
}

export function calcPaymentAmounts(netPayableAmount: string, paidAmount: string): { outstandingAmount: string } {
  const outstanding = round2(Math.max(n(netPayableAmount) - n(paidAmount), 0));
  return { outstandingAmount: d4(outstanding) };
}

export function derivePaymentStatus(netPayableAmount: string, paidAmount: string): 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' {
  const paid = n(paidAmount);
  if (paid <= 0) return 'UNPAID';
  if (n(netPayableAmount) - paid < SETTLE_EPSILON) return 'PAID';
  return 'PARTIALLY_PAID';
}
