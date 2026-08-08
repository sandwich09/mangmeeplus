import Decimal from 'decimal.js';
import type { ExpenseVatMode } from '@watchdog-bms/contracts';
import { calcDocumentTotals, calcLineTotals, type LineTotalsResult } from './expense-totals.logic';

/** PostgreSQL Decimal(18,4): fourteen integer digits and up to four fractional digits. */
export const EXPENSE_DECIMAL_18_4_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
export const EXPENSE_DECIMAL_18_4_MAX = '99999999999999.9999';

const MAX_DECIMAL = new Decimal(EXPENSE_DECIMAL_18_4_MAX);

export type ExpenseDraftAmountLine = {
  lineNumber: number;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string | null;
  whtRate?: string | null;
};

export type ExpenseDraftAmountInput = {
  vatMode: ExpenseVatMode;
  lines?: readonly (ExpenseDraftAmountLine | null | undefined)[] | null;
};

function parsedDecimal(value: unknown): Decimal | null {
  if (typeof value !== 'string' || !EXPENSE_DECIMAL_18_4_PATTERN.test(value)) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.lte(MAX_DECIMAL) ? parsed : null;
  } catch {
    return null;
  }
}

function lineLabel(line: ExpenseDraftAmountLine, index: number): number {
  return Number.isSafeInteger(line.lineNumber) && line.lineNumber > 0 ? line.lineNumber : index + 1;
}

function validateRate(value: string | null | undefined, label: string): string | null {
  // Blank and absent rates preserve the existing unknown-rate draft flow. Confirmation remains the
  // boundary that requires a VAT rate when the selected VAT mode says one must exist.
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return `${label} must be between 0 and 1 with at most 4 decimal places.`;
  if (value.trim() === '') return null;
  const parsed = parsedDecimal(value);
  return parsed && parsed.gte(0) && parsed.lte(1)
    ? null
    : `${label} must be between 0 and 1 with at most 4 decimal places.`;
}

function calculatedAmountFits(value: string): boolean {
  const parsed = parsedDecimal(value);
  return parsed !== null && parsed.gte(0);
}

function validateCalculatedLine(line: LineTotalsResult, label: number): string | null {
  for (const value of Object.values(line)) {
    if (!calculatedAmountFits(value)) return `Line ${label} calculated amount exceeds Decimal(18,4).`;
  }
  return null;
}

/**
 * Strict persistence-boundary validation for new expense drafts.
 *
 * It rejects exponent notation, signs, leading zeroes, more than four decimal places, non-positive
 * quantities, discounts above the raw line subtotal, rates outside 0..1, line-result overflow, and
 * header aggregate overflow. Unit price zero intentionally remains valid because the general
 * expense flow supports free-of-charge lines; the substitute-receipt mini form applies its stricter
 * positive/satang rule before calling this shared endpoint.
 */
export function validateExpenseDraftAmounts(input: ExpenseDraftAmountInput): string | null {
  if (input.lines !== null && input.lines !== undefined && !Array.isArray(input.lines)) {
    return 'Expense lines must be an array.';
  }
  const lines = input.lines ?? [];
  const calculatedLines: LineTotalsResult[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line || typeof line !== 'object') return `Line ${index + 1} amount fields are required.`;
    const label = lineLabel(line, index);
    const quantity = parsedDecimal(line.quantity);
    if (!quantity || !quantity.gt(0)) {
      return `Line ${label} quantity must be positive and fit Decimal(18,4).`;
    }

    const unitPrice = parsedDecimal(line.unitPrice);
    if (!unitPrice || unitPrice.lt(0)) {
      return `Line ${label} unit price must be non-negative and fit Decimal(18,4).`;
    }

    const discount = parsedDecimal(line.discountAmount ?? '0');
    if (!discount || discount.lt(0)) {
      return `Line ${label} discount must be non-negative and fit Decimal(18,4).`;
    }

    if (discount.gt(quantity.mul(unitPrice))) {
      return `Line ${label} discount cannot exceed its subtotal.`;
    }

    const vatError = validateRate(line.vatRate, `Line ${label} VAT rate`);
    if (vatError) return vatError;
    const whtError = validateRate(line.whtRate, `Line ${label} WHT rate`);
    if (whtError) return whtError;

    const calculated = calcLineTotals({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      vatRate: line.vatRate,
      whtRate: line.whtRate,
      vatMode: input.vatMode,
    });
    const calculatedError = validateCalculatedLine(calculated, label);
    if (calculatedError) return calculatedError;
    calculatedLines.push(calculated);
  }

  const totals = calcDocumentTotals({ lines: calculatedLines });
  if (Object.values(totals).some((value) => !calculatedAmountFits(value))) {
    return 'Expense aggregate amount exceeds Decimal(18,4).';
  }
  return null;
}
