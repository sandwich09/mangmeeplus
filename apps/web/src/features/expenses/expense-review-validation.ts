import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { validateExpenseWhtInput } from '@watchdog-bms/contracts';
import { calculateManualExpenseTotals, expenseReviewWithholdsTax, expenseVatSourceValidationMessage, vatModeRequiresRate, vatRateFromPrintedAmount, type ExpenseDraftReviewValues } from './expenses.model';

export type ExpenseFieldIssue = {
  field: string;
  severity: 'error' | 'warn';
  messageKey: DictionaryKey;
  params?: Record<string, string>;
};

type ValidationMessageKey =
  | 'expenses.v_vendor_required'
  | 'expenses.v_too_long'
  | 'expenses.v_tax_id_13'
  | 'expenses.v_date_required'
  | 'expenses.v_date_future'
  | 'expenses.v_date_very_old'
  | 'expenses.v_lines_required'
  | 'expenses.v_description_required'
  | 'expenses.v_quantity_positive'
  | 'expenses.v_number_invalid'
  | 'expenses.v_amount_negative'
  | 'expenses.v_discount_exceeds'
  | 'expenses.v_rate_range'
  | 'expenses.v_vat_rate_required'
  | 'expenses.v_vat_treatment_zero'
  | 'expenses.v_wht_unit'
  | 'expenses.v_wht_percent'
  | 'expenses.v_wht_amount'
  | 'expenses.v_wht_exceeds_base'
  | 'expenses.v_total_mismatch'
  | 'expenses.v_total_zero'
  | 'expenses.v_payee_kind_required';

function addIssue(
  issues: ExpenseFieldIssue[],
  field: string,
  severity: ExpenseFieldIssue['severity'],
  messageKey: ValidationMessageKey,
  params?: Record<string, string>,
): void {
  issues.push({ field, severity, messageKey, ...(params && { params }) });
}

