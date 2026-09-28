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

// ─── Item 3 (223-turn eval batch 2): period comparisons and breakdown shares ───────────────────
// "เทียบกับเดือนที่แล้วเป็นยังไงบ้าง" style turns kept failing compose because the model computed
// its own difference/percentage across two tool results and grounding correctly rejected numbers
// nobody's tool result actually contained. Compute the SAME arithmetic here, in code, from the
// SAME two already-permission-checked results, so it is never a number the model invented.

type ExpensePeriodTotals = {
  fromDate: string;
  toDate: string;
  totalAmount: string;
  count: number;
  /** Same-shaped sub-split when the tool result carries one: get_breakdown's byCategory rows, or
   *  list_recent's per-payment-status amounts. Matched across periods by `label`. */
  byLabel: Array<{ label: string; totalAmount: string }>;
};

const EXPENSE_STATUS_AMOUNT_LABELS_TH: Record<string, string> = {
  paidAmount: 'จ่ายแล้ว', unpaidAmount: 'ยังไม่จ่าย', confirmedAmount: 'ยืนยันแล้ว', draftAmount: 'ร่าง', pendingAmount: 'รอดำเนินการ',
};

/** Reads a generic "grand total + count, and a same-shaped sub-split when present" out of either
 *  expense.list_recent's or expense.get_breakdown's `data` — comparison and share math never needs
 *  to know which of the two tools produced it. Both already echo `data.period.fromDate/toDate`. */
function expensePeriodTotals(toolName: string, data: UnknownRecord): ExpensePeriodTotals | undefined {
  const period = record(data['period']);
  const fromDate = period?.['fromDate'], toDate = period?.['toDate'];
  if (typeof fromDate !== 'string' || typeof toDate !== 'string') return undefined;
  if (toolName === 'expense.get_breakdown') {
    const totalAmount = data['totalAmount'], totalCount = data['totalCount'];
    if (typeof totalAmount !== 'string' || typeof totalCount !== 'number') return undefined;
    const byCategory = Array.isArray(data['byCategory']) ? data['byCategory'] as UnknownRecord[] : [];
    return { fromDate, toDate, totalAmount, count: totalCount,
      byLabel: byCategory.map((row) => ({ label: String(row['category'] ?? ''), totalAmount: String(row['totalAmount'] ?? '0') })).filter((row) => row.label) };
  }
  if (toolName === 'expense.list_recent') {
    const summary = record(data['summary']);
    const totalAmount = summary?.['totalAmount'];
    if (typeof totalAmount !== 'string' || typeof data['total'] !== 'number') return undefined;
    const byLabel: ExpensePeriodTotals['byLabel'] = [];
    for (const [key, label] of Object.entries(EXPENSE_STATUS_AMOUNT_LABELS_TH)) {
      const value = summary?.[key];
      if (typeof value === 'string') byLabel.push({ label, totalAmount: value });
    }
    return { fromDate, toDate, totalAmount, count: data['total'], byLabel };
  }
  return undefined;
}

function moneyDiff(a: string, b: string): { diff: number; percent?: number } {
  const numA = Number(a), numB = Number(b);
  const diff = numB - numA;
  return { diff, ...(numA !== 0 ? { percent: (diff / Math.abs(numA)) * 100 } : {}) };
}

function formatSignedMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedPercent(percent: number | undefined): string | undefined {
  return percent === undefined ? undefined : `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function periodLabel(period: { fromDate: string; toDate: string }): string {
  return period.fromDate === period.toDate ? period.fromDate : `${period.fromDate} – ${period.toDate}`;
}

/** tuning-3 item 4: same cap as prepared-simple-read-formatter.ts's MAX_BREAKDOWN_GROUPS (R-A2) —
 *  its own constant, since this domain/logic module has no dependency on that agents-layer file. */
const MAX_COMPARISON_GROUPS = 8;

export type ExpensePeriodComparison = {
  /** Labelled facts (Thai) for the compose context AND, via the same decimals() extraction every
   *  other allowed number already goes through, the grounding allow-set — see runSemanticTurnV2.
   *  Unconditionally includes every matching byLabel row (get_breakdown's categories/vendors/branches,
   *  or list_recent's paid/unpaid/confirmed/draft/pending split) — unbounded, and never gated by
   *  tool, so a model composing its own prose always has the full grounding it had before tuning-3. */
  factsText: string;
  periodA: { label: string; totalAmount: string; count: number };
  periodB: { label: string; totalAmount: string; count: number };
  diffAmount: string;
  percent?: string;
  /** tuning-3 item 4 (T-016/T-082): the SAME per-label lines as in `factsText`, but only for a
   *  GROUPED read (expense.get_breakdown's categories/vendors/branches — never list_recent's fixed
   *  status split, which is not a "group" the customer asked for), ranked by whichever period's
   *  amount is larger and capped like the single-period breakdown formatter — for
   *  `expensePeriodComparisonReplyText` to append to the deterministic customer-facing reply. */
  groupLines: string[];
};

/**
 * Item 3(a): two successful reads of the SAME tool with different periods. Computes each period's
 * total, the difference, the percent change (one decimal), and the same per status/category when
 * both periods carry one. `dataA`/`dataB` should be given oldest-period-first for a readable sign
 * (still safe either way — the caller decides which is "A").
 */
export function expensePeriodComparison(toolName: string, dataA: UnknownRecord, dataB: UnknownRecord): ExpensePeriodComparison | undefined {
  const a = expensePeriodTotals(toolName, dataA), b = expensePeriodTotals(toolName, dataB);
  if (!a || !b || (a.fromDate === b.fromDate && a.toDate === b.toDate)) return undefined;
  const labelA = periodLabel(a), labelB = periodLabel(b);
  const total = moneyDiff(a.totalAmount, b.totalAmount);
  const lines = [
    `ช่วง ${labelA}: ${formatSignedMoney(Number(a.totalAmount))} บาท (${a.count} รายการ)`,
    `ช่วง ${labelB}: ${formatSignedMoney(Number(b.totalAmount))} บาท (${b.count} รายการ)`,
    `ต่างกัน ${formatSignedMoney(total.diff)} บาท${formatSignedPercent(total.percent) ? ` (${formatSignedPercent(total.percent)})` : ''}`,
  ];
  const matched = a.byLabel
    .flatMap((rowA) => { const rowB = b.byLabel.find((row) => row.label === rowA.label); return rowB ? [{ rowA, rowB }] : []; })
    .map(({ rowA, rowB }) => {
      const sub = moneyDiff(rowA.totalAmount, rowB.totalAmount);
      const subPercent = formatSignedPercent(sub.percent);
      return { rank: Math.max(Number(rowA.totalAmount), Number(rowB.totalAmount)),
        line: `${rowA.label} — ${labelA}: ${formatSignedMoney(Number(rowA.totalAmount))} บาท, ${labelB}: ${formatSignedMoney(Number(rowB.totalAmount))} บาท, ต่างกัน ${formatSignedMoney(sub.diff)} บาท${subPercent ? ` (${subPercent})` : ''}` };
    });
  for (const { line } of matched) lines.push(line);
  // tuning-3 item 4 (T-016/T-082): ranked by whichever period's amount is larger, same cap as the
  // single-period breakdown formatter, only a label BOTH periods actually returned (spec's own "the
  // change for groups present in both") — get_breakdown only, never list_recent's fixed status
  // split, which already reads fine as the 3 lines above (T-076/077/078/080/081, unflagged today).
  const groupLines = toolName === 'expense.get_breakdown'
    ? matched.sort((left, right) => right.rank - left.rank).slice(0, MAX_COMPARISON_GROUPS).map(({ line }) => line)
    : [];
  return {
    factsText: lines.join('\n'), groupLines,
    periodA: { label: labelA, totalAmount: a.totalAmount, count: a.count },
    periodB: { label: labelB, totalAmount: b.totalAmount, count: b.count },
    diffAmount: formatSignedMoney(total.diff),
    percent: formatSignedPercent(total.percent),
  };
}

/**
 * Item 3(c): the deterministic answer when compose still fails a two-period comparison even with
 * expensePeriodComparison's facts allowed. Exact shape from the spec: "ช่วง A: X บาท (n รายการ) /
 * ช่วง B: Y บาท (m รายการ) / ต่างกัน Z บาท (±P%)", PLUS (tuning-3 item 4) a grouped read's own
 * ranked `groupLines`; source/link are attached by the caller.
 */
export function expensePeriodComparisonReplyText(comparison: ExpensePeriodComparison): string {
  const percent = comparison.percent ? ` (${comparison.percent})` : '';
  const lines = [
    `ช่วง ${comparison.periodA.label}: ${formatSignedMoney(Number(comparison.periodA.totalAmount))} บาท (${comparison.periodA.count} รายการ)`,
    `ช่วง ${comparison.periodB.label}: ${formatSignedMoney(Number(comparison.periodB.totalAmount))} บาท (${comparison.periodB.count} รายการ)`,
    `ต่างกัน ${comparison.diffAmount} บาท${percent}`,
    ...comparison.groupLines,
  ];
  return lines.join('\n');
}

/**
 * Item 3(b): each category/branch/vendor row's share of ITS OWN period's total, computed in code —
 * the same formula prepared-simple-read-formatter.ts's fast lane already uses for the same tool's
 * output — so a "why is X so big" answer can cite a percentage without the model computing one.
 */
export function expenseBreakdownShares(data: UnknownRecord): string {
  const totalAmount = Number(data['totalAmount'] ?? 0);
  if (!(totalAmount > 0)) return '';
  const lines: string[] = [];
  for (const key of ['byCategory', 'byBranch', 'byVendor'] as const) {
    const rows = Array.isArray(data[key]) ? data[key] as UnknownRecord[] : [];
    for (const row of rows) {
      const amount = Number(row['totalAmount'] ?? NaN);
      const label = String(row['category'] ?? row['branch'] ?? row['vendor'] ?? '').trim();
      if (!label || !Number.isFinite(amount)) continue;
      lines.push(`${label}: สัดส่วน ${(amount / totalAmount * 100).toFixed(1)}%`);
    }
  }
  return lines.join('\n');
}
