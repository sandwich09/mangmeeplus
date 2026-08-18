import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { calculateManualExpenseTotals, vatModeRequiresRate, type ExpenseDraftReviewValues } from './expenses.model';

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

function computedGrandTotal(values: ExpenseDraftReviewValues): number | null {
  let total = 0;
  for (const line of values.lines) {
    const quantity = numberValue(line.quantity);
    const unitPrice = numberValue(line.unitPrice);
    const discount = numberValue(line.discountAmount);
    const enteredVatRate = numberValue(line.vatRate);
    if (quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0
      || discount === null || discount < 0 || discount > quantity * unitPrice
      || (line.vatRate.trim() !== '' && (enteredVatRate === null || enteredVatRate < 0 || enteredVatRate > 1))) return null;

    const afterDiscount = quantity * unitPrice - discount;
    total += calculateManualExpenseTotals({
      quantity: '1',
      unitPrice: afterDiscount,
      vatRate: line.vatRate,
      vatMode: values.vatMode,
    }).grandTotal;
  }
  return total;
}

function differsByMoreThanCent(left: number, right: number): boolean {
  const floatingPointSlack = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4;
  return Math.abs(left - right) > 0.01 + floatingPointSlack;
}

export function validateExpenseReview(
  values: ExpenseDraftReviewValues,
  opts: { today: string; aiGrandTotal?: string | null; whtAmount?: string | null },
): ExpenseFieldIssue[] {
  const issues: ExpenseFieldIssue[] = [];

  // RA-18 mirror of `validateConfirm` (`expense-status.logic.ts:199`): a withholding expense may not
  // be confirmed without the payee's taxpayer class, because it decides ภ.ง.ด.3 vs ภ.ง.ด.53. Same
  // predicate the review form uses to show the select at all.
  const withholdsTax = Number(opts.whtAmount) > 0 || values.lines.some((line) => Number(line.whtRate) > 0);
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
      // Spec §19g decision 1: a VAT mode asserts that VAT applies, so an unknown rate is an
      // unanswered question, not a zero. Confirmation blocks on the same condition server-side.
      if (vatModeRequiresRate(values.vatMode)) {
        addIssue(issues, `${prefix}.vatRate`, 'error', 'expenses.v_vat_rate_required');
      }
    } else {
      const rate = numberValue(line.vatRate);
      if (rate === null || rate < 0 || rate > 1) addIssue(issues, `${prefix}.vatRate`, 'error', 'expenses.v_rate_range');
    }
  });

  // The web form presents WHT once for the bill and writes the chosen rate to every line. Report a
  // single issue beside that control even for historical drafts whose line rates differ.
  if (values.lines.some((line) => {
    const rate = numberValue(line.whtRate);
    return line.whtRate !== null && line.whtRate.trim() !== '' && (rate === null || rate < 0 || rate > 1);
  })) {
    addIssue(issues, 'whtRate', 'error', 'expenses.v_rate_range');
  }

  const computed = computedGrandTotal(values);
  const ai = opts.aiGrandTotal?.trim() ? Number(opts.aiGrandTotal.replace(/,/g, '')) : null;
  if (computed !== null && ai !== null && Number.isFinite(ai) && differsByMoreThanCent(computed, ai)) {
    addIssue(issues, 'total', 'warn', 'expenses.v_total_mismatch', { computed: computed.toFixed(2), ai: ai.toFixed(2) });
  }
  if (computed === 0) addIssue(issues, 'total', 'error', 'expenses.v_total_zero');

  return issues;
}
