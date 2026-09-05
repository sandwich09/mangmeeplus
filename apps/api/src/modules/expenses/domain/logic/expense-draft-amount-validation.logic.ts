import Decimal from 'decimal.js';
import {
  EXPENSE_DECIMAL_18_4_PATTERN as DECIMAL_18_4,
  EXPENSE_LINE_CHARGE_KINDS,
  expenseChargeKindAllowsNegative,
  type ExpenseLineChargeKind,
  type ExpenseLineVatTreatment,
  type ExpenseVatMode,
} from '@watchdog-bms/contracts';
import { calcDocumentTotals, calcLineTotals, expenseTotalsIdentityError, type DocumentTotalsLine, type LineTotalsResult } from './expense-totals.logic';

/** Re-exported so existing importers keep working; the rule itself is shared with the review form. */
export { EXPENSE_DECIMAL_18_4_PATTERN } from '@watchdog-bms/contracts';
export const EXPENSE_DECIMAL_18_4_MAX = '99999999999999.9999';

const MAX_DECIMAL = new Decimal(EXPENSE_DECIMAL_18_4_MAX);

export type ExpenseDraftAmountLine = {
  lineNumber: number;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string | null;
  vatTreatment?: ExpenseLineVatTreatment | null;
  whtRate?: string | null;
  chargeKind?: ExpenseLineChargeKind | null;
};

export type ExpenseDraftAmountInput = {
  vatMode: ExpenseVatMode;
  lines?: readonly (ExpenseDraftAmountLine | null | undefined)[] | null;
};

/** `signed` is granted only to a ROUNDING charge line — the one row a document may print as a
 *  deduction ("ปัดเศษ -0.50"). Everywhere else a leading minus is still a malformed amount. */
function parsedDecimal(value: unknown, signed = false): Decimal | null {
  if (typeof value !== 'string') return null;
  const magnitude = signed && value.startsWith('-') ? value.slice(1) : value;
  if (!DECIMAL_18_4.test(magnitude)) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.abs().lte(MAX_DECIMAL) ? parsed : null;
  } catch {
    return null;
  }
}

function lineLabel(line: Pick<ExpenseDraftAmountLine, 'lineNumber'>, index: number): number {
  return Number.isSafeInteger(line.lineNumber) && line.lineNumber > 0 ? line.lineNumber : index + 1;
}

