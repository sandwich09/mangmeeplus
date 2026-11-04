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
import { checkWorkflowGold, knowledgeNumericFacts, resolveWorkflowDueDate } from './oracle';
import { buildWorkflowSeed } from './seed';
import { workflowMonthKey } from './template';
import { resolveBusinessReadPeriod } from '../../apps/api/src/modules/line-ai/domain/logic/business-read-source.logic';
import { todayCivilDate, DEFAULT_COMPANY_TIME_ZONE } from '../../packages/contracts/src/civil-date';
import type { GoldCall, RequiredFactCategory, Turn, TurnTags, WorkflowConversation, WorkflowCorpus, WorkflowTask, WorkflowTurn } from './types';

/** The minimal shape of a captured/oracle `ToolResult` the scorer ever reads. */
export type ToolResultLike = { status: string; data?: unknown };

export type CapturedToolCall = { tool: string; input: Record<string, unknown>; result?: ToolResultLike };
export type CapturedEvidence = {
  toolCalls: CapturedToolCall[];
  /** Every delivered message's user-visible text, concatenated — Flex `altText` AND any text/body
   * bubble content, so a fact printed only inside a Flex card still counts as "in the reply". */
  deliveredText: string;
  /** Same text as `deliveredText`, but with quick-reply item text/labels excluded — used only by
   * the machine-token quality check (`scoreMachineTokens`, task item D3), which must judge the
   * message BODY a customer actually reads, never a quick-reply button. Optional and falls back to
   * `deliveredText` (gold-oracle-pass.ts always sets it; a hand-written spec fixture need not). */
  deliveredTextExcludingQuickReplies?: string;
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

/** The period range the API itself actually queried — `queryApplied.period.{startDate,endDate}`,
 * present on every "ok" ExpenseListRecentTool/ExpenseGetBreakdownTool result today. Preferred over
 * re-deriving a range client-side (task item 3, "equivalence on the tool's resolved queryApplied
 * period where available") — a genuine disagreement here means the API itself queried different
 * data, never a coincidence of which input shape (`periodKey` vs `fromDate`/`toDate`) either side
 * happened to send (still subject to the current-month relaxation below, D1: a resolved "full
 * current month" and a resolved "month so far" queried identical rows today). */
function resolvedQueryPeriod(result: ToolResultLike | undefined): { startDate: string; endDate: string } | null {
  if (!result || result.status !== 'ok') return null;
  const data = (result.data ?? {}) as Record<string, unknown>;
  const period = ((data['queryApplied'] as Record<string, unknown> | undefined)?.['period']) as Record<string, unknown> | undefined;
  const startDate = period?.['startDate'], endDate = period?.['endDate'];
  return typeof startDate === 'string' && typeof endDate === 'string' ? { startDate, endDate } : null;
}

/** Task item 3 ("period equivalence"), widened by D1 to the RESOLVED `queryApplied.period` path
 * too, not just the raw-input fallback: a `periodKey` naming the CURRENT month resolves to that
 * month's FULL range, but there is no future-dated data — querying "the whole month" and "the
 * month so far" return identical rows today, so a gold `periodKey: "2026-09"` and an actual
 * `fromDate: "2026-09-01", toDate: <today>` (or vice versa) must score equal, whether compared via
 * their raw inputs or via their own captured/oracle results. A PAST month gets no such relaxation:
 * both sides already resolve to the identical full range, so a genuinely truncated past-month range
 * (missing its last few days) still correctly fails, because its `toDate` is not today's date. */
function periodRangesEquivalent(a: { fromDate: string; toDate: string }, b: { fromDate: string; toDate: string }, today: string): boolean {
  if (a.fromDate === b.fromDate && a.toDate === b.toDate) return true;
  if (a.fromDate !== b.fromDate) return false;
  const [longer, shorter] = a.toDate > b.toDate ? [a, b] : [b, a];
  return shorter.toDate === today && longer.toDate >= today;
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
    const today = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now);
    const goldQueryPeriod = resolvedQueryPeriod(gold.result);
    const actualQueryPeriod = resolvedQueryPeriod(actual.result);
    if (goldQueryPeriod && actualQueryPeriod) {
      // D1: the SAME current-month relaxation `periodRangesEquivalent` already gives the raw-input
      // fallback below applies here too — a resolved "full current month" and a resolved "month so
      // far" queried the identical rows today (no future-dated data exists), so they must score
      // equal here as well, never just when a captured result happens to be missing on one side.
      const goldRange = { fromDate: goldQueryPeriod.startDate, toDate: goldQueryPeriod.endDate };
      const actualRange = { fromDate: actualQueryPeriod.startDate, toDate: actualQueryPeriod.endDate };
      if (!periodRangesEquivalent(goldRange, actualRange, today)) return false;
    } else {
      // No captured result on (at least) one side (e.g. a bare unit test with only raw inputs):
      // fall back to canonicalising each side's raw input, with the same current-month relaxation.
      const goldPeriod = canonicalizePeriod(gold.input, now);
      const actualPeriod = canonicalizePeriod(actual.input, now);
      if (goldPeriod === 'invalid' || actualPeriod === 'invalid') return false;
      if (!periodRangesEquivalent(goldPeriod, actualPeriod, today)) return false;
    }
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

/** The gold `total` money fact `oracle.ts`'s `singleMetricFacts` would extract for an
 * `expense.list_recent` result — duplicated narrowly here (not imported from oracle.ts, which
 * imports `ExpectedFact` from THIS file) rather than restructured across both files for one field. */
function goldTotalAmountFact(goldResult: ToolResultLike | undefined): ExpectedFact | null {
  if (!goldResult || goldResult.status !== 'ok' || !goldResult.data) return null;
  const summary = ((goldResult.data as Record<string, unknown>)['summary'] as Record<string, unknown> | undefined) ?? {};
  const value = summary['totalAmount'];
  return value != null ? { kind: 'money', value: value as string | number, label: 'total' } : null;
}

/** D2: true when gold's OWN name resolution (whichever category/vendor/branch dimension its input
 * named) came back ambiguous or unresolved (`resolvedOutcome`) — there is no total to state at all
 * in that case (`goldTotalAmountFact` returns null), so the right reply is the clarification/
 * not-found message instead, never a number. */
function goldNameResolutionUnresolved(call: GoldCall, goldResult: ToolResultLike | undefined): boolean {
  if (!goldResult) return false;
  const input = call.input as Record<string, unknown>;
  return (Object.keys(DIMENSION_INPUT_KEYS) as Dimension[]).some((dimension) => {
    if (!dimensionRequested(input, dimension)) return false;
    const kind = resolvedOutcome(goldResult, dimension).kind;
    return kind === 'ambiguous' || kind === 'unresolved';
  });
}

/** `expense.list_recent` in its default (`single_metric`) shape asks "what's the total" —
 * `expense.get_breakdown` for the SAME resolved period/filters answers a strictly BIGGER question
 * (the total, broken down by category) — task item "equivalent tool for totals". Accepted when the
 * reply actually states the gold total: calling a different tool that never surfaces the number
 * asked for is still a wrong answer. Deliberately NOT reversible — a `breakdown` gold call is never
 * satisfied by a plain `list_recent` actual call (checked by the ordinary candidate match below,
 * tool names simply differ), because a total alone cannot answer "broken down by what".
 *
 * D2: when gold's name resolution was ambiguous/unresolved there is no total to check the reply
 * against — accept the `get_breakdown` call on resolution-OUTCOME equivalence alone instead (same
 * rules `callMatchesGold` already applies to an ordinary ambiguous-vs-ambiguous match), never on a
 * total that does not exist (T-063-b: "เดือนนี้จ่ายสมใจไปเท่าไหร่คะ" — the model called
 * get_breakdown{vendorName:"สมใจ"} and correctly asked which "สมใจ" shop, but scoring failed on the
 * tool name alone). */
function breakdownSatisfiesSingleMetricTotal(
  call: GoldCall, goldResult: ToolResultLike | undefined, actualCalls: CapturedToolCall[], deliveredText: string, now: Date,
): boolean {
  // 'single_metric' is expense.list_recent's own default shape (oracle.ts DEFAULT_ANSWER_SHAPE) —
  // most gold calls never set answerShape explicitly, so treat an unset one as single_metric too.
  if (call.tool !== 'expense.list_recent' || (call.answerShape ?? 'single_metric') !== 'single_metric') return false;
  const totalFact = goldTotalAmountFact(goldResult);
  if (totalFact ? !factInText(totalFact, deliveredText) : !goldNameResolutionUnresolved(call, goldResult)) return false;
  const goldAsListRecent = { tool: call.tool, input: call.input as Record<string, unknown>, result: goldResult };
  return actualCalls.some((actual) => actual.tool === 'expense.get_breakdown' && callMatchesGold({ ...actual, tool: call.tool }, goldAsListRecent, now));
}

/** A gold call is satisfied if ANY captured call matches it OR one of its `alternatives` — or, for
 * an `expense.list_recent` total, an `expense.get_breakdown` call that answered it just as well
 * (`breakdownSatisfiesSingleMetricTotal`). `goldResult` is the ORACLE's own run of THIS gold call
 * (undefined for an `alternatives` entry — those fall back to raw-text dimension comparison, an
 * accepted gap since alternatives are rare and rarely name-based). */
function goldCallSatisfied(call: GoldCall, goldResult: ToolResultLike | undefined, actualCalls: CapturedToolCall[], now: Date, deliveredText: string): boolean {
  const candidates = [{ tool: call.tool, input: call.input as Record<string, unknown>, result: goldResult }, ...(call.alternatives ?? [])
    .map((alt) => ({ tool: alt.tool, input: alt.input as Record<string, unknown>, result: undefined as ToolResultLike | undefined }))];
  if (candidates.some((candidate) => actualCalls.some((actual) => callMatchesGold(actual, candidate, now)))) return true;
  return breakdownSatisfiesSingleMetricTotal(call, goldResult, actualCalls, deliveredText, now);
}

/** Task item 4 ("ambiguous golds"): a question like "เดือนนี้มีรายการค้างจัดการเยอะไหมคะ"
 * legitimately means drafts OR needs-review — the CORPUS names one `documentStatus` as the primary
 * and the other as an `alternatives` entry, but the two answers have DIFFERENT facts (different
 * totals/counts), so scoring must check whichever candidate the model ACTUALLY called, never
 * always the primary's. `candidates[0]` is the primary's own (oracle-derived) facts, `candidates[i]`
 * (i>0) the i-th alternative's; picks whichever one some actual call satisfies (same equivalence
 * `callMatchesGold` already uses for the tool-call check), falling back to the primary's facts when
 * NONE match, so an actually-wrong call still gets a (necessarily failing) fact list to report. */
export function factsForMatchedCandidate(
  call: GoldCall, candidates: ReadonlyArray<{ tool: string; input: Record<string, unknown>; facts: ExpectedFact[] }>,
  actualCalls: CapturedToolCall[], now: Date,
): ExpectedFact[] {
  const goldCandidates = [{ tool: call.tool, input: call.input as Record<string, unknown> }, ...(call.alternatives ?? [])
    .map((alt) => ({ tool: alt.tool, input: alt.input as Record<string, unknown> }))];
  for (let i = 0; i < goldCandidates.length; i++) {
    if (actualCalls.some((actual) => callMatchesGold(actual, goldCandidates[i]!, now))) return candidates[i]?.facts ?? [];
  }
  return candidates[0]?.facts ?? [];
}

/** Every gold call must be satisfied by some captured call (R-U4: several questions in one turn
 * need several tool calls, all present — not just one of them). `goldResults[i]` is the oracle's
 * own result for `goldCalls[i]` (task item "one more scorer rule"); omit it (or leave a gap with
 * `undefined`) to fall back to raw-text comparison for any category/vendor/branch dimension.
 * `deliveredText` feeds only `breakdownSatisfiesSingleMetricTotal` above — every other check here
 * compares tool calls, never reply text. */
export function scoreToolCalls(goldCalls: GoldCall[], actualCalls: CapturedToolCall[], now: Date, goldResults: Array<ToolResultLike | undefined> = [], deliveredText = ''): CheckResult {
  const reasons: string[] = [];
  goldCalls.forEach((call, index) => {
    if (!goldCallSatisfied(call, goldResults[index], actualCalls, now, deliveredText)) {
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

/** Which of a shape's default facts, or which extra one (e.g. `detail`'s `status`, task item 2),
 * a fact belongs to — what a turn's own `expect.requiredFacts` selects by. Optional on every
 * variant below only so a hand-written test fixture that never goes through selection (every
 * oracle.ts extractor always sets it) need not set it either. */
export type ExpectedFact =
  | { kind: 'money'; value: string | number; label?: string; category?: RequiredFactCategory }
  | { kind: 'count'; value: string | number; label?: string; category?: RequiredFactCategory }
  /** A name copied verbatim from the source data (category, vendor, requester, ...). Exact
   * substring, no formatting variants — this harness does not paraphrase proper nouns. */
  | { kind: 'text'; value: string; label?: string; category?: RequiredFactCategory }
  /** A civil date or ISO datetime string. Matched WEAKLY, on the day-of-month digits only (with
   * or without a leading zero) — this harness does not own the reply's Thai date formatting, so
   * it cannot assert the exact rendered string, only that the right day was mentioned somewhere. */
  | { kind: 'date'; value: string; label?: string; category?: RequiredFactCategory }
  /** Payment/document status (task item 2), already mapped to every Thai synonym label a reply
   * might use for that ONE underlying status (e.g. PAID -> ["จ่ายแล้ว","ชำระแล้ว"], never the raw
   * enum) — matched like `text`, but true if ANY synonym is present. For "จ่ายหรือยัง"-style
   * detail questions, via a turn's `requiredFacts: ['status']`. */
  | { kind: 'status'; value: string[]; label?: string; category?: RequiredFactCategory };

function normalizeForSearch(text: string): string {
  return text.replace(/,/g, '');
}

/** True when `value` (in ANY Thai-acceptable formatting) appears anywhere in `deliveredText`. */
export function factInText(fact: ExpectedFact, deliveredText: string): boolean {
  const haystack = normalizeForSearch(deliveredText);
  if (fact.kind === 'count') return haystack.includes(String(fact.value));
  if (fact.kind === 'money') return moneyTextVariants(fact.value).some((variant) => haystack.includes(normalizeForSearch(variant)));
  if (fact.kind === 'text') return deliveredText.includes(fact.value);
  if (fact.kind === 'status') return fact.value.some((synonym) => deliveredText.includes(synonym));
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
  // UAT 2026-09-29: the general-item fallback ("ขอโทษค่ะ น้องมั่งมียังตอบข้อนี้ไม่ได้ …") and the pure-general
  // turn's own failure lines. Without them a greeting that dead-ended still scored as answered.
  'ยังตอบข้อนี้ไม่ได้', 'ยังตอบคำถามนี้ไม่สำเร็จ', 'ยังตรวจสอบคำตอบครบทุกส่วนไม่ได้',
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
  // A stock non-answer is not an answer: a social turn that fell back used to pass on "non-empty" alone.
  else if (tags.must_answer && REFUSAL_MARKERS.some((marker) => evidence.deliveredText.includes(marker))) {
    reasons.push('must_answer_violated:stock_non_answer');
  }
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

// D3: the owner requires plain Thai in every customer-visible reply, no machine tokens — a raw
// internal field name, an uppercase status enum, an ISO date, or a stray markdown artifact leaking
// out of a template. Each check below names one `<kind>` for the `machine_token:<kind>` reason.
const MACHINE_TOKEN_INTERNAL_KEYS = ['expense_total', 'expense_incurred_date', 'exclude_rejected_voided', 'statusBasis', 'dateBasis', 'queryApplied'];
// Case-sensitive and whole-word on purpose — a vendor name like "Grab" must never match.
const MACHINE_TOKEN_STATUS_ENUM = /\b(PAID|UNPAID|PARTIALLY_PAID|NEEDS_REVIEW|DRAFT|CONFIRMED|REJECTED|VOIDED|READY_FOR_CONFIRMATION)\b/;
const MACHINE_TOKEN_STATUS_GLOSS = /\((?:Draft|Needs Review|Confirmed|Paid|Unpaid)\)/i;
const MACHINE_TOKEN_ISO_DATE = /\b20\d\d-\d\d-\d\d\b/;
const MACHINE_TOKEN_VERSION_LABEL = /\(v\d+,/i;
const MACHINE_TOKEN_URL = /https?:\/\/\S+/g;

function hasMachineTokenMarkdown(text: string): boolean {
  if (text.includes('**') || text.includes('```')) return true;
  return text.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('#') || (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1);
  });
}

/** D3: flags a machine token in the customer-visible reply — the owner requires plain Thai, never
 * a raw internal field name, enum, ISO date or markdown artifact leaking out of a template. Applied
 * to EVERY turn, regardless of what else the turn expects, over
 * `deliveredTextExcludingQuickReplies` (never a quick-reply button's own text/label — see
 * `CapturedEvidence`). URLs are stripped first so a dashed URL never reads as an ISO date. One
 * reason per KIND found, never per occurrence. */
export function scoreMachineTokens(deliveredText: string): CheckResult {
  const text = deliveredText.replace(MACHINE_TOKEN_URL, '');
  const reasons: string[] = [];
  if (hasMachineTokenMarkdown(text)) reasons.push('machine_token:markdown');
  if (MACHINE_TOKEN_INTERNAL_KEYS.some((key) => text.includes(key))) reasons.push('machine_token:internal_key');
  if (MACHINE_TOKEN_STATUS_ENUM.test(text)) reasons.push('machine_token:status_enum');
  if (MACHINE_TOKEN_STATUS_GLOSS.test(text)) reasons.push('machine_token:status_gloss');
  if (MACHINE_TOKEN_ISO_DATE.test(text)) reasons.push('machine_token:iso_date');
  if (MACHINE_TOKEN_VERSION_LABEL.test(text)) reasons.push('machine_token:version_label');
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
    reasons.push(...scoreToolCalls(turn.expect.calls, evidence.toolCalls, now, goldResults, evidence.deliveredText).reasons);
    reasons.push(...scoreFacts(expectedFacts, evidence.deliveredText).reasons);
  }
  if (turn.expect.tags) reasons.push(...scoreTags(turn.expect.tags, evidence).reasons);
  // D3: unconditional — every turn delivers customer-visible text, whether or not it also carries
  // a data/tag expectation, and it must never leak a machine token.
  reasons.push(...scoreMachineTokens(evidence.deliveredTextExcludingQuickReplies ?? evidence.deliveredText).reasons);
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

type ExactDecimal = { n: bigint; scale: number };
const decimal = (value: string | number): ExactDecimal => {
  const text = String(value), match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new Error('WORKFLOW_COST_INVALID_DECIMAL');
  const fraction = match[3] ?? '', exponent = Number(match[4] ?? 0), scale = fraction.length - exponent;
  let n = BigInt(`${match[1]}${match[2]}${fraction}`);
  return scale < 0 ? { n: n * 10n ** BigInt(-scale), scale: 0 } : { n, scale };
};
const decimalAdd = (a: ExactDecimal, b: ExactDecimal): ExactDecimal => {
  const scale = Math.max(a.scale, b.scale);
  return { n: a.n * 10n ** BigInt(scale - a.scale) + b.n * 10n ** BigInt(scale - b.scale), scale };
};
const decimalMul = (a: ExactDecimal, b: ExactDecimal): ExactDecimal => ({ n: a.n * b.n, scale: a.scale + b.scale });
const decimalText = ({ n, scale }: ExactDecimal): string => {
  const sign = n < 0n ? '-' : '', digits = String(n < 0n ? -n : n).padStart(scale + 1, '0');
  const raw = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return `${sign}${raw || '0'}`;
};
const roundDecimalHalfUp = ({ n, scale }: ExactDecimal): number => {
  const divisor = 10n ** BigInt(scale), abs = n < 0n ? -n : n;
  const rounded = (abs + divisor / 2n) / divisor;
  return Number(n < 0n ? -rounded : rounded);
};
const decimalDivide = (value: ExactDecimal, divisor: number): ExactDecimal => {
  const expanded = { n: value.n * 1_000_000_000n, scale: value.scale + 9 };
  return { n: expanded.n / BigInt(divisor), scale: expanded.scale };
};

export function providerCostExact(input: {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  externalUnits: number;
  tariff: { usdPerMTok: { input: number; output: number; cacheRead: number; cacheWrite: number }; thbPerUsd: number;
    externalUsdPerUnit?: number; searchContentInputTokensPerUnit?: number };
  recordedCostSatang: number;
}) {
  const million = decimal(1_000_000), exchange = decimal(input.tariff.thbPerUsd), satang = decimal(100);
  let tokenUsd = decimal(0);
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const)
    tokenUsd = decimalAdd(tokenUsd, decimalMul(decimal(input.tokens[key]), decimal(input.tariff.usdPerMTok[key])));
  const searchContentTokens = decimalMul(decimal(input.externalUnits), decimal(input.tariff.searchContentInputTokensPerUnit ?? 0));
  tokenUsd = decimalAdd(tokenUsd, decimalMul(searchContentTokens, decimal(input.tariff.usdPerMTok.input)));
  const tokenSatang = decimalMul(decimalMul(tokenUsd, exchange), satang);
  const externalSatang = decimalMul(decimalMul(decimal(input.externalUnits), decimal(input.tariff.externalUsdPerUnit ?? 0)), decimalMul(exchange, satang));
  const exact = decimalAdd({ ...tokenSatang, scale: tokenSatang.scale + 6 }, externalSatang);
  const roundedSatang = roundDecimalHalfUp(exact);
  return { exactSatang: decimalText(exact), roundedSatang, roundingMatches: roundedSatang === input.recordedCostSatang };
}

export function classifyCacheState(tokens: { cacheRead: number; cacheWrite: number }): 'cold' | 'warm' | 'mixed' | 'none' {
  return tokens.cacheRead > 0 && tokens.cacheWrite > 0 ? 'mixed' : tokens.cacheWrite > 0 ? 'cold' : tokens.cacheRead > 0 ? 'warm' : 'none';
}

export type WorkflowEffect = { kind: string; recordId: string; evidenceHash?: string };
export type WorkflowTurnEvidence = {
  attemptId: string; conversationId: string; turnIndex: number; actorKey: string; inputKind: 'message' | 'postback' | 'uri' | 'camera';
  classifier?: { label?: string; confidence?: number; status?: string; errorCode?: string; schemaValid?: boolean; timedOut?: boolean };
  calls: Array<{ tag: string; modelId: string; ok: boolean; errorCode?: string; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    externalUnits?: number; tariff?: Parameters<typeof providerCostExact>[0]['tariff']; providerCostExact?: string; recordedCostSatang?: number;
    customerSatang?: number; companyAbsorbedSatang?: number; basis?: 'measured' | 'estimated' | 'unknown' }>;
  effects: WorkflowEffect[]; businessSnapshot: { business: Record<string, Array<Record<string, unknown>>>; collectionState: Record<string, Array<Record<string, unknown>>> };
  unintendedEffects: WorkflowEffect[]; deliveredActions: Array<{ type: string; label?: string; text?: string; uri?: string; preview?: Record<string, unknown> }>;
  preview?: Record<string, unknown>; latencyMs: number | null; deliveredText?: string; rejectedResultCharged?: boolean;
  deliveredCards?: Array<{ id: string; version: number }>;
  toolCalls?: CapturedToolCall[];
  textModelAttempts?: number;
  workflowKind?: string; targetId?: string; pickerTargets?: string[]; terminalEffect?: string; deadEnd?: boolean; tier?: 0 | 1 | 2;
};

const dueDateInText = (date: string, text: string): boolean => {
  const value = new Date(`${date}T00:00:00Z`);
  const variants = ['short', 'long'].flatMap(month => ['th-TH', 'en-GB'].map(locale => new Intl.DateTimeFormat(locale, { day: 'numeric', month: month as 'short' | 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(value)));
  const [year, month, day] = date.split('-').map(Number);
  variants.push(date, `${day}/${month}/${year}`, `${day}/${month}/${year! + 543}`);
  return variants.some(variant => text.replace(/\s+/g, '').includes(variant.replace(/\s+/g, '')));
};

export function scoreWorkflowAnswer(expect: WorkflowTurn['expect'], evidence: {
  deliveredText?: string; deliveredCards?: Array<{ id: string; version: number }>; calls: readonly unknown[]; toolCalls?: CapturedToolCall[]; textModelAttempts?: number;
}, resolved: { dueDate?: string; periodKey?: string } = {}): CheckResult {
  const reasons: string[] = [], text = evidence.deliveredText ?? '';
  if (expect.maxModelCalls !== undefined && Math.max(evidence.calls.length, evidence.textModelAttempts ?? 0) > expect.maxModelCalls) reasons.push('max_model_calls_exceeded');
  if (expect.tags) reasons.push(...scoreTags(expect.tags, { deliveredText: text, toolCalls: evidence.toolCalls ?? [], modelCalls: evidence.calls.length, latencyMs: null, costSatang: null }).reasons);
  if (expect.knowledge) {
    const gold = expect.knowledge;
    if (evidence.deliveredCards?.length !== 1 || !evidence.deliveredCards.some(card => card.id === gold.cardId && card.version === gold.version)) reasons.push('knowledge_card_mismatch');
    for (const fact of gold.requiredFacts) if (!text.includes(fact)) reasons.push(`knowledge_fact_missing:${fact}`);
    for (const fact of gold.forbiddenFacts) if (text.includes(fact)) reasons.push(`knowledge_fact_forbidden:${fact}`);
    const allowed = new Set(gold.allowedNumericFacts.flatMap(knowledgeNumericFacts));
    if (expect.dueDate && resolved.dueDate) {
      const [year, month, day] = resolved.dueDate.split('-').map(Number);
      for (const value of [year!, year! + 543, month!, day!, Number(expect.dueDate.formType.slice(3))]) allowed.add(String(value));
      if (resolved.periodKey) {
        const [periodYear, periodMonth] = resolved.periodKey.split('-').map(Number);
        for (const value of [periodYear!, periodYear! + 543, periodMonth!]) allowed.add(String(value));
      }
    }
    for (const number of knowledgeNumericFacts(text)) if (!allowed.has(number)) reasons.push(`knowledge_numeric_fact_forbidden:${number}`);
  }
  if (expect.dueDate) {
    if (!resolved.dueDate || !dueDateInText(resolved.dueDate, text)) reasons.push('due_date_mismatch');
    if (!new RegExp(`ภ\\.?\\s*ง\\.?\\s*ด\\.?\\s*${expect.dueDate.formType.slice(3)}(?![0-9])`).test(text)) reasons.push('due_form_mismatch');
  }
  if (expect.refusal) {
    if (!expect.refusal.wayOut.some(way => text.includes(way))) reasons.push('refusal_way_out_missing');
    if (!['ไม่ได้', 'ไม่สามารถ', 'ไม่มีสิทธิ์', 'ไม่รองรับ', 'ยังไม่', 'ต้องใช้แพ็กเกจ', 'ยังใช้', 'ให้ผู้', 'ขอสิทธิ์'].some(marker => text.includes(marker))) reasons.push('refusal_missing');
    if (evidence.deliveredCards?.length) reasons.push('refusal_card_leak');
  }
  return { ok: reasons.length === 0, reasons };
}

export function scoreWorkflowTask(task: WorkflowTask, evidence: WorkflowTurnEvidence[], goldPreview?: Record<string, unknown>, now?: Date) {
  return checkWorkflowGold(task, evidence, goldPreview, now);
}

export type WorkflowAttempt = { attemptId: string; complete: boolean; providerCostExact: string; customerSatang?: number; companyAbsorbedSatang?: number; turns?: WorkflowTurnEvidence[] };
export function selectLatestCompleteAttempt<T extends { complete: boolean }>(attempts: T[]): T | undefined {
  return [...attempts].reverse().find(attempt => attempt.complete);
}
export function workflowAttemptCostTotal(attempts: Array<{ providerCostExact: string }>): string {
  return decimalText(attempts.reduce((sum, attempt) => decimalAdd(sum, decimal(attempt.providerCostExact)), decimal(0)));
}

export type WorkflowRunAttempt = { attemptId: string; conversationId: string; complete: boolean; turns: WorkflowTurnEvidence[] };
export type WorkflowMetrics = {
  W1: { passed: number; total: number }; W2: { passed: number; total: number }; W3: { passed: number; total: number };
  W4: { medianDelta: number; p90Delta: number }; W5: { byKind: Record<string, { providerExact: string; completedTasks: number; costPerCompletedTask: string }> };
  W6: { wrongApplied: number; wrongPreview: number }; W7: { medianCallsPerTask: number; startedByTextAtMostOne: number; startedByText: number };
  W8: Record<string, { p50: number; p95: number }>; W9: { invalidCalls: number; calls: number };
  W10: { lowConfidenceCards: number; typedWorkflowTurns: number }; W11: { beforeA2: number | null; afterA2: number | null; beforeA3: number | null; afterA3: number | null };
  W12: { machineTokenTurns: number; turns: number }; W13: { candidateExact: string; baselineExact?: string };
  W14: { timeouts: number; calls: number }; W15: { rejectedAndCharged: number };
  cacheCohorts: Record<'cold' | 'warm' | 'mixed' | 'none', number>; attemptSpendExact: string;
  answerChecks?: Array<{ conversationId: string; turnIndex: number; ok: boolean; reasons: string[] }>;
};
const ratio = (passed: number, total: number) => ({ passed, total });
const medianNumber = (numbers: number[], fraction: number) => {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
};
const callExactCost = (call: WorkflowTurnEvidence['calls'][number]): string | null => {
  if (call.providerCostExact !== undefined) return call.providerCostExact;
  if (!call.tariff || call.recordedCostSatang === undefined) return null;
  return providerCostExact({ tokens: call.tokens, externalUnits: call.externalUnits ?? 0, tariff: call.tariff, recordedCostSatang: call.recordedCostSatang }).exactSatang;
};

/** W1–W15 over the latest complete conversation attempt; monetary totals retain every attempt. */
export function scoreWorkflowCorpus(input: {
  corpus: WorkflowCorpus; attempts: WorkflowRunAttempt[]; baseline?: WorkflowRunAttempt[];
  advisorBefore?: { A2: number; A3: number }; advisorAfter?: { A2: number; A3: number };
  now?: Date;
}): WorkflowMetrics {
  const latest = new Map<string, WorkflowRunAttempt>();
  for (const row of input.attempts) if (row.complete) latest.set(row.conversationId, row);
  const allTurns = [...latest.values()].flatMap(row => row.turns), conversations = input.corpus.conversations;
  const tasks = conversations.flatMap(conversation => conversation.tasks.map(task => ({ conversation, task,
    attempt: latest.get(conversation.id), turns: latest.get(conversation.id)?.turns.filter(turn => turn.turnIndex >= task.startTurn && turn.turnIndex <= task.endTurn) ?? [] })));
  const labelTurns = conversations.flatMap(conversation => conversation.turns.map((turn, turnIndex) => ({ turn, turnIndex, attempt: latest.get(conversation.id) }))).filter(row => row.turn.expect.label !== undefined);
  const W1Passed = labelTurns.filter(row => row.attempt?.turns.find(turn => turn.turnIndex === row.turnIndex)?.classifier?.label === row.turn.expect.label).length;
  const W2Tasks = tasks.filter(({ task }) => task.kind !== 'advisor');
  const W2Passed = W2Tasks.filter(({ conversation, task, attempt, turns }) => {
    const start = turns.find(turn => turn.turnIndex === task.startTurn), expected = conversation.turns[task.startTurn]?.expect.target;
    return start?.workflowKind === task.kind && (!expected || start.targetId === expected || start.pickerTargets?.includes(expected));
  }).length;
  const taskScores = tasks.map(({ conversation, task, turns }) => ({ conversation, task, turns, score: scoreWorkflowTask(task, turns,
    task.confirmTurn === undefined ? undefined : conversation.turns[task.confirmTurn - 1]?.expect.preview, input.now) }));
  const W3Tasks = tasks.filter(({ task }) => task.completable), W3Passed = W3Tasks.filter(({ task, turns }) => {
    const preview = task.confirmTurn === undefined ? undefined : conversations.find(conversation => conversation.tasks.includes(task))?.turns[task.confirmTurn - 1]?.expect.preview;
    const score = scoreWorkflowTask(task, turns, preview, input.now);
    return turns.some(turn => turn.terminalEffect === task.goldTerminal.effect) && !turns.some(turn => turn.deadEnd) && score.terminalMatches && !score.wrongApplied && !score.wrongPreview;
  }).length;
  const turnDeltas = tasks.map(({ task, turns }) => turns.length - task.minimalTurns);
  const calls = allTurns.flatMap(turn => turn.calls);
  const attemptCosts = input.attempts.flatMap(attempt => attempt.turns.flatMap(turn => turn.calls.map(callExactCost).filter((cost): cost is string => cost !== null)));
  const typedIds = new Set(conversations.filter(conversation => conversation.journeyKind === 'typed').map(conversation => conversation.id));
  const typedAttemptCosts = input.attempts.filter(attempt => typedIds.has(attempt.conversationId))
    .flatMap(attempt => attempt.turns.flatMap(turn => turn.calls.map(callExactCost).filter((cost): cost is string => cost !== null)));
  const completedTasks = taskScores.filter(row => row.task.completable && row.turns.some(turn => turn.terminalEffect === row.task.goldTerminal.effect));
  const totalExact = workflowAttemptCostTotal(typedAttemptCosts.map(providerCostExact => ({ providerCostExact })));
  const W5: WorkflowMetrics['W5']['byKind'] = {};
  for (const kind of new Set(tasks.map(row => row.task.kind))) {
    const groupTasks = tasks.filter(row => row.task.kind === kind), completeIds = new Set(completedTasks.filter(row => row.task.kind === kind).map(row => `${row.conversation.id}:${row.task.id}`));
    const spend = input.attempts.flatMap(attempt => groupTasks.filter(row => row.conversation.id === attempt.conversationId)
      .flatMap(({ task }) => attempt.turns.filter(turn => turn.turnIndex >= task.startTurn && turn.turnIndex <= task.endTurn)
        .flatMap(turn => turn.calls.map(callExactCost).filter((cost): cost is string => cost !== null))));
    const sum = workflowAttemptCostTotal(spend.map(providerCostExact => ({ providerCostExact })));
    W5[kind] = { providerExact: sum, completedTasks: completeIds.size,
      costPerCompletedTask: completeIds.size ? decimalText(decimalDivide(decimal(sum), completeIds.size)) : '0' };
  }
  const typedTasks = tasks.filter(row => row.conversation.journeyKind === 'typed');
  const textTasks = typedTasks.filter(row => !!row.conversation.turns[row.task.startTurn]?.user);
  const taskCalls = tasks.map(row => row.turns.reduce((sum, turn) => sum + turn.calls.length, 0));
  const tiers = new Map<number, number[]>();
  for (const turn of allTurns) if (turn.latencyMs !== null) {
    const tier = turn.tier ?? 0;
    tiers.set(tier, [...(tiers.get(tier) ?? []), turn.latencyMs]);
  }
  const cohorts = { cold: 0, warm: 0, mixed: 0, none: 0 };
  for (const call of calls) cohorts[classifyCacheState(call.tokens)]++;
  const classifierCalls = allTurns.filter(turn => !!turn.classifier).length;
  const invalidCalls = allTurns.filter(turn => turn.classifier?.schemaValid === false).length;
  const typedWorkflowTurns = allTurns.filter(turn => turn.workflowKind && turn.inputKind === 'message').length;
  const lowConfidenceCards = allTurns.filter(turn => turn.classifier?.confidence !== undefined && turn.classifier.confidence < 0.7
    && turn.deliveredActions?.some(action => ['picker', 'choice'].includes(action.type))).length;
  const machineTokenTurns = allTurns.filter(turn => scoreMachineTokens(turn.deliveredText ?? '').reasons.length > 0).length;
  const deltas = turnDeltas;
  const baselineCalls = input.baseline?.filter(row => typedIds.has(row.conversationId))
    .flatMap(row => row.turns.flatMap(turn => turn.calls.map(callExactCost).filter((cost): cost is string => cost !== null))) ?? [];
  const answerTurns = conversations.flatMap(conversation => conversation.turns.map((turn, turnIndex) => ({ conversation, turn, turnIndex })))
    .filter(({ turn }) => turn.expect.knowledge || turn.expect.dueDate || turn.expect.refusal);
  const seed = answerTurns.some(({ turn }) => turn.expect.dueDate) && input.now ? buildWorkflowSeed(input.now, conversations.flatMap(row => row.actors)) : undefined;
  const answerChecks = answerTurns.map(({ conversation, turn, turnIndex }) => {
    const evidence = latest.get(conversation.id)?.turns.find(row => row.turnIndex === turnIndex);
    const actor = conversation.actors.find(row => row.key === (turn.as?.key ?? conversation.actors[0]?.key))!;
    const dueDate = turn.expect.dueDate && seed && input.now ? resolveWorkflowDueDate(turn.expect.dueDate, seed.rows, seed.companies[actor.company].companyId, input.now) : undefined;
    const periodKey = turn.expect.dueDate && input.now ? workflowMonthKey(input.now, turn.expect.dueDate.monthOffset) : undefined;
    return { conversationId: conversation.id, turnIndex, ...(evidence ? scoreWorkflowAnswer(turn.expect, evidence, { dueDate, periodKey }) : { ok: false, reasons: ['answer_evidence_missing'] }) };
  });
  return {
    ...(answerChecks.length ? { answerChecks } : {}),
    W1: ratio(W1Passed, labelTurns.length), W2: ratio(W2Passed, W2Tasks.length), W3: ratio(W3Passed, W3Tasks.length),
    W4: { medianDelta: medianNumber(deltas, 0.5), p90Delta: medianNumber(deltas, 0.9) },
    W5: { byKind: W5 },
    W6: { wrongApplied: taskScores.reduce((sum, row) => sum + row.score.wrongApplied, 0), wrongPreview: taskScores.reduce((sum, row) => sum + row.score.wrongPreview, 0) },
    W7: { medianCallsPerTask: medianNumber(taskCalls, 0.5), startedByTextAtMostOne: textTasks.filter(row => (row.attempt?.turns.filter(turn => turn.turnIndex >= row.task.startTurn && turn.turnIndex <= row.task.endTurn).reduce((sum, turn) => sum + turn.calls.length, 0) ?? 0) <= 1).length, startedByText: textTasks.length },
    W8: Object.fromEntries([...tiers].map(([tier, values]) => [String(tier), { p50: medianNumber(values, 0.5), p95: medianNumber(values, 0.95) }])),
    W9: { invalidCalls, calls: classifierCalls }, W10: { lowConfidenceCards, typedWorkflowTurns },
    W11: { beforeA2: input.advisorBefore?.A2 ?? null, afterA2: input.advisorAfter?.A2 ?? null, beforeA3: input.advisorBefore?.A3 ?? null, afterA3: input.advisorAfter?.A3 ?? null },
    W12: { machineTokenTurns, turns: allTurns.length }, W13: { candidateExact: totalExact, ...(baselineCalls.length ? { baselineExact: workflowAttemptCostTotal(baselineCalls.map(providerCostExact => ({ providerCostExact }))) } : {}) },
    W14: { timeouts: allTurns.filter(turn => turn.classifier?.timedOut).length, calls: classifierCalls },
    W15: { rejectedAndCharged: allTurns.filter(turn => turn.rejectedResultCharged).length }, cacheCohorts: cohorts,
    attemptSpendExact: workflowAttemptCostTotal(attemptCosts.map(providerCostExact => ({ providerCostExact }))),
  };
}
