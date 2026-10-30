import Decimal from 'decimal.js';
import type { ExpenseHistoryChange } from '@watchdog-bms/contracts';

const HEADER_FIELDS = [
  'status', 'vendorNameSnapshot', 'vendorTaxIdSnapshot', 'vendorBranchCodeSnapshot', 'vendorEntityKindSnapshot',
  'vendorAddressSnapshot', 'branchName', 'expenseCategoryName', 'vendorDocumentNumber', 'expenseDate', 'receivedAt', 'dueDate',
  'currency', 'vatMode', 'inputVatClaimStatus', 'sourceDocumentType', 'sourceDocumentLanguage',
  'taxEvidenceStatus', 'taxEvidenceReasonCode', 'note', 'internalMemo', 'missingReceiptReason',
  'subtotalAmount', 'discountAmount', 'taxableAmount', 'vatAmount', 'whtAmount', 'grandTotalAmount', 'netPayableAmount',
] as const;
const LINE_FIELDS = [
  'description', 'expenseCategoryName', 'quantity', 'unitPrice', 'discountAmount', 'taxableAmount', 'vatRate', 'vatAmount',
  'whtRate', 'whtAmount', 'lineSubtotalAmount', 'lineTotalAmount', 'vatTreatment', 'chargeKind',
] as const;
const NUMERIC_FIELD = /Amount$|Rate$|^quantity$|^unitPrice$/;
const LINE_FIELD = new RegExp(`^lines\\.[1-9]\\d*\\.(${LINE_FIELDS.join('|')})$`);

type Snapshot = Record<string, any>;
// A field-keyed object avoids AuditService's 50-item array cap; its text truncation stays explicitly marked.
export type ExpenseHistoryChanges = Record<string, { before: string | null; after: string | null }>;

function displayValue(field: string, value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (NUMERIC_FIELD.test(field)) {
    try { return new Decimal(String(value)).toFixed(); } catch { return null; }
  }
  return typeof value === 'string' ? value : null;
}

/** Called with database snapshots under the expense lock, after replacement lines are persisted. */
export function expenseHistoryChanges(before: Snapshot, after: Snapshot): ExpenseHistoryChanges {
  const changes: ExpenseHistoryChanges = {};
  const compare = (field: string, key: string, old: Snapshot, next: Snapshot) => {
    // Missing columns in legacy snapshots cannot prove a before/after change.
    if (!(key in old) || !(key in next)) return;
    if (key === 'branchName' && old.branchId === next.branchId) return;
    if (key === 'expenseCategoryName' && old.expenseCategoryId === next.expenseCategoryId) return;
    const previous = displayValue(key, old[key]);
    const current = displayValue(key, next[key]);
    if (previous !== current) changes[field] = { before: previous, after: current };
  };
  for (const field of HEADER_FIELDS) compare(field, field, before, after);
  // Lines are compared by their displayed row number, including additions/removals.
  const oldLines = new Map<number, Snapshot>((before.lines ?? []).map((line: Snapshot) => [line.lineNumber, line]));
  const newLines = new Map<number, Snapshot>((after.lines ?? []).map((line: Snapshot) => [line.lineNumber, line]));
  const emptyLine = Object.fromEntries(LINE_FIELDS.map((key) => [key, null]));
  for (const number of [...new Set([...oldLines.keys(), ...newLines.keys()])].sort((a, b) => a - b)) {
    const old = oldLines.get(number);
    const next = newLines.get(number);
    for (const field of LINE_FIELDS) {
      compare(`lines.${number}.${field}`, field, old ?? emptyLine, next ?? emptyLine);
    }
  }
  return changes;
}

/** Only the explicit persisted diff format is public; legacy audit payloads stay action-only. */
export function readExpenseHistoryChanges(metadata: unknown): ExpenseHistoryChange[] {
  const stored = (metadata as { expenseHistoryChanges?: unknown } | null)?.expenseHistoryChanges;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  return Object.entries(stored).flatMap(([field, value]) => {
    if (!(HEADER_FIELDS as readonly string[]).includes(field) && !LINE_FIELD.test(field)) return [];
    if (!value || typeof value !== 'object') return [];
    const { before, after } = value as { before?: unknown; after?: unknown };
    if ((before !== null && typeof before !== 'string') || (after !== null && typeof after !== 'string') || before === after) return [];
    return [{ field, before: before as string | null, after: after as string | null }];
  });
}
