/**
 * Scores one real-mode turn against its gold `expect` (§10 "ผลตรวจ"). Pure functions only — no
 * network, no DB, no model — so it can be unit-tested with fake evidence (no model, per task brief).
 *
 * Two independent checks feed a turn's pass/fail:
 *  - tool/input equivalence: did the captured tool calls include every gold call (or one of its
 *    `alternatives`), compared on the fields GOLD cares about, after canonicalising periods the
 *    same way `resolveBusinessReadPeriod` does (a `periodKey` and the equivalent `fromDate`/`toDate`
 *    must score equal, and an omitted period must resolve to the tool's own default);
 *  - facts-in-text: every fact the oracle proved (totals, counts, per-group amounts) must appear
 *    somewhere in the delivered text, in ANY Thai-acceptable formatting (§10 "ตัวเลขที่คาดหวัง...
 *    ตรงกับผลของ gold query" / A1), plus the turn's tags (no_tool, must_answer, must_not_refuse,
 *    must_mention_any, must_not_claim, forbidden_tools).
 */
import { resolveBusinessReadPeriod } from '../../apps/api/src/modules/line-ai/domain/logic/business-read-source.logic';
import type { GoldCall, Turn, TurnTags } from './types';

/** The minimal shape of a captured/oracle `ToolResult` the scorer ever reads. */
export type ToolResultLike = { status: string; data?: unknown };

export type CapturedToolCall = { tool: string; input: Record<string, unknown>; result?: ToolResultLike };
export type CapturedEvidence = {
  toolCalls: CapturedToolCall[];
  /** Every delivered message's user-visible text, concatenated — Flex `altText` AND any text/body
   * bubble content, so a fact printed only inside a Flex card still counts as "in the reply". */
  deliveredText: string;
  /** accepted (webhook admitted) -> last required delivery, ms. Null when nothing was delivered. */
  latencyMs: number | null;
  modelCalls: number;
  costSatang: number | null;
  /** The names offered by an ambiguous/unresolved category/vendor/branch result this turn's tool
   * call(s) produced (oracle.ts `extractOfferedChoices`), for the `must_ask_choice` tag. Empty/
   * undefined when no call this turn produced that shape. */
  offeredChoices?: string[];
};

export type CheckResult = { ok: boolean; reasons: string[] };

const PERIOD_KEYS = new Set(['periodKey', 'fromDate', 'toDate']);

/** `{periodKey}` and the equivalent `{fromDate,toDate}` — and an omitted period, which resolves to
 * the tool's own current-month-to-date default — must all canonicalise to the same range. */
function canonicalizePeriod(input: Record<string, unknown>, now: Date): { fromDate: string; toDate: string } | 'invalid' {
  const raw: { periodKey?: unknown; fromDate?: unknown; toDate?: unknown } = {};
  if (input['periodKey'] !== undefined) raw.periodKey = input['periodKey'];
  if (input['fromDate'] !== undefined) raw.fromDate = input['fromDate'];
  if (input['toDate'] !== undefined) raw.toDate = input['toDate'];
  const resolved = resolveBusinessReadPeriod(raw, now);
  return resolved.ok ? { fromDate: resolved.period.fromDate, toDate: resolved.period.toDate } : 'invalid';
}

/** `limit` has a real default (20) baked into ExpenseListRecentTool; an omitted gold `limit` means
 * "don't care", never "must omit it too", so it is intentionally not defaulted/compared here unless
 * gold names it explicitly (handled by the caller only checking keys gold sets). `categoryId`/
 * `vendorId`/`branchId` are handled separately below (DIMENSION_INPUT_KEYS), never here.
 * `groupBy` never appears here on purpose: it lives on `GoldCall` itself (a corpus/fact-extraction
 * selector — "which grouping's top-3 facts to require", oracle.ts breakdownFacts), never inside
 * `input` — confirmed against the 223-turn corpus.tuning.json, which uses it exactly that way 43
 * times. `expense.get_breakdown` has no `groupBy` INPUT to compare: it already returns every
 * grouping (byCategory/byBranch/byVendor) at once, so there is nothing the model sends for this
 * key to "pass through" as tool/input equivalence — `extractExpectedFactsForCall` already honors
 * gold's `groupBy` on the FACTS side, which is where it actually acts. */
const PASSTHROUGH_KEYS = ['documentStatus', 'paymentStatus', 'expenseId', 'limit'];