function numberValue(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function computedTotals(values: ExpenseDraftReviewValues): { subtotal: number; grandTotal: number } | null {
  let subtotal = 0;
  let grandTotal = 0;
  for (const line of values.lines) {
    const quantity = numberValue(line.quantity);
    const unitPrice = numberValue(line.unitPrice);
    const discount = numberValue(line.discountAmount);
    const enteredVatRate = numberValue(line.vatRate);
    if (quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0
      || discount === null || discount < 0 || discount > quantity * unitPrice
      || (line.vatRate.trim() !== '' && (enteredVatRate === null || enteredVatRate < 0 || enteredVatRate > 1))) return null;

    const afterDiscount = quantity * unitPrice - discount;
    const totals = calculateManualExpenseTotals({
      quantity: '1',
      unitPrice: afterDiscount,
      vatRate: line.vatRate,
      vatMode: values.vatMode,
    });
    subtotal += totals.subtotal;
    grandTotal += totals.grandTotal;
  }
  return { subtotal, grandTotal };
}

function differsByMoreThanCent(left: number, right: number): boolean {
  const floatingPointSlack = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4;
  return Math.abs(left - right) > 0.01 + floatingPointSlack;
}

/** Only waive the blank-rate input when ERP Core can resolve that rate from supplied evidence. */
function sourceSuppliesVatRate(values: ExpenseDraftReviewValues, index: number): boolean {
  const source = values.vatSource;
  if (!source || expenseVatSourceValidationMessage(source, values.vatMode)) return false;
  const perLine = Boolean(source.lines?.length);
  const selected = perLine ? source.lines!.find((line) => line.lineNumber === index + 1) : source;
  if (!selected) return false;
  if (selected.inputType === 'RATE' || selected.inputType === 'BOTH') return true;
  if (selected.inputType !== 'AMOUNT') return false;
  // A document amount cannot determine which unknown line bears VAT in a mixed document.
  if (!perLine && values.lines.some((line) => line.vatRate.trim() !== '')) return false;
  const lines = perLine ? [values.lines[index]!] : values.lines;
  const afterDiscount = lines.reduce((total, line) => total
    + Math.round(Number(line.quantity) * Number(line.unitPrice) * 100) / 100
    - Math.round(Number(line.discountAmount) * 100) / 100, 0);
  return Number(selected.vatAmount) === 0 || vatRateFromPrintedAmount({
    afterDiscountAmount: afterDiscount, printedVatAmount: selected.vatAmount!, vatMode: values.vatMode,
  }) !== '';
}

export function validateExpenseReview(
  values: ExpenseDraftReviewValues,
  opts: { today: string; aiGrandTotal?: string | null; whtAmount?: string | null },
): ExpenseFieldIssue[] {
  const issues: ExpenseFieldIssue[] = [];

  // RA-18 mirror of `validateConfirm` (`expense-status.logic.ts:199`): a withholding expense may not
  // be confirmed without the payee's taxpayer class, because it decides ภ.ง.ด.3 vs ภ.ง.ด.53. Same
  // predicate the review form uses to show the select at all.
  const withholdsTax = expenseReviewWithholdsTax(values, opts.whtAmount);
  if (withholdsTax && !values.vendorEntityKindSnapshot) {
    addIssue(issues, 'vendorEntityKindSnapshot', 'error', 'expenses.v_payee_kind_required');
  }

  const vendorName = values.vendorNameSnapshot.trim();
  if (!vendorName) addIssue(issues, 'vendorNameSnapshot', 'error', 'expenses.v_vendor_required');
  if (vendorName.length > 200) addIssue(issues, 'vendorNameSnapshot', 'error', 'expenses.v_too_long', { max: '200' });

  const taxId = values.vendorTaxIdSnapshot.trim();
  if (taxId && !/^\d{13}$/.test(taxId.replace(/[- ]/g, ''))) {
    addIssue(issues, 'vendorTaxIdSnapshot', 'error', 'expenses.v_tax_id_13');
  }
  if (values.vendorDocumentNumber.trim().length > 50) {
    addIssue(issues, 'vendorDocumentNumber', 'error', 'expenses.v_too_long', { max: '50' });
  }

  const expenseDate = isoDate(values.expenseDate);
  if (!expenseDate) {
    addIssue(issues, 'expenseDate', 'error', 'expenses.v_date_required');
  } else {
    const today = isoDate(opts.today);
    if (today && expenseDate > today) addIssue(issues, 'expenseDate', 'error', 'expenses.v_date_future');
    if (today) {
      const oldest = new Date(today);
      oldest.setUTCFullYear(oldest.getUTCFullYear() - 5);
      if (expenseDate < oldest) addIssue(issues, 'expenseDate', 'warn', 'expenses.v_date_very_old');
    }
  }

  if (values.lines.length === 0) addIssue(issues, 'lines', 'error', 'expenses.v_lines_required');
  values.lines.forEach((line, index) => {
    const prefix = `lines.${index}`;
    const description = line.description.trim();
    if (!description) addIssue(issues, `${prefix}.description`, 'error', 'expenses.v_description_required');
    if (description.length > 200) addIssue(issues, `${prefix}.description`, 'error', 'expenses.v_too_long', { max: '200' });

    const quantity = numberValue(line.quantity);
    if (quantity === null) addIssue(issues, `${prefix}.quantity`, 'error', 'expenses.v_number_invalid');
    else if (quantity <= 0) addIssue(issues, `${prefix}.quantity`, 'error', 'expenses.v_quantity_positive');

    const unitPrice = numberValue(line.unitPrice);
    if (unitPrice === null) addIssue(issues, `${prefix}.unitPrice`, 'error', 'expenses.v_number_invalid');
    else if (unitPrice < 0) addIssue(issues, `${prefix}.unitPrice`, 'error', 'expenses.v_amount_negative');

    const discount = numberValue(line.discountAmount);
    if (discount === null) addIssue(issues, `${prefix}.discountAmount`, 'error', 'expenses.v_number_invalid');
    else if (discount < 0) addIssue(issues, `${prefix}.discountAmount`, 'error', 'expenses.v_amount_negative');
    else if (quantity !== null && quantity > 0 && unitPrice !== null && unitPrice >= 0 && discount > quantity * unitPrice) {
      addIssue(issues, `${prefix}.discountAmount`, 'error', 'expenses.v_discount_exceeds');
    }

    if (line.vatRate.trim() === '') {
      // Source VAT may supply the rate during draft save. Otherwise unknown remains unanswered;
      // the authoritative reconciliation/confirmation gates still run after the save.
      if (vatModeRequiresRate(values.vatMode) && !sourceSuppliesVatRate(values, index)) {
        addIssue(issues, `${prefix}.vatRate`, 'error', 'expenses.v_vat_rate_required');
      }
    } else {
      const rate = numberValue(line.vatRate);
      if (rate === null || rate < 0 || rate > 1) addIssue(issues, `${prefix}.vatRate`, 'error', 'expenses.v_rate_range');
    }
    if (line.vatTreatment != null && (numberValue(line.vatRate) !== 0
      || !['ZERO_RATED', 'EXEMPT', 'NON_VAT'].includes(line.vatTreatment))) {
      addIssue(issues, `${prefix}.vatRate`, 'error', 'expenses.v_vat_treatment_zero');
    }
  });

  const totals = computedTotals(values);
  if (values.whtInput) {
    const { inputType, value } = values.whtInput;
    if (inputType !== 'RATE' && inputType !== 'AMOUNT') {
      addIssue(issues, 'whtInput.inputType', 'error', 'expenses.v_wht_unit');
    } else if (validateExpenseWhtInput(values.whtInput)) {
      addIssue(issues, 'whtInput.value', 'error', inputType === 'RATE' ? 'expenses.v_wht_percent' : 'expenses.v_wht_amount');
    } else if (inputType === 'AMOUNT' && totals) {
      // ponytail: the server owns VAT reconciliation. Inclusive source VAT can alter the accepted
      // base, so use gross as a safe upper bound there; the API enforces the exact pre-VAT cap.
      const hasVatSource = values.vatSource && (values.vatSource.inputType !== 'NONE' || values.vatSource.lines?.length);
      const base = values.vatMode === 'VAT_INCLUDED' && hasVatSource ? totals.grandTotal : totals.subtotal;
      if (Math.round(Number(value) * 100) > Math.round(base * 100)) {
        addIssue(issues, 'whtInput.value', 'error', 'expenses.v_wht_exceeds_base');
      }
    }
  // Omitted input preserves historical per-line rates; explicit whole-bill input replaces them.
  } else if (values.lines.some((line) => {
    const rate = numberValue(line.whtRate);
    return line.whtRate !== null && line.whtRate.trim() !== '' && (rate === null || rate < 0 || rate > 1);
  })) {
    addIssue(issues, 'whtRate', 'error', 'expenses.v_wht_percent');
  }

  const computed = totals?.grandTotal ?? null;
  const ai = opts.aiGrandTotal?.trim() ? Number(opts.aiGrandTotal.replace(/,/g, '')) : null;
  if (computed !== null && ai !== null && Number.isFinite(ai) && differsByMoreThanCent(computed, ai)) {
    addIssue(issues, 'total', 'warn', 'expenses.v_total_mismatch', { computed: computed.toFixed(2), ai: ai.toFixed(2) });
  }
  if (computed === 0) addIssue(issues, 'total', 'error', 'expenses.v_total_zero');

  return issues;
}
