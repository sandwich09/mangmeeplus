import { Decimal } from 'decimal.js';

/**
 * Reviewed company account bindings for expense accrual posting.
 *
 * Chart-of-accounts bootstrap spec §9.2: a company on a governed chart template must resolve its
 * commercial accounts from reviewed configuration, never from `DEFAULT_ACCOUNT_CODES` — those
 * constants predate `TH_SME_COA_V1` and only two of their ten codes still mean what they say there
 * (`1210-00` is ลูกหนี้เงินให้กู้ยืม, `5310-01` is เงินเดือน). Anything unresolved is reported, not guessed.
 */
export type ExpenseAccountBindings = {
  /** ExpenseCategory.id → reviewed ledger account code. A category absent here is unmapped. */
  expenseByCategoryId: ReadonlyMap<string, string>;
  accountsPayableCode: string;
  employeePayableCode: string;
};

export type ExpenseDebitAllocation = { accountCode: string; amount: string };

export type ExpenseDebitResolution =
  | { ok: true; debits: ExpenseDebitAllocation[] }
  | { ok: false; error: string };

function d4(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/**
 * Splits an expense total across the reviewed account of each line's category.
 *
 * The split is proportional to line net amounts rather than a direct sum of them, because the total
 * being allocated is the document gross while `netAmount` is the line's taxable (ex-VAT) base — they
 * differ by the VAT, and by any document-level rounding. Allocating by weight makes the debits
 * re-total to exactly `totalToAllocate`, which is what has to balance against the payable credit.
 *
 * The rounding residual lands on the largest allocation, so the debits never leave a stray 0.0001
 * to unbalance the journal.
 */
export function resolveExpenseDebits(input: {
  totalToAllocate: Decimal.Value;
  lines: ReadonlyArray<{ expenseCategoryId?: string | null; netAmount: Decimal.Value }>;
  bindings: ExpenseAccountBindings;
}): ExpenseDebitResolution {
  const total = new Decimal(input.totalToAllocate ?? 0);

  const unmapped = [...new Set(input.lines.map((line) => line.expenseCategoryId ?? ''))]
    .filter((categoryId) => !categoryId || !input.bindings.expenseByCategoryId.has(categoryId))
    .sort();
  if (unmapped.length > 0) {
    // Stable, actionable code (spec §9.2): the caller writes it to postingError verbatim, so the
    // operator sees exactly which categories still need a reviewed account. An empty id means the
    // line carries no category at all, which is a data problem rather than a mapping gap.
    return { ok: false, error: `expense_account_unmapped:${unmapped.map((id) => id || 'no_category').join(',')}` };
  }
  if (total.isZero()) return { ok: true, debits: [] };

  const netTotal = input.lines.reduce((sum, line) => sum.add(new Decimal(line.netAmount ?? 0)), new Decimal(0));
  // A zero net total with a non-zero expense total cannot be apportioned by weight. It only happens
  // on malformed sources, so it fails loudly instead of silently dumping everything on line one.
  if (netTotal.isZero()) return { ok: false, error: 'expense_allocation_base_zero' };

  const byCode = new Map<string, Decimal>();
  for (const line of input.lines) {
    const code = input.bindings.expenseByCategoryId.get(line.expenseCategoryId!)!;
    const share = new Decimal(line.netAmount ?? 0).div(netTotal).mul(total).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    byCode.set(code, (byCode.get(code) ?? new Decimal(0)).add(share));
  }

  const debits = [...byCode.entries()].map(([accountCode, amount]) => ({ accountCode, amount }));
  const residual = total.minus(debits.reduce((sum, debit) => sum.add(debit.amount), new Decimal(0)));
  if (!residual.isZero()) {
    const largest = debits.reduce((best, debit) => (debit.amount.gt(best.amount) ? debit : best), debits[0]!);
    largest.amount = largest.amount.add(residual);
  }
  return { ok: true, debits: debits.map((debit) => ({ accountCode: debit.accountCode, amount: d4(debit.amount) })) };
}