/** A gold call naming a category/vendor/branch by id OR by name (the model may say "น้ำมัน" where
 * gold says "ค่าน้ำมัน") is judged by what the API actually RESOLVED, never by raw text equality —
 * a branch is included because `branchId` already accepts a name today (ExpenseListRecentTool). */
const DIMENSION_INPUT_KEYS = { category: ['categoryId', 'categoryName'], vendor: ['vendorId', 'vendorName'], branch: ['branchId'] } as const;
type Dimension = keyof typeof DIMENSION_INPUT_KEYS;

type ResolvedOutcome = { kind: 'resolved'; id: string | null } | { kind: 'ambiguous' | 'unresolved' } | { kind: 'not_applicable' };

/** Reads a tool result's ACTUAL resolution for one dimension: `{<dim>Ambiguous}` /
 * `{<dim>Unresolved}` (task item 3) short-circuit to that outcome; otherwise the resolved id comes
 * from `queryApplied.filters.<dim>Id` (category/vendor) or `queryApplied.branch.branchId` (branch)
 * — present on every "ok" ExpenseListRecentTool/ExpenseGetBreakdownTool result today, regardless
 * of whether the input that produced it was an id or a name. */
function resolvedOutcome(result: ToolResultLike | undefined, dimension: Dimension): ResolvedOutcome {
  if (!result || result.status !== 'ok') return { kind: 'not_applicable' };
  const data = (result.data ?? {}) as Record<string, unknown>;
  if (data[`${dimension}Ambiguous`] !== undefined) return { kind: 'ambiguous' };
  if (data[`${dimension}Unresolved`] !== undefined) return { kind: 'unresolved' };
  const queryApplied = (data['queryApplied'] ?? {}) as Record<string, unknown>;
  if (dimension === 'branch') {
    const id = (queryApplied['branch'] as Record<string, unknown> | undefined)?.['branchId'];
    return { kind: 'resolved', id: typeof id === 'string' ? id : null };
  }
  const id = (queryApplied['filters'] as Record<string, unknown> | undefined)?.[`${dimension}Id`];
  return { kind: 'resolved', id: typeof id === 'string' ? id : null };
}

/** Two resolutions match when they are the same OUTCOME KIND (task item 3's "when either side is
 * ambiguous or not-found, compare the outcome kind instead") — and, only when BOTH resolved to a
 * concrete id, when that id is the same. */
function outcomesEquivalent(a: ResolvedOutcome, b: ResolvedOutcome): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'resolved' || b.kind !== 'resolved' || a.id === b.id;
}

function dimensionRequested(input: Record<string, unknown>, dimension: Dimension): boolean {
  return DIMENSION_INPUT_KEYS[dimension].some((key) => input[key as string] !== undefined);
}

/** Compares an ACTUAL captured call against one GOLD call, checking only the fields gold sets
 * (permissive toward extra filters/fields the model added on its own) plus the tool name always. */
export function callMatchesGold(actual: CapturedToolCall, gold: { tool: string; input: Record<string, unknown>; result?: ToolResultLike }, now: Date): boolean {
  if (actual.tool !== gold.tool) return false;
  const goldWantsPeriod = Object.keys(gold.input).some((key) => PERIOD_KEYS.has(key));
  if (goldWantsPeriod) {
    const goldPeriod = canonicalizePeriod(gold.input, now);
    const actualPeriod = canonicalizePeriod(actual.input, now);
    if (goldPeriod === 'invalid' || actualPeriod === 'invalid') return false;
    if (goldPeriod.fromDate !== actualPeriod.fromDate || goldPeriod.toDate !== actualPeriod.toDate) return false;
  }
  for (const dimension of Object.keys(DIMENSION_INPUT_KEYS) as Dimension[]) {
    if (!dimensionRequested(gold.input, dimension)) continue;
    if (gold.result && actual.result) {
      if (!outcomesEquivalent(resolvedOutcome(gold.result, dimension), resolvedOutcome(actual.result, dimension))) return false;
      continue;
    }
    // No oracle/captured result supplied (e.g. a plain unit test with only raw inputs): fall back
    // to raw text on whichever key gold used. Only correct when the model echoes the same string
    // — a real comparison should always supply `result` so the RESOLVED path above runs instead.
    const key = DIMENSION_INPUT_KEYS[dimension].find((candidate) => gold.input[candidate as string] !== undefined)!;
    if (String(actual.input[key as string] ?? '') !== String(gold.input[key as string])) return false;
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (gold.input[key] === undefined) continue;
    if (String(actual.input[key] ?? '') !== String(gold.input[key])) return false;
  }
  return true;
}

