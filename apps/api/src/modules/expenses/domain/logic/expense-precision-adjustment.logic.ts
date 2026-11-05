import Decimal from 'decimal.js';
import { isCalculatedExpenseRounding, type UpdateExpenseDraftInput, type ExpenseVatMode, type ExpenseVatSourceInput } from '@watchdog-bms/contracts';
import type { ExpenseRecordWithRelations } from '../models/expense.model';
import { reconcileExpenseVat } from './expense-vat-reconciliation.logic';
import { calcLineTotals } from './expense-totals.logic';

/** Preserve independently evidenced fractional-price and printed item-subtotal adjustments.
 * Edited merchandise/charges must never be silently balanced back to an old OCR total. */
export function normalizeExpensePrecisionAdjustment(
  lines: NonNullable<UpdateExpenseDraftInput['lines']>,
  source: ExpenseVatSourceInput,
  stored: ExpenseRecordWithRelations,
  vatMode: ExpenseVatMode,
): { lines: typeof lines; source: ExpenseVatSourceInput } {
  const automatic = stored.lines.filter(isCalculatedExpenseRounding);
  if (!automatic.length) return { lines, source };
  const isAutomatic = (line: typeof lines[number]) => automatic.some((old) => line.id === old.id
    || (!line.id && line.description === old.description && line.chargeKind === 'ROUNDING'));
  const retained = lines.filter((line) => !isAutomatic(line));
  const original = stored.aiVerifiedFieldsJson ?? {};
  const decimal = (value: unknown): Decimal | null => {
    try { const result = new Decimal(String(value).replace(/,/g, '')); return result.isFinite() ? result : null; } catch { return null; }
  };
  const quantity = decimal(original['quantity']);
  const price = decimal(original['unitPrice']);
  const gross = decimal(original['grandTotalAmount']);
  const product = retained.length === 1 && !retained[0]!.chargeKind ? retained[0] : undefined;
  const printedItems = Array.isArray(original['lines']) ? original['lines'] as Array<{ amount?: unknown }> : [];
  const subtotal = decimal(original['subtotalAmount']);
  const goods = retained.filter(line => !line.chargeKind);
  const storedOther = stored.lines.filter(line => !isCalculatedExpenseRounding(line));
  const unchangedRows = retained.length === storedOther.length && retained.every(line => {
    const old = storedOther.find(row => row.id === line.id);
    return old && (old.chargeKind ?? null) === (line.chargeKind ?? null)
      && ['quantity', 'unitPrice', 'discountAmount', 'vatRate', 'whtRate'].every(key => {
        const before = old[key as keyof typeof old], after = line[key as keyof typeof line];
        return decimal(before ?? '0')?.eq(decimal(after ?? '0') ?? -1);
      });
  });
  if (automatic.length === 1 && printedItems.length >= 2 && goods.length === printedItems.length
    && unchangedRows && subtotal && gross && vatMode === stored.vatMode
    && printedItems.every(item => decimal(item?.amount)?.gte(0))) {
    const rowTotal = printedItems.reduce((sum, item) => sum.plus(decimal(item.amount)!), new Decimal(0));
    const printedGap = subtotal.minus(rowTotal).toDecimalPlaces(2);
    const current = reconcileExpenseVat({ vatMode, lines: retained, source }).totals;
    const difference = gross.minus(current.grandTotalAmount).toDecimalPlaces(2);
    if (!printedGap.isZero() && printedGap.abs().lte(Decimal.min(printedItems.length * 0.01, '0.10'))
      && printedGap.eq(difference)) {
      const old = automatic[0]!;
      retained.push({ id: old.id, lineNumber: old.lineNumber, description: old.description,
        chargeKind: 'ROUNDING', quantity: '1', unitPrice: difference.toFixed(2), discountAmount: '0',
        vatRate: '0', whtRate: '0', expenseCategoryId: old.expenseCategoryId ?? undefined,
        accountHintKey: old.accountHintKey ?? undefined, taxCategory: old.taxCategory ?? undefined });
    }
  }

  if (automatic.length === 1 && product && quantity?.gt(0) && !quantity.isInteger() && price?.gt(0) && gross?.gt(0)
    && vatMode === stored.vatMode && (vatMode === 'VAT_INCLUDED' || vatMode === 'NO_VAT')
    && quantity.eq(decimal(product.quantity) ?? -1) && price.eq(decimal(product.unitPrice) ?? -1)
    && decimal(product.discountAmount ?? '0')?.eq(0)) {
    const difference = gross.minus(calcLineTotals({ ...product, vatMode }).lineTotalAmount).toDecimalPlaces(2);
    if (!difference.isZero() && difference.abs().lte('0.02')) {
      const old = automatic[0]!;
      retained.push({ id: old.id, lineNumber: old.lineNumber, description: old.description,
        chargeKind: 'ROUNDING', quantity: '1', unitPrice: difference.toFixed(2), discountAmount: '0',
        vatRate: '0', whtRate: '0', expenseCategoryId: old.expenseCategoryId ?? undefined,
        accountHintKey: old.accountHintKey ?? undefined, taxCategory: old.taxCategory ?? undefined });
    }
  }
  const sourceNumbers = new Map(retained.map((line, index) => [line.lineNumber, index + 1]));
  const sourceLines = source.lines?.filter((line) => sourceNumbers.has(line.lineNumber))
    .map((line) => ({ ...line, lineNumber: sourceNumbers.get(line.lineNumber)! }));
  return { lines: retained.map((line, index) => ({ ...line, lineNumber: index + 1 })),
    source: source.lines ? { inputType: 'NONE', ...(sourceLines?.length ? { lines: sourceLines } : {}) } : source };
}