/** An explicit zero treatment is independent of Tax Code; absence never implies exemption. */
export function validateExpenseLineVatTreatments(
  lines: readonly { lineNumber: number; vatRate?: string | null; vatTreatment?: unknown }[],
): string | null {
  for (const [index, line] of lines.entries()) {
    if (line.vatTreatment === undefined || line.vatTreatment === null) continue;
    const label = lineLabel(line, index);
    if (typeof line.vatTreatment !== 'string' || !['ZERO_RATED', 'EXEMPT', 'NON_VAT'].includes(line.vatTreatment)) {
      return `Line ${label} VAT treatment must be ZERO_RATED, EXEMPT, or NON_VAT.`;
    }
    if (!parsedDecimal(line.vatRate)?.isZero()) return `Line ${label} VAT treatment requires an explicit zero VAT rate.`;
  }
  return null;
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

function calculatedAmountFits(value: string, signed = false): boolean {
  const parsed = parsedDecimal(value, signed);
  return parsed !== null && (signed || parsed.gte(0));
}

function validateCalculatedLine(line: LineTotalsResult, label: number, signed = false): string | null {
  for (const value of Object.values(line)) {
    if (!calculatedAmountFits(value, signed)) return `Line ${label} calculated amount exceeds Decimal(18,4).`;
  }
  return null;
}

/**
 * Spec §5.1 shape rules for an additional-charge row. A charge is one printed amount, so it carries
 * quantity 1 (which makes `unitPrice` the amount itself), it sorts after every product row, and only
 * ROUNDING may be a deduction — a negative "service charge" is a misread document, not a discount.
 */
export function validateExpenseChargeLines(
  lines: readonly (ExpenseDraftAmountLine | null | undefined)[],
): string | null {
  // The whole array decides the ordering rule, not the rows seen so far: a charge written first
  // still has to sort after a product that appears later in the payload.
  const lastProductLineNumber = lines.reduce(
    (last, line, index) => (line && typeof line === 'object' && line.chargeKind == null
      ? Math.max(last, lineLabel(line, index))
      : last),
    -Infinity,
  );
  for (const [index, line] of lines.entries()) {
    if (!line || typeof line !== 'object') continue;
    const label = lineLabel(line, index);
    const kind = line.chargeKind;
    if (kind === undefined || kind === null) continue;
    if (typeof kind !== 'string' || !(EXPENSE_LINE_CHARGE_KINDS as readonly string[]).includes(kind)) {
      return `Line ${label} charge kind must be one of ${EXPENSE_LINE_CHARGE_KINDS.join(', ')}.`;
    }
    if (label < lastProductLineNumber) {
      return `Line ${label} is an additional charge and must come after every product line.`;
    }
    if (!parsedDecimal(line.quantity)?.eq(1)) {
      return `Line ${label} is an additional charge and must have quantity 1 with the amount in unit price.`;
    }
    const amount = parsedDecimal(line.unitPrice, expenseChargeKindAllowsNegative(kind));
    if (!amount || (!expenseChargeKindAllowsNegative(kind) && !amount.gt(0))) {
      return `Line ${label} additional charge ${kind} must be a positive amount; only ROUNDING may be negative.`;
    }
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
  const calculatedLines: DocumentTotalsLine[] = [];
  const chargeError = validateExpenseChargeLines(lines);
  if (chargeError) return chargeError;

  for (const [index, line] of lines.entries()) {
    if (!line || typeof line !== 'object') return `Line ${index + 1} amount fields are required.`;
    const label = lineLabel(line, index);
    // Only a ROUNDING charge may go below zero, and `validateExpenseChargeLines` above has already
    // proved the kind is real, so the flag cannot be smuggled in on an ordinary product row.
    const signed = line.chargeKind != null && expenseChargeKindAllowsNegative(line.chargeKind);
    const quantity = parsedDecimal(line.quantity);
    if (!quantity || !quantity.gt(0)) {
      return `Line ${label} quantity must be positive and fit Decimal(18,4).`;
    }

    const unitPrice = parsedDecimal(line.unitPrice, signed);
    if (!unitPrice || (!signed && unitPrice.lt(0))) {
      return `Line ${label} unit price must be non-negative and fit Decimal(18,4).`;
    }

    const discount = parsedDecimal(line.discountAmount ?? '0');
    if (!discount || discount.lt(0)) {
      return `Line ${label} discount must be non-negative and fit Decimal(18,4).`;
    }

    // Floored at zero so a negative ROUNDING row (subtotal below zero) is compared against "no
    // discount allowed" rather than reading its own deduction as an over-large discount.
    if (discount.gt(Decimal.max(quantity.mul(unitPrice), 0))) {
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
    const calculatedError = validateCalculatedLine(calculated, label, signed);
    if (calculatedError) return calculatedError;
    calculatedLines.push({ ...calculated, chargeKind: line.chargeKind ?? null });
  }

  const treatmentError = validateExpenseLineVatTreatments(lines as ExpenseDraftAmountLine[]);
  if (treatmentError) return treatmentError;

  const totals = calcDocumentTotals({ lines: calculatedLines });
  // A ROUNDING deduction can legitimately take an aggregate negative on a near-zero draft, so the
  // magnitude — not the sign — is what has to fit the column.
  const signedTotals = calculatedLines.some((line) => line.chargeKind === 'ROUNDING');
  if (Object.values(totals).some((value) => !calculatedAmountFits(value, signedTotals))) {
    return 'Expense aggregate amount exceeds Decimal(18,4).';
  }
  return expenseTotalsIdentityError({ vatMode: input.vatMode, lines: calculatedLines, totals });
}