/** A gold call is satisfied if ANY captured call matches it OR one of its `alternatives`.
 * `goldResult` is the ORACLE's own run of THIS gold call (undefined for an `alternatives` entry —
 * those fall back to raw-text dimension comparison, an accepted gap since alternatives are rare
 * and rarely name-based). */
function goldCallSatisfied(call: GoldCall, goldResult: ToolResultLike | undefined, actualCalls: CapturedToolCall[], now: Date): boolean {
  const candidates = [{ tool: call.tool, input: call.input as Record<string, unknown>, result: goldResult }, ...(call.alternatives ?? [])
    .map((alt) => ({ tool: alt.tool, input: alt.input as Record<string, unknown>, result: undefined as ToolResultLike | undefined }))];
  return candidates.some((candidate) => actualCalls.some((actual) => callMatchesGold(actual, candidate, now)));
}

/** Every gold call must be satisfied by some captured call (R-U4: several questions in one turn
 * need several tool calls, all present — not just one of them). `goldResults[i]` is the oracle's
 * own result for `goldCalls[i]` (task item "one more scorer rule"); omit it (or leave a gap with
 * `undefined`) to fall back to raw-text comparison for any category/vendor/branch dimension. */
export function scoreToolCalls(goldCalls: GoldCall[], actualCalls: CapturedToolCall[], now: Date, goldResults: Array<ToolResultLike | undefined> = []): CheckResult {
  const reasons: string[] = [];
  goldCalls.forEach((call, index) => {
    if (!goldCallSatisfied(call, goldResults[index], actualCalls, now)) {
      reasons.push(`missing_or_wrong_call:${call.tool}:${JSON.stringify(call.input)}`);
    }
  });
  return { ok: reasons.length === 0, reasons };
}

/** Every Thai-acceptable textual form a money/count value could legitimately appear as (§10):
 * with thousands separators, without them, and — for a whole amount — with or without ".00". */
export function moneyTextVariants(value: string | number): string[] {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return [String(value)];
  const rounded = Math.round(numeric * 100) / 100;
  const fixed = rounded.toFixed(2);
  const grouped = rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const variants = new Set([fixed, grouped]);
  if (Number.isInteger(rounded)) {
    variants.add(String(rounded));
    variants.add(rounded.toLocaleString('en-US'));
  }
  return [...variants];
}

export type ExpectedFact =
  | { kind: 'money'; value: string | number; label?: string }
  | { kind: 'count'; value: string | number; label?: string }
  /** A name copied verbatim from the source data (category, vendor, requester, ...). Exact
   * substring, no formatting variants — this harness does not paraphrase proper nouns. */
  | { kind: 'text'; value: string; label?: string }
  /** A civil date or ISO datetime string. Matched WEAKLY, on the day-of-month digits only (with
   * or without a leading zero) — this harness does not own the reply's Thai date formatting, so
   * it cannot assert the exact rendered string, only that the right day was mentioned somewhere. */
  | { kind: 'date'; value: string; label?: string };

function normalizeForSearch(text: string): string {
  return text.replace(/,/g, '');
}

/** True when `value` (in ANY Thai-acceptable formatting) appears anywhere in `deliveredText`. */
export function factInText(fact: ExpectedFact, deliveredText: string): boolean {
  const haystack = normalizeForSearch(deliveredText);
  if (fact.kind === 'count') return haystack.includes(String(fact.value));
  if (fact.kind === 'money') return moneyTextVariants(fact.value).some((variant) => haystack.includes(normalizeForSearch(variant)));
  if (fact.kind === 'text') return deliveredText.includes(fact.value);
  const day = new Date(fact.value).getUTCDate();
  if (!Number.isFinite(day)) return false;
  return haystack.includes(String(day)) || haystack.includes(String(day).padStart(2, '0'));
}

export function scoreFacts(expectedFacts: ExpectedFact[], deliveredText: string): CheckResult {
  const missing = expectedFacts.filter((fact) => !factInText(fact, deliveredText));
  return { ok: missing.length === 0, reasons: missing.map((fact) => `missing_fact:${fact.kind}:${fact.value}`) };
}

// §8 canned refusal/unsupported copy. Heuristic on purpose (A8 language quality is human-reviewed
// on a sample; this only catches the case where the assistant fell back to a stock non-answer).
const REFUSAL_MARKERS = [
  'ยังดึงข้อมูลส่วนนี้ไม่ได้', 'ยังไม่ได้ทำรายการให้', 'ระบบตอบช้ากว่าปกติ',
  'ยังไม่แน่ใจว่าหมายถึงอะไร', 'ยังไม่มีเรื่อง', 'ไม่มีสิทธิ์ดูส่วนนั้น',
];

