import { DISBURSEMENT_VOUCHER_MAX_LINES, type DisbursementPayableExpense } from '@watchdog-bms/contracts';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';

const MONEY = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const scaled = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
};
export function initialAmount(outstanding: string): string {
  const rounded = (scaled(outstanding) + 50n) / 100n;
  const cents = rounded > 9999999999999999n ? 9999999999999999n : rounded;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
/** Two sentences, each true in its own case: the typing is not an amount, or the amount is outside what is still owed. */
export function amountError(amount: string, outstanding: string): string | null {
  const words = workspaceDictionary.th;
  if (!MONEY.test(amount)) return words['expenses.disbursement.amount_format'];
  if (scaled(amount) > 0n && scaled(amount) <= scaled(initialAmount(outstanding))) return null;
  const owed = Number(initialAmount(outstanding)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return words['expenses.disbursement.amount_range'].replace('{outstanding}', `${owed} บาท`);
}
/** Thousands separators, spaces and the currency sign are accepted while typing and never stored. */
export const cleanAmountInput = (value: string) => value.replace(/[,\s฿]/g, '');
/** How a stored amount reads while its box is not being typed in: 19400.00 → 19,400.00. Anything that is not a plain number is shown as typed. */
export function groupAmountInput(value: string): string {
  if (!/^\d+(\.\d*)?$/.test(value)) return value;
  const [whole, ...rest] = value.split('.');
  return [whole!.replace(/\B(?=(\d{3})+$)/g, ','), ...rest].join('.');
}
/** One document holds one branch: once a line is chosen, lines of another branch are shown as not choosable, with the reason. */
export function lockOtherBranchRows(rows: DisbursementPayableExpense[], amounts: Record<string, string>, branchId: string | null | undefined) {
  const locked = (row: DisbursementPayableExpense) => Boolean(branchId && row.branchId && row.branchId !== branchId && amounts[row.expenseId] === undefined);
  return { rows: rows.map(row => locked(row) ? { ...row, selectable: false } : row),
    reasons: Object.fromEntries(rows.filter(locked).map(row => [row.expenseId, workspaceDictionary.th['expenses.disbursement.other_branch']])) as Record<string, string> };
}
export function selectedTotal(amounts: string[]): string {
  const cents = amounts.reduce((sum, amount) => sum + (MONEY.test(amount) ? scaled(amount) / 100n : 0n), 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export function payeeRule(rows: DisbursementPayableExpense[]): 'none' | 'warning' | 'confirm' {
  if (rows.length < 2) return 'none';
  const first = rows[0]!;
  const sameKey = rows.every(row => row.payeeKey === first.payeeKey && row.payeeKeyKind === first.payeeKeyKind);
  if (sameKey && first.payeeKeyKind === 'TAX_ID') return 'none';
  if (sameKey && first.payeeKeyKind === 'NAME' && rows.every(row => !row.vendorTaxId?.trim())) return 'warning';
  return 'confirm';
}
export const selectionAllowed = (count: number) => count < DISBURSEMENT_VOUCHER_MAX_LINES;
export const nextDraftCommand = (current: string | null, changed: boolean, mint: () => string): string => changed || !current ? mint() : current;

export function skipSingleExpenseSelection(entry: DisbursementPayableExpense | null | undefined, candidates: DisbursementPayableExpense[]): boolean {
  return Boolean(entry?.selectable && candidates.filter(row => row.payeeKey === entry.payeeKey && row.selectable).length === 1);
}
