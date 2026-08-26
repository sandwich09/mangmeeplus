import Decimal from 'decimal.js';
import { civilDayRangeToUtc, isCivilDate, todayCivilDate } from '@watchdog-bms/contracts';
import type { IncomeExpenseLedgerCategoryAmount } from '@watchdog-bms/contracts';

export const INCOME_EXPENSE_LEDGER_TIMEZONE = 'Asia/Bangkok' as const;
const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1_000;

const money = (value: Decimal.Value | null | undefined) => new Decimal(value ?? 0);
const moneyString = (value: Decimal.Value) => money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export function resolveIncomeExpenseLedgerPeriod(from?: string, to?: string, today = todayCivilDate(INCOME_EXPENSE_LEDGER_TIMEZONE)) {
  const resolvedFrom = from ?? `${today.slice(0, 8)}01`;
  const resolvedTo = to ?? today;
  if (!isCivilDate(resolvedFrom) || !isCivilDate(resolvedTo) || resolvedFrom > resolvedTo) {
    return null;
  }
  return { from: resolvedFrom, to: resolvedTo, timezone: INCOME_EXPENSE_LEDGER_TIMEZONE };
}

/** Date-only accounting columns are stored at UTC midnight. */
export function ledgerCivilRange(from: string, to: string) {
  return civilDayRangeToUtc(from, to);
}

/** paidAt is an instant, so Bangkok's local midnight is UTC-7h. */
export function ledgerBangkokInstantRange(from: string, to: string) {
  const range = civilDayRangeToUtc(from, to);
  return {
    ...(range.gte && { gte: new Date(range.gte.getTime() - BANGKOK_UTC_OFFSET_MS) }),
    ...(range.lt && { lt: new Date(range.lt.getTime() - BANGKOK_UTC_OFFSET_MS) }),
  };
}

export function calculateIncomeExpenseLedgerAmounts(input: {
  positiveSales: Decimal.Value;
  creditSales: Decimal.Value;
  receivedCash: Decimal.Value;
  receivedWht: Decimal.Value;
  receivableOutstanding: Decimal.Value;
  recordedExpense: Decimal.Value;
  paidExpense: Decimal.Value;
}) {
  const salesDocumentTotal = money(input.positiveSales).minus(input.creditSales);
  const receivedTotal = money(input.receivedCash).plus(input.receivedWht);
  const recordedExpenseTotal = money(input.recordedExpense);
  const paidExpenseTotal = money(input.paidExpense);
  return {
    salesDocumentTotal: moneyString(salesDocumentTotal),
    receivedTotal: moneyString(receivedTotal),
    withheldTaxTotal: moneyString(input.receivedWht),
    receivableOutstanding: moneyString(input.receivableOutstanding),
    recordedExpenseTotal: moneyString(recordedExpenseTotal),
    paidExpenseTotal: moneyString(paidExpenseTotal),
    cashDifference: moneyString(receivedTotal.minus(paidExpenseTotal)),
    documentDifference: moneyString(salesDocumentTotal.minus(recordedExpenseTotal)),
  };
}

export function mergeSignedCategoryAmounts(
  positive: Array<{ categoryId?: string | null; label?: string | null; amount: Decimal.Value }>,
  negative: Array<{ categoryId?: string | null; label?: string | null; amount: Decimal.Value }> = [],
): IncomeExpenseLedgerCategoryAmount[] {
  const totals = new Map<string, { categoryId?: string; label: string; amount: Decimal }>();
  const add = (row: typeof positive[number], sign: 1 | -1) => {
    const categoryId = row.categoryId ?? undefined;
    const label = row.label?.trim() || 'ยังไม่จัดหมวด';
    const key = categoryId ?? `label:${label}`;
    const current = totals.get(key) ?? { ...(categoryId && { categoryId }), label, amount: new Decimal(0) };
    current.amount = current.amount.plus(money(row.amount).mul(sign));
    totals.set(key, current);
  };
  positive.forEach((row) => add(row, 1));
  negative.forEach((row) => add(row, -1));
  return [...totals.values()]
    .filter((row) => !row.amount.isZero())
    .sort((a, b) => b.amount.abs().cmp(a.amount.abs()) || a.label.localeCompare(b.label, 'th'))
    .map((row) => ({ ...(row.categoryId && { categoryId: row.categoryId }), label: row.label, amount: moneyString(row.amount) }));
}

export function categoryBreakdownMatches(expected: Decimal.Value, rows: IncomeExpenseLedgerCategoryAmount[]): boolean {
  const sum = rows.reduce((total, row) => total.plus(row.amount), new Decimal(0));
  return sum.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(money(expected).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
}