// Thai disambiguation-question markers. Thai rarely uses "?"; a clarifying question is a distinct
// interrogative particle/phrase instead — this list is a heuristic, like REFUSAL_MARKERS above.
const CHOICE_QUESTION_MARKERS = ['อันไหน', 'รายการไหน', 'ใช่รายการนี้ไหม', 'หมายถึงอันไหน', 'หมายถึงร้านไหน', 'หมายถึงหมวดไหน', 'หมายถึงสาขาไหน', '?'];

/** "the reply lists at least two of the offered names and asks which one" (task item 3). */
function scoreMustAskChoice(offeredChoices: string[] | undefined, deliveredText: string): CheckResult {
  const reasons: string[] = [];
  const mentioned = (offeredChoices ?? []).filter((name) => deliveredText.includes(name));
  if (mentioned.length < 2) reasons.push(`must_ask_choice_violated:fewer_than_2_names_mentioned:${mentioned.length}`);
  if (!CHOICE_QUESTION_MARKERS.some((marker) => deliveredText.includes(marker))) reasons.push('must_ask_choice_violated:no_question_marker');
  return { ok: reasons.length === 0, reasons };
}

export function scoreTags(tags: TurnTags, evidence: CapturedEvidence): CheckResult {
  const reasons: string[] = [];
  if (tags.must_ask_choice) reasons.push(...scoreMustAskChoice(evidence.offeredChoices, evidence.deliveredText).reasons);
  if (tags.no_tool && evidence.toolCalls.length > 0) reasons.push(`no_tool_violated:${evidence.toolCalls.map((c) => c.tool).join(',')}`);
  if (tags.must_answer && evidence.deliveredText.trim().length === 0) reasons.push('must_answer_violated:empty_reply');
  if (tags.must_not_refuse && REFUSAL_MARKERS.some((marker) => evidence.deliveredText.includes(marker))) {
    reasons.push('must_not_refuse_violated');
  }
  if (tags.must_mention_any?.length && !tags.must_mention_any.some((needle) => evidence.deliveredText.includes(needle))) {
    reasons.push(`must_mention_any_violated:${tags.must_mention_any.join('|')}`);
  }
  for (const forbidden of tags.must_not_claim ?? []) {
    if (evidence.deliveredText.includes(forbidden)) reasons.push(`must_not_claim_violated:${forbidden}`);
  }
  for (const forbiddenTool of tags.forbidden_tools ?? []) {
    if (evidence.toolCalls.some((call) => call.tool === forbiddenTool)) reasons.push(`forbidden_tool_called:${forbiddenTool}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export type TurnScore = {
  conversationId: string;
  turnIndex: number;
  category: string;
  passed: boolean;
  reasons: string[];
};

/** The full per-turn score real mode writes into its evidence/report. `expectedFacts` is the
 * oracle's fact list for this turn's gold calls (empty when the turn has no data expectation). */
export function scoreTurn(
  context: { conversationId: string; turnIndex: number },
  turn: Turn,
  evidence: CapturedEvidence,
  expectedFacts: ExpectedFact[],
  now: Date,
  /** The oracle's own result for each of `turn.expect.calls`, same order — see `scoreToolCalls`. */
  goldResults: Array<ToolResultLike | undefined> = [],
): TurnScore {
  const reasons: string[] = [];
  if (turn.expect.calls?.length) {
    reasons.push(...scoreToolCalls(turn.expect.calls, evidence.toolCalls, now, goldResults).reasons);
    reasons.push(...scoreFacts(expectedFacts, evidence.deliveredText).reasons);
  }
  if (turn.expect.tags) reasons.push(...scoreTags(turn.expect.tags, evidence).reasons);
  return { conversationId: context.conversationId, turnIndex: context.turnIndex, category: turn.category, passed: reasons.length === 0, reasons };
}

export type ScoreSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<string, { total: number; passed: number }>;
  failures: TurnScore[];
};

export function summarizeScores(scores: TurnScore[]): ScoreSummary {
  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const score of scores) {
    const bucket = (byCategory[score.category] ??= { total: 0, passed: 0 });
    bucket.total += 1;
    if (score.passed) bucket.passed += 1;
  }
  const passed = scores.filter((score) => score.passed).length;
  return {
    total: scores.length, passed, failed: scores.length - passed,
    passRate: scores.length ? passed / scores.length : 1, byCategory,
    failures: scores.filter((score) => !score.passed),
  };
}
