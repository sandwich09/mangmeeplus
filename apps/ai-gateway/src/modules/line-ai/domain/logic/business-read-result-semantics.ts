import type { SpecialistOutput } from '@watchdog-bms/contracts';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

const LEGACY_INCOMPLETE_KEY = /truncat|partial|capped|incomplete/i;

/** Aggregate truth is independent from bounded detail rows. */
export function aggregationIncomplete(data: UnknownRecord): boolean {
  const completeness = record(data['completeness']);
  const aggregate = completeness?.['aggregate'];
  if (aggregate !== undefined && aggregate !== 'complete') return true;
  return Object.entries(data).some(([key, value]) => LEGACY_INCOMPLETE_KEY.test(key) && Boolean(value));
}

export function appliedPeriod(data: UnknownRecord | undefined): { fromDate: string; toDate: string } | undefined {
  const query = record(data?.['queryApplied']);
  const period = record(query?.['period']);
  const startDate = period?.['startDate'];
  const endDate = period?.['endDate'];
  if (typeof startDate === 'string' && typeof endDate === 'string') return { fromDate: startDate, toDate: endDate };
  return undefined;
}

export function aggregateState(data: UnknownRecord | undefined): 'known' | 'empty' | 'unknown' | 'conflict' {
  if (!data || aggregationIncomplete(data)) return 'unknown';
  if (data['mixedCurrency'] === true && data['totalAmount'] !== null) return 'conflict';
  const facts = Array.isArray(data['facts']) ? data['facts'] : [];
  if (facts.some((item) => record(item)?.['state'] === 'conflict')) return 'conflict';
  if (facts.length > 0 && facts.every((item) => record(item)?.['state'] === 'empty')) return 'empty';
  return 'known';
}

/**
 * Item 2 (223-turn eval batch 2): expense.list_recent AND expense.get_breakdown both resolve a
 * free-text branch/category/vendor name server-side; several matches or none must become a real
 * clarification instead of silently falling through to a misleading zero/empty answer, or (the
 * model-driven path's failure mode) a raw TOOL_RESULT_NO_SOURCE code parroted at the customer.
 * Shared here, not defined in either agent file, because orchestrator.agent.ts and
 * semantic-turn-v2.ts are mutually circular (orchestrator.agent.ts imports runSemanticTurnV2).
 */
export type ExpenseNameResolutionIssue = {
  kind: 'ambiguous' | 'not_found';
  field: 'branch' | 'category' | 'vendor';
  requested: string;
  names: string[];
};

const EXPENSE_NAME_FIELDS = [
  { field: 'branch' as const, ambiguousKey: 'branchAmbiguous', unresolvedKey: 'branchUnresolved', availableKey: 'availableBranches' },
  { field: 'category' as const, ambiguousKey: 'categoryAmbiguous', unresolvedKey: 'categoryUnresolved', availableKey: 'availableCategories' },
  { field: 'vendor' as const, ambiguousKey: 'vendorAmbiguous', unresolvedKey: 'vendorUnresolved', availableKey: 'availableVendors' },
];

/** Reads ONE tool result's raw `data` (never a specialist's shaped facts, which do not carry these
 *  keys through) for a branch/category/vendor ambiguity or not-found marker. */
function expenseNameResolutionIssueFromData(data: UnknownRecord | undefined): ExpenseNameResolutionIssue | undefined {
  if (!data) return undefined;
  for (const { field, ambiguousKey, unresolvedKey, availableKey } of EXPENSE_NAME_FIELDS) {
    const ambiguous = data[ambiguousKey], unresolved = data[unresolvedKey];
    const requested = typeof ambiguous === 'string' ? ambiguous : typeof unresolved === 'string' ? unresolved : undefined;
    if (requested === undefined) continue;
    const available = Array.isArray(data[availableKey]) ? data[availableKey] as Array<UnknownRecord> : [];
    const names = available.map((item) => String(item['name'] ?? '').trim()).filter(Boolean).slice(0, 5);
    return { kind: typeof ambiguous === 'string' ? 'ambiguous' : 'not_found', field, requested, names };
  }
  return undefined;
}

/** Same lookup across every read this turn's expense.list_recent/expense.get_breakdown outputs
 *  carried, classic-path or fast-lane alike. */
export function expenseNameResolutionIssue(outputs: SpecialistOutput[]): ExpenseNameResolutionIssue | undefined {
  for (const output of outputs) {
    for (const entry of output.toolData ?? []) {
      if (entry.tool !== 'expense.list_recent' && entry.tool !== 'expense.get_breakdown') continue;
      const data = entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? entry.data as UnknownRecord : undefined;
      const issue = expenseNameResolutionIssueFromData(data);
      if (issue) return issue;
    }
  }
  return undefined;
}

const EXPENSE_NAME_FIELD_TH: Record<ExpenseNameResolutionIssue['field'], string> = { branch: 'สาขา', category: 'หมวด', vendor: 'ร้าน' };
const EXPENSE_NAME_FIELD_EN: Record<ExpenseNameResolutionIssue['field'], string> = { branch: 'branch', category: 'category', vendor: 'vendor' };

/** Ambiguous -> a real clarifying question (spec: "หมายถึงร้านไหนคะ" + up to 5 options) when the
 *  matches have distinct display names — an actual chat-answerable question. Several matches
 *  sharing the EXACT same display name cannot be told apart in text at all (never print the
 *  internal id/code that could): that case, like not-found, is a terminal statement pointing at
 *  the web app, never a question, never a waiting task. */
export function expenseNameResolutionReplyText(issue: ExpenseNameResolutionIssue, english: boolean): string {
  const th = EXPENSE_NAME_FIELD_TH[issue.field], en = EXPENSE_NAME_FIELD_EN[issue.field];
  const uniqueNames = [...new Set(issue.names)];
  if (issue.kind === 'ambiguous') {
    if (uniqueNames.length > 1) {
      return english ? `Which ${en} do you mean? ${uniqueNames.join(', ')}` : `หมายถึง${th}ไหนคะ ${uniqueNames.join(', ')}`;
    }
    return english
      ? `Several records share the same ${en} name, so I could not identify which one you mean. Please select it in the web app.`
      : `มีหลาย${th}ที่ใช้ชื่อเดียวกัน จึงยังระบุ${th}ที่ต้องการไม่ได้ค่ะ กรุณาเลือก${th}จากหน้าเว็บ`;
  }
  const available = uniqueNames.join(', ');
  return english
    ? `I could not identify the requested ${en}.${available ? ` Available: ${available}.` : ''} Please check and select it in the web app.`
    : `ยังระบุ${th}ที่ต้องการไม่ได้ค่ะ${available ? ` ${th}ที่มี: ${available}` : ''} กรุณาตรวจสอบและเลือก${th}จากหน้าเว็บ`;
}

