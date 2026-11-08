import {
  LINE_TOOL_REGISTRY,
  extractValueCandidates,
  parseLineAiPreparedPlan,
  parseLineAiSemanticSubrequests,
} from '@watchdog-bms/contracts';
import type {
  LineAiInputEvidenceV2,
  LineAiOpenClarification,
  LineAiPreparedPlan,
  LineAiReadMemory,
  LineAiSemanticSubrequestV2,
  LineAiValueCandidates,
  ToolMeta,
} from '@watchdog-bms/contracts';
import { preparedFamilyKey } from '../domain/logic/prepared-simple-read.logic';
import { canonicalizeReadToolEnums, myPendingWorkQuestion, nameFilterGroundedInText, paymentStatusGroundedInText, CLAIM_AMOUNT_FILTER_KEYS, evidenceRefsText, claimAmountFilters, reimbursementStatusQuestion, resolveClaimReadFilters, claimReadGroupUnavailable } from './read-tool-input';

// Spec item 2(b): categoryName/vendorName are free text the model must have echoed from what the user
// typed, not a value proven by an id/date/enum shape. Checked by normalized substring, not raw equality.
const NAME_FILTER_GROUNDING_FIELDS = new Set(['categoryName', 'vendorName', 'requesterName']);

const DECISION_KEYS = new Set(['subrequests', 'simpleRead']);
const SUBREQUEST_KEYS = new Set([
  'kind', 'goal', 'sources', 'filters', 'requiredEvidence', 'dependsOn', 'entity', 'taskRef', 'writeIntent', 'tool', 'index',
]);
const SOURCE_KEYS = new Set(['part', 'whole', 'quote']);
const SIMPLE_READ_KEYS = new Set(['subrequest', 'tool', 'subject', 'agent', 'answerShape', 'confidence']);
const TASK_REF_KEYS = new Set(['taskId', 'taskRevision', 'subrequestIndex']);
const SEMANTIC_KINDS = new Set<LineAiSemanticSubrequestV2['kind']>(['read', 'general', 'write', 'help', 'public', 'file']);
const WRITE_INTENTS = new Set<NonNullable<LineAiSemanticSubrequestV2['writeIntent']>>([
  'EXPENSE_PAYMENT_EVIDENCE_LINK',
  'EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION', 'EXPENSE_CAPTURE_CORRECTION',
  'SUBSTITUTE_RECEIPT_CONTINUATION', 'REIMBURSEMENT_REQUEST_START',
]);
const SIMPLE_READ_CATEGORIES = new Set<ToolMeta['category']>(['read_summary', 'read_detail', 'report']);
// tuning-5b (B3a): mirrors CONFIDENCE_VETO_FLOOR in prepared-simple-read.logic.ts, which independently
// re-verifies this same plan.confidence at the orchestrator's pre-call check (preparedSimplePreCallCheck)
// before a route response is ever allowed to keep a preparedPlan — both moved 0.85 -> 0.75 together, or a
// plan built here at 0.75-0.85 would still be silently dropped there. Run 4: 17 simple reads at 0.82 and
// 9 at 0.78 fell to the slow path, e.g. "มีร่างค้างอยู่ไหมคะ", "ใบเบิกที่ขอไปได้รึยังอ่ะคะ".
const SIMPLE_READ_CONFIDENCE_FLOOR = 0.75;
// tuning-5b (B2): each of these tools has exactly one enabled formatter shape in production config, so
// the model's answerShape guess is normalized to it before the family gate instead of being rejected as
// formatter_family_not_allowed. Run 4: 39 expense.get_breakdown proposals said single_metric.
const SINGLE_SHAPE_TOOLS: Readonly<Record<string, 'single_metric' | 'list'>> = {
  'expense.get_breakdown': 'list',
  'reimbursement.list_pending_approvals': 'list',
  'expense.get_daily_closing': 'single_metric',
  'reimbursement.get_summary': 'single_metric',
  'expense.get_detail': 'single_metric',
  'reimbursement.get_detail': 'single_metric',
};
// tuning-5b (B3): a why/explain/compare/advice question is never a single deterministic metric — it
// needs the full agentic path to reason about a cause or produce a recommendation, however confident the
// model's simpleRead guess looks. Checked on the RAW message text (not the model's own paraphrased
// `goal`) so the guard holds even when the model mislabels its own intent.
// UAT 2026-09-29: "ร่างค่าใช้จ่ายมีอะไรบ้าง ติดปัญหาอะไรไหม" asks for a diagnosis beside the list, which
// no compiled list formatter can give — a problem/issue question needs the same full path.
const WHY_COMPARE_ADVICE_PATTERN = /ทำไม|เพราะอะไร|สาเหตุ|อธิบาย|เทียบ|เปรียบเทียบ|ต่างกัน|ควร|แนะนำ|ปัญหา|ผิดปกติ|ติดขัด|\bwhy\b|\bexplain\b|\bcompare\b|\bversus\b|\bvs\b|\bproblems?\b|\bissues?\b/iu;
const TOOL_BY_NAME = new Map(LINE_TOOL_REGISTRY.map((tool) => [tool.name, tool] as const));
const KNOWN_FILTER_KEYS = new Set(LINE_TOOL_REGISTRY.flatMap((tool) => [
  ...(tool.requiredInputFields ?? []), ...(tool.optionalInputFields ?? []),
]));
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
// A file clause's filters grant nothing: the document bridge reads only its page and an attachment id the
// user typed. A stray key there ({"attachmentId":…}, {"taskRef":null}) used to reject the whole decision,
// the repair spent the reader's dispatch, and a document question after a repaired intake no longer fits its
// two-dispatch envelope (regression slice 2026-09-30, NAT-05 t2 and NAT-06 t3) — so on a file clause the
// page and attachment id are kept and anything else is dropped.
const FILE_CLAUSE_FILTER_KEYS: ReadonlySet<string> = new Set(['attachmentId', 'page']);
export const INTAKE_REPAIR_HINTS = {
  "decision_keys_invalid": "decisionV1 must be an object containing only subrequests and optional simpleRead.",
  "decision_subrequests_invalid": "decisionV1.subrequests must contain 1 to 8 clauses.",
  "clause_keys_invalid": "Each clause uses only kind, goal, sources, filters, requiredEvidence, dependsOn, entity, taskRef, writeIntent and tool. Put captureHints, documentClassification and resolvedClarificationIds on the outer route, never inside a clause. For an answer to an open question use sources:[{part:0,whole:true}] and that question's clarifyForIntent.",
  "clause_kind_invalid": "Use kind read, general, help, write, file or public.",
  "clause_goal_invalid": "Use a nonempty goal of at most 800 characters.",
  "sources_invalid": "Use 1 to 8 sources per clause.",
  "source_keys_invalid": "Each source must contain only part and either whole or quote.",
  "source_part_invalid": "Source part must be a numeric part index or exact part-N.",
  "source_part_missing": "Select a part that exists in current inputEvidenceParts.",
  "source_selector_invalid": "Use exactly one of whole:true or quote:string per source.",
  "source_quote_invalid": "Use a nonempty exact quote of at most 800 characters.",
  "source_quote_not_found": "A quote must occur in the selected live inputEvidenceParts text; for a reply to an open question use whole:true on the live reply part and put the original request plus reply in goal; only read/general/help may quote the selected openClarifications text.",
  "source_quote_not_unique": "Use a unique exact quote in the selected live part, or whole:true.",
  "filters_shape_invalid": "Use a filters object with at most 16 entries.",
  "filters_key_invalid": "Use nonempty filter keys of at most 80 characters, never prototype keys.",
  "filter_unknown": "Use only catalog filter names.",
  "filter_value_invalid": "Filter values must be null, boolean, finite number or string of at most 200 characters.",
  "required_evidence_invalid": "requiredEvidence must be an array.",
  "dependencies_invalid": "dependsOn must be an array of earlier clause indices.",
  "entity_shape_invalid": "entity must be a nonempty string of at most 160 characters.",
  "entity_not_in_text": "Copy entity exactly from live text or, for read/general/help only, the same selected original clarification text as the source.",
  "taskref_malformed": "The previous taskRef was invalid: it must be the exact object {\"taskId\":\"...\",\"taskRevision\":N,\"subrequestIndex\":N} copied from one resumableTaskRefs entry — never a bare id string, and never a partial object.",
  "semantic_contract_invalid": "Check the shared semantic contract: requiredEvidence uses at most 8 identifier strings; dependencies are unique earlier indices; taskRef has a valid id, nonnegative integer revision and index 0 to 7, and cannot be reused.",
  "route_json_invalid": "Return one complete JSON object.",
  "route_object_invalid": "Return a JSON object, never null or an array.",
  "route_intent_invalid": "Select an exact offered intake intent.",
  "route_mixed_formats": "Emit decisionV1 without legacy semanticSubrequests or preparedPlan.",
  "route_semantic_invalid": "Include a complete decisionV1 with valid evidence for every clause.",
  "route_retained_source_mismatch": "Preserve the offered retainedTaskSource kind, writeIntent and exact taskRef.",
  "route_reimbursement_not_offered": "The reimbursement route was not offered; select an offered route.",
  "route_advisor_not_offered": "The advisor route was not offered; select an offered route.",
  "route_capture_hint_too_long": "Shorten captureHints strings to their documented bounds.",
  "route_capture_items_too_many": "Use at most 20 captureHints items.",
  "route_capture_item_too_long": "Use at most 200 characters per captureHints item string.",
  "route_document_invalid": "Omit documentClassification for a text answer to an open question. Otherwise return the complete documented classification object, never a document-kind string or partial object.",
  "route_document_missing": "BUSINESS_DOCUMENT_REFERENCE requires documentClassification.",
  "route_parse_exception": "Return a complete route with the documented JSON types."
} as const;
export type CompactDecodeRejection = keyof typeof INTAKE_REPAIR_HINTS;
export type CompactSimpleReadRejection =
  | 'not_single_independent_read'
  | 'invalid_simple_shape'
  | 'tool_not_enabled'
  | 'tool_not_read'
  | 'formatter_family_not_allowed'
  | 'filter_not_supported'
  | 'filter_not_grounded'
  | 'required_filter_missing'
  | 'prepared_contract_invalid'
  // tuning-5b (B3): the deterministic why/explain/compare/advice guard — see WHY_COMPARE_ADVICE_PATTERN.
  | 'why_compare_advice_question'
  // Advisor Q2: the caller's own pending work reads several queues — see myPendingWorkQuestion.
  | 'my_pending_work_question';

export type CompactDecisionResult = {
  semanticSubrequests: LineAiSemanticSubrequestV2[];
  preparedPlan?: LineAiPreparedPlan;
  simpleReadRejection?: CompactSimpleReadRejection;
};

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

// N1 (tuning-8, T-068-a run 8 attempt 2): the router sent {"part":"part-0"} instead of {"part":0} on an
// otherwise-correct decision — accept that exact "part-N" string shape as the number N, still gated by
// the same evidence.parts lookup below, so any other string (a typo, a different prefix, a name for a
// part that does not exist) stays invalid exactly as today.
const PART_REF_PATTERN = /^part-(\d+)$/;

function sourcePartIndex(value: unknown): number | undefined {
  if (Number.isSafeInteger(value)) return value as number;
  if (typeof value !== 'string') return undefined;
  const match = PART_REF_PATTERN.exec(value);
  return match ? Number(match[1]) : undefined;
}

function sourceRefs(raw: unknown, evidence: LineAiInputEvidenceV2, reject: (reason: CompactDecodeRejection) => undefined, originals: readonly LineAiOpenClarification[]): LineAiSemanticSubrequestV2['evidenceRefs'] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return reject('sources_invalid');
  const refs: NonNullable<LineAiSemanticSubrequestV2['evidenceRefs']> = [];
  for (const value of raw) {
    if (!plainObject(value) || !exactKeys(value, SOURCE_KEYS)) return reject('source_keys_invalid');
    const partIndex = sourcePartIndex(value['part']);
    if (partIndex === undefined) return reject('source_part_invalid');
    const part = evidence.parts[partIndex];
    if (!part) return reject('source_part_missing');
    const hasWhole = Object.prototype.hasOwnProperty.call(value, 'whole');
    const hasQuote = Object.prototype.hasOwnProperty.call(value, 'quote');
    if (hasWhole === hasQuote || hasWhole && value['whole'] !== true || hasQuote && typeof value['quote'] !== 'string') return reject('source_selector_invalid');
    const whole = hasWhole;
    const quote = hasQuote ? value['quote'] as string : undefined;
    if (whole) {
      refs.push({ partId: part.partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 });
      continue;
    }
    if (!quote || quote.length > 800) return reject('source_quote_invalid');
    const start = part.rawText.indexOf(quote);
    if (start < 0) {
      if (!part.rawText || !originals.some(entry => entry.text.includes(quote))) return reject('source_quote_not_found');
      refs.push({ partId: part.partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 });
      continue;
    }
    if (part.rawText.indexOf(quote, start + 1) >= 0) return reject('source_quote_not_unique');
    refs.push({ partId: part.partId, startUtf16: start, endUtf16: start + quote.length, rawSha256: part.rawSha256 });
  }
  return refs;
}

function boundedFilters(value: unknown, kind: unknown, reject: (reason: CompactDecodeRejection) => undefined): Record<string, string | number | boolean | null> | undefined {
  if (!plainObject(value) || Object.keys(value).length > 16) return reject('filters_shape_invalid');
  const filters = Object.create(null) as Record<string, string | number | boolean | null>;
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 80 || RESERVED_KEYS.has(key)) return reject('filters_key_invalid');
    const scalar = item === null || typeof item === 'boolean'
      || typeof item === 'number' && Number.isFinite(item)
      || typeof item === 'string' && item.length <= 200;
    if (kind === 'file') {
      if (FILE_CLAUSE_FILTER_KEYS.has(key) && scalar) filters[key] = item as string | number | boolean | null;
      continue;
    }
    // A write clause's values travel in its own hints (captureHints, correctionHints, reimbursementHints)
    // and the draft tools' choices; its filters decide nothing. NAT-04 (2026-09-29): {"expenseIds":[…]} on a
    // claim clause rejected the decision twice and the turn ran out of time — so a stray one is dropped.
    if (kind === 'write' && (!KNOWN_FILTER_KEYS.has(key) || !scalar)) continue;
    if (!KNOWN_FILTER_KEYS.has(key)) return reject('filter_unknown');
    if (!scalar) return reject('filter_value_invalid');
    filters[key] = item as string | number | boolean | null;
  }
  return filters;
}

// Spec §4 R-M5: a value the API already proved it applied (queryApplied, never the model's own prior
// input) is grounded the same way a current-message/valueCandidates match is — this is what lets a
// follow-up naming no period or filter of its own still pass this same check. Only the string filter
// fields memory carries at all are looked up; fromDate/toDate/periodKey go through
// recentReadsPeriodMatch below (a pair, not a single field) exactly like valueCandidates.periods does.
const RECENT_READS_STRING_FIELDS = new Set(['documentStatus', 'paymentStatus', 'categoryId', 'categoryName', 'vendorId', 'vendorName', 'branchId', 'branchName', 'groupBy', 'requester', 'requesterName', 'round', 'status', ...CLAIM_AMOUNT_FILTER_KEYS]);

function recentReadsFilterValue(key: string, value: string, recentReads: readonly LineAiReadMemory[] | undefined): boolean {
  if (!RECENT_READS_STRING_FIELDS.has(key)) return false;
  return (recentReads ?? []).some((entry) => ((entry.claimFilters ?? entry) as unknown as Record<string, unknown>)[key] === value);
}

// Spec §4 R-M5: expense.get_detail/reimbursement.get_detail's own record id is an opaque internal
// identifier — never groundable in message text at all — so the ONLY acceptable provenance is a
// shownItems entry the customer was actually shown this chat (ordinal reference, R-M4).
const RECORD_ID_GROUNDING_FIELD: Readonly<Record<string, string>> = {
  'expense.get_detail': 'expenseId',
  'reimbursement.get_detail': 'reimbursementId',
};

function isGroundedFilterValue(
  key: string,
  value: string | number | boolean | null,
  messageText: string,
  tool: ToolMeta,
  candidates?: LineAiValueCandidates,
  recentReads?: readonly LineAiReadMemory[],
): boolean {
  if (value === null) return true;
  if (RECORD_ID_GROUNDING_FIELD[tool.name] === key) {
    return typeof value === 'string' && (recentReads ?? []).some((entry) => entry.shownItems?.some((item) => item.id === value));
  }
  if (CLAIM_AMOUNT_FILTER_KEYS.includes(key as typeof CLAIM_AMOUNT_FILTER_KEYS[number])) {
    return typeof value === 'string' && ((candidates?.amounts ?? []).some(candidate => candidate.value === value) || recentReadsFilterValue(key, value, recentReads));
  }
  const literal = String(value);
  if (literal && messageText.includes(literal)) return true;
  if (key === 'round' || key === 'olderThanMonths') return canonicalizeReadToolEnums(tool, { [key]: value }, messageText, recentReads) !== undefined;
  if (typeof value === 'string' && NAME_FILTER_GROUNDING_FIELDS.has(key) && nameFilterGroundedInText(value, messageText, key === 'categoryName')) return true;
  // Item 1: paymentStatus needs its own word-level check — see paymentStatusGroundedInText — before
  // the generic enum-membership fallback below, which would otherwise wave through ANY listed value.
  // tuning-3 item 2: that word-level check only ever sees THIS message's text, so a value inherited
  // from recentReads (spec R-M5 — grounded the same way a candidates/recentReads match already is
  // for every other field below) needs the same recentReads fallback here, or a grouping-only
  // follow-up like "จ่ายร้านไหนเยอะสุดคะ" can never carry forward a prior paymentStatus filter.
  if (key === 'paymentStatus' && typeof value === 'string') {
    return paymentStatusGroundedInText(value, messageText) || recentReadsFilterValue(key, value, recentReads);
  }
  if (typeof value === 'string' && tool.inputEnumValues?.[key]?.includes(value)) return true;
  if (typeof value === 'string' && recentReadsFilterValue(key, value, recentReads)) return true;
  if (key === 'fromDate') return (candidates?.periods ?? []).some((period) => period.fromDate === value)
    || (recentReads ?? []).some((entry) => entry.period?.fromDate === value);
  if (key === 'toDate') return (candidates?.periods ?? []).some((period) => period.toDate === value)
    || (recentReads ?? []).some((entry) => entry.period?.toDate === value);
  if (key === 'periodKey') return (candidates?.periods ?? []).some((period) => period.monthKey === value);
  // Item 4: `expense.get_daily_closing`'s bare `date` field (e.g. "วันนี้") had no grounding rule at
  // all — unlike fromDate/toDate/periodKey above — so an explicit date always failed as ungrounded
  // and the whole daily-closing fast lane rejected, even though the value is one deterministic
  // extracted candidate, never invented. "วันนี้" extracts as a one-day PERIOD (fromDate===toDate),
  // never a `dates` candidate — same dual source the classic tool loop's `validInput` already
  // trusts for a single-date field (read-tool-input.ts has no shared home for it; this parser is
  // the only caller of a bare `date` filter today).
  if (key === 'date') {
    return (candidates?.dates ?? []).some((date) => date.isoDate === value)
      || (candidates?.periods ?? []).some((period) => period.fromDate === value || period.toDate === value);
  }
  // A boolean or numeric default that the user did not select is still invented model input.
  return false;
}

function periodSelectionGrounded(
  filters: Record<string, string | number | boolean | null>,
  candidates?: LineAiValueCandidates,
  recentReads?: readonly LineAiReadMemory[],
): boolean {
  const fromDate = filters['fromDate'], toDate = filters['toDate'], periodKey = filters['periodKey'];
  if (periodKey !== undefined && (fromDate !== undefined || toDate !== undefined)) return false;
  if ((fromDate === undefined) !== (toDate === undefined)) return false;
  if (fromDate !== undefined && toDate !== undefined) {
    return (candidates?.periods ?? []).some((period) => period.fromDate === fromDate && period.toDate === toDate)
      || (recentReads ?? []).some((entry) => entry.period?.fromDate === fromDate && entry.period?.toDate === toDate);
  }
  if (periodKey !== undefined) return (candidates?.periods ?? []).some((period) => period.monthKey === periodKey);
  return true;
}

/**
 * tuning-3 item 2 (spec §4 R-M4 "แยกตาม… ให้ใช้ breakdown ในขอบเขตเดิม"; eval T-004#2 "แยกตามหมวดให้
 * ดูหน่อย" after "เอาเฉพาะที่รอตรวจอยู่ครับ", T-013#2 "จ่ายร้านไหนเยอะสุดคะ" after a paymentStatus
 * filter): a follow-up that names a NEW groupBy and nothing else is a presentation change, never a
 * scope change, so it should still inherit the latest matching read's other filters exactly like a
 * follow-up naming no filter of its own already does (the router prompt says so, but a real model
 * sometimes reads "I named a filter — groupBy" and drops the rest anyway). Deterministic here rather
 * than only hoped for in the prompt: only fires when this clause named groupBy and NO other business
 * filter of its own, only copies a field the target tool actually accepts, and only from a recentReads
 * entry for the SAME business subject (tool name prefix) — never across e.g. expense/reimbursement.
 */
const CARRIED_GROUPING_FILTER_KEYS = ['documentStatus', 'paymentStatus', 'categoryId', 'categoryName', 'vendorId', 'vendorName', 'branchId', 'branchName'] as const;

// R1(b): an explicit topic return/restart must never inherit the previous read's status/payment/
// category/vendor/branch filters (see the matching router rule in intent-router.agent.ts). "อีกที" alone
// is far too common in an ordinary elliptical follow-up ("แยกตามหมวดอีกที") to mean restart by itself, so
// it only counts paired with a topic word ("เรื่อง"/"เรื่องเดิม") in the same short clause, mirroring
// "เรื่องเดิม…อีกที" in that router rule; the other four markers are distinctive enough alone.
const RESTART_MARKER_PATTERN = /กลับมาเรื่อง|กลับมาที่|เริ่มใหม่|ขอดูใหม่|เรื่อง[\s\S]{0,30}อีกที/u;

function withCarriedGroupingFilters(
  filters: Record<string, string | number | boolean | null>,
  tool: ToolMeta,
  allowedFilters: ReadonlySet<string>,
  messageText: string,
  recentReads?: readonly LineAiReadMemory[],
): Record<string, string | number | boolean | null> {
  if (filters['groupBy'] === undefined || CARRIED_GROUPING_FILTER_KEYS.some((key) => filters[key] !== undefined)) return filters;
  if (RESTART_MARKER_PATTERN.test(messageText)) return filters;
  const subject = tool.name.split('.')[0];
  const source = (recentReads ?? []).find((entry) => entry.tool.split('.')[0] === subject);
  if (!source) return filters;
  const carried = { ...filters };
  for (const key of CARRIED_GROUPING_FILTER_KEYS) {
    const value = (source as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && allowedFilters.has(key)) carried[key] = value;
  }
  return carried;
}

// tuning-5b (B4e / T-004-b): "ไม่เอาตัวกรองแล้ว", "ดูรวมทุกสถานะ", "ทุกสถานะ", "ดูทั้งหมด", "ไม่ต้องกรอง"
// ask to drop the status/payment filter, but withCarriedGroupingFilters above (or the model's own stale
// filter) can still re-add it from recentReads — checked last, on the raw message, so a removal phrase
// always wins regardless of which side produced the value. Period, tool and groupBy are untouched.
const FILTER_REMOVAL_PATTERN = /ไม่เอาตัวกรองแล้ว|ดูรวมทุกสถานะ|ทุกสถานะ|ดูทั้งหมด|ไม่ต้องกรอง/u;

function withoutRemovedStatusFilters(
  filters: Record<string, string | number | boolean | null>,
  messageText: string,
): Record<string, string | number | boolean | null> {
  if (!FILTER_REMOVAL_PATTERN.test(messageText)) return filters;
  const { documentStatus: _documentStatus, paymentStatus: _paymentStatus, ...rest } = filters;
  return rest;
}

function semanticIntentFor(category: ToolMeta['category']): 'read_summary' | 'read_detail' | 'report_request' {
  return category === 'read_detail' ? 'read_detail' : category === 'report' ? 'report_request' : 'read_summary';
}

function simpleReadPlan(input: {
  raw: unknown;
  semanticSubrequests: LineAiSemanticSubrequestV2[];
  enabledTools: ReadonlySet<string>;
  enabledPreparedFamilies: ReadonlySet<string>;
  language: string;
  messageText: string;
  valueCandidates?: LineAiValueCandidates;
  recentReads?: readonly LineAiReadMemory[];
}): { preparedPlan?: LineAiPreparedPlan; canonicalFilters?: Record<string, string | number | boolean | null>; rejection?: CompactSimpleReadRejection } {
  const { raw, semanticSubrequests, enabledTools, enabledPreparedFamilies, language, messageText, valueCandidates, recentReads } = input;
  const only = semanticSubrequests[0];
  if (semanticSubrequests.length !== 1 || !only || only.kind !== 'read' || only.dependsOn.length
    || only.entityReference || only.taskRef || only.writeIntent || only.requiredEvidence.length) {
    return { rejection: 'not_single_independent_read' };
  }
  // tuning-5b (B3): checked before the shape/tool checks below so a why/compare/advice question never
  // takes the fast lane regardless of how the rest of the payload looks.
  if (WHY_COMPARE_ADVICE_PATTERN.test(messageText)) return { rejection: 'why_compare_advice_question' };
  // Advisor Q2 (owner 2026-09-30): "งานค้างของฉัน" is never Q1's one-tool closing checklist.
  if (myPendingWorkQuestion(messageText)) return { rejection: 'my_pending_work_question' };
  // tuning-5b (B1c/B3a): subject/agent are no longer required — derived below from the tool's own
  // registry entry instead of trusted from the model (run 4: 7 reimbursement.get_summary proposals sent
  // agent "general", 8 sent none; both used to fail here for no safety reason). Confidence floor lowered
  // 0.85 -> 0.75, see SIMPLE_READ_CONFIDENCE_FLOOR.
  if (!plainObject(raw) || !exactKeys(raw, SIMPLE_READ_KEYS) || raw['subrequest'] !== 0
    || typeof raw['tool'] !== 'string'
    || !['single_metric', 'list'].includes(String(raw['answerShape']))
    || typeof raw['confidence'] !== 'number' || !Number.isFinite(raw['confidence'])
    || raw['confidence'] < SIMPLE_READ_CONFIDENCE_FLOOR || raw['confidence'] > 1) return { rejection: 'invalid_simple_shape' };

  const tool = TOOL_BY_NAME.get(raw['tool']);
  if (!tool || !enabledTools.has(raw['tool'])) return { rejection: 'tool_not_enabled' };
  if (!SIMPLE_READ_CATEGORIES.has(tool.category)) return { rejection: 'tool_not_read' };
  // tuning-5b (B2): normalize to the tool's one enabled shape before the family gate — see
  // SINGLE_SHAPE_TOOLS. A tool with more than one enabled shape (e.g. expense.list_recent) keeps
  // trusting the model's own answerShape choice.
  const answerShape = SINGLE_SHAPE_TOOLS[tool.name] ?? (raw['answerShape'] as 'single_metric' | 'list');
  if (!enabledPreparedFamilies.has(preparedFamilyKey(tool.name, answerShape))) {
    return { rejection: 'formatter_family_not_allowed' };
  }
  // Derived, canonical (first-listed) registry values — never the model's raw['subject']/raw['agent'],
  // which are no longer read at all.
  const subject = tool.businessSubjects[0]!;
  const agent = tool.supportedAgents[0]!;

  const rawCanonicalFilters = canonicalizeReadToolEnums(tool, only.requestedFilters, messageText, recentReads) as Record<string, string | number | boolean | null> | undefined;
  if (!rawCanonicalFilters) return { rejection: 'filter_not_grounded' };
  const allowedFilters = new Set([...(tool.requiredInputFields ?? []), ...(tool.optionalInputFields ?? [])]);
  const canonicalFilters = withoutRemovedStatusFilters(
    withCarriedGroupingFilters(rawCanonicalFilters, tool, allowedFilters, messageText, recentReads),
    messageText,
  );
  if (!periodSelectionGrounded(canonicalFilters, valueCandidates, recentReads)) return { rejection: 'filter_not_grounded' };
  for (const [key, value] of Object.entries(canonicalFilters)) {
    if (!allowedFilters.has(key)) {
      return { rejection: 'filter_not_supported' };
    }
    if (!isGroundedFilterValue(key, value, messageText, tool, valueCandidates, recentReads)) return { rejection: 'filter_not_grounded' };
  }
  if ((tool.requiredInputFields ?? []).some((key) => canonicalFilters[key] === undefined)) {
    return { rejection: 'required_filter_missing' };
  }

  const candidate = {
    version: 1,
    complexity: 'simple',
    confidence: raw['confidence'],
    intentPlan: {
      status: 'ROUTABLE', language,
      intents: [{ intent: semanticIntentFor(tool.category), subject, agent, priority: 1,
        requiredTools: [tool.name], missingContext: [] }],
      refusals: [], requiresHumanReview: false,
    },
    proposedCalls: [{ toolName: tool.name, input: { ...canonicalFilters } }],
    responseMode: 'simple_grounded',
    answerShape,
  };
  const preparedPlan = parseLineAiPreparedPlan(candidate);
  return preparedPlan ? { preparedPlan, canonicalFilters } : { rejection: 'prepared_contract_invalid' };
}

/** Read dates only, fixed to when the original question was asked; shared by prompt and validator. */
export function clarificationReadCandidates(originals: readonly LineAiOpenClarification[] = []) {
  return originals.flatMap(entry => {
    if (!Number.isFinite(Date.parse(entry.askedAt))) return [];
    const { dates, periods } = extractValueCandidates(entry.text,
      new Date(entry.askedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
    return [{ id: entry.id, dates, periods: periods ?? [] }];
  });
}

/** Expand the provider-private compact decision into the existing canonical gateway contracts. */
export function parseLineIntakeCompactDecision(input: {
  raw: unknown;
  messageText: string;
  inputEvidence: LineAiInputEvidenceV2;
  enabledTools: ReadonlySet<string>;
  enabledPreparedFamilies: ReadonlySet<string>;
  language: string;
  valueCandidates?: LineAiValueCandidates;
  /** Spec §4 R-M5: at most 3, newest first — the same recentReads the router prompt shows the model
   *  (item 3/R-M3), re-checked here so a filter the model claims to have inherited must actually match
   *  a memory entry, never merely be asserted. */
  recentReads?: readonly LineAiReadMemory[];
  /** Only entries selected by resolved ids, or the sole open question when ids were omitted. */
  originalClarifications?: readonly LineAiOpenClarification[];
  /** Called once before rejection so logs and the repair prompt name the same defect. */
  onReject?: (reason: CompactDecodeRejection) => void;
}): CompactDecisionResult | undefined {
  const { raw, messageText, inputEvidence, enabledTools, enabledPreparedFamilies, language, valueCandidates, recentReads, onReject } = input;
  const reject = (reason: CompactDecodeRejection): undefined => { onReject?.(reason); return undefined; };
  if (!plainObject(raw) || !exactKeys(raw, DECISION_KEYS)) return reject('decision_keys_invalid');
  if (!Array.isArray(raw['subrequests']) || raw['subrequests'].length < 1 || raw['subrequests'].length > 8) return reject('decision_subrequests_invalid');
  const canonical: unknown[] = [];
  for (let index = 0; index < raw['subrequests'].length; index += 1) {
    const item = raw['subrequests'][index];
    if (!plainObject(item) || !exactKeys(item, SUBREQUEST_KEYS)) return reject('clause_keys_invalid');
    if (item['index'] !== undefined && item['index'] !== index) return reject('clause_keys_invalid');
    if (!SEMANTIC_KINDS.has(item['kind'] as LineAiSemanticSubrequestV2['kind'])) return reject('clause_kind_invalid');
    if (typeof item['goal'] !== 'string' || !item['goal'].trim() || item['goal'].length > 800) return reject('clause_goal_invalid');
    const originals = ['read', 'general', 'help'].includes(String(item['kind'])) ? input.originalClarifications ?? [] : [];
    const refs = sourceRefs(item['sources'], inputEvidence, reject, originals);
    if (!refs) return undefined;
    const filters = boundedFilters(item['filters'], item['kind'], reject);
    if (!filters) return undefined;
    const requiredEvidence = item['requiredEvidence'] === undefined ? [] : item['requiredEvidence'];
    const dependsOn = item['dependsOn'] === undefined ? [] : item['dependsOn'];
    if (!Array.isArray(requiredEvidence)) return reject('required_evidence_invalid');
    if (!Array.isArray(dependsOn)) return reject('dependencies_invalid');
    const entity = item['entity'];
    if (entity !== undefined && (typeof entity !== 'string' || !entity || entity.length > 160)) return reject('entity_shape_invalid');
    if (typeof entity === 'string' && !messageText.includes(entity) && !originals.some(entry => entry.text.includes(entity)
      && (item['sources'] as Array<{ quote?: string }>).every(source => !source.quote || messageText.includes(source.quote) || entry.text.includes(source.quote)))) return reject('entity_not_in_text');
    // The one defect actually observed in production (4/4 repair attempts): the model copies the bare
    // taskId string instead of the {taskId,taskRevision,subrequestIndex} object. Verify every field's
    // presence and type here (not just the key set) so that specific mistake gets its own reason code
    // rather than falling through to the shared parseLineAiSemanticSubrequests's generic rejection.
    // N1 (tuning-8, T-068-a run 8 attempt 1): the router sent "taskRef": null on an otherwise-correct
    // decision — a null taskRef means the same thing as an absent one (no continuation), so normalize it
    // here before the malformed-shape check below, which must still reject any other non-object, missing
    // field, extra key, or wrong-typed field exactly as today.
    const rawTaskRef = item['taskRef'];
    const taskRef = rawTaskRef === null ? undefined : rawTaskRef;
    if (taskRef !== undefined && (!plainObject(taskRef) || !exactKeys(taskRef, TASK_REF_KEYS)
      || typeof taskRef['taskId'] !== 'string' || !taskRef['taskId']
      || typeof taskRef['taskRevision'] !== 'number' || !Number.isFinite(taskRef['taskRevision'])
      || typeof taskRef['subrequestIndex'] !== 'number' || !Number.isInteger(taskRef['subrequestIndex']) || taskRef['subrequestIndex'] < 0)) {
      return reject('taskref_malformed');
    }
    const writeIntent = item['writeIntent'];
    // Item 4 root cause (eval T-144-b, "ช่วยอนุมัติใบเบิกของสมชายให้หน่อยค่ะ" — approving an EXISTING
    // claim has no writeIntent value at all, since WRITE_INTENTS only covers creating/correcting one):
    // a writeIntent VALUE the tool catalog does not support (C4) must not fail the whole decision,
    // since the clause itself is still perfectly valid without it and lets the normal path answer
    // honestly instead of the intake discarding the entire message. The same is true when the model
    // also gets `kind` wrong on that same clause (e.g. `general` instead of `write`, still naming a
    // writeIntent) — a real model confused the SHAPE of an unsupported write, not its authority, and
    // only a value IN `WRITE_INTENTS` was ever wired to a real tool, so dropping the mismatched hint
    // here removes authority, never grants it — an unknown write still executes nothing either way.
    const recognizedWriteIntent = item['kind'] === 'write'
      && WRITE_INTENTS.has(writeIntent as NonNullable<LineAiSemanticSubrequestV2['writeIntent']>)
      ? writeIntent as NonNullable<LineAiSemanticSubrequestV2['writeIntent']> : undefined;
    // tuning-7b (K1): the compact "tool" hint maps to toolHint only when it names an ENABLED tool in a
    // read category (read_summary/read_detail/report) — a disabled tool, a write/help/file tool, or a
    // typo drops the hint silently rather than failing the whole clause; it is advisory only, so the
    // gateway still runs its own permission-checked call regardless of which tool answers it.
    const hintedTool = typeof item['tool'] === 'string' ? TOOL_BY_NAME.get(item['tool']) : undefined;
    const toolHint = typeof item['tool'] === 'string' && enabledTools.has(item['tool'])
      && hintedTool && SIMPLE_READ_CATEGORIES.has(hintedTool.category) ? item['tool'] : undefined;
    canonical.push({
      index, kind: item['kind'], goal: item['goal'], requiredEvidence, requestedFilters: item['kind'] === 'read' && (toolHint?.startsWith('reimbursement.') || reimbursementStatusQuestion(messageText))
        ? { ...claimAmountFilters(evidenceRefsText(refs, inputEvidence, messageText), input.valueCandidates), ...filters } : filters, dependsOn,
      evidenceRefs: refs,
      ...(entity !== undefined ? { entityReference: { kind: 'user_text', value: entity } } : {}),
      ...(taskRef !== undefined ? { taskRef } : {}),
      ...(recognizedWriteIntent !== undefined ? { writeIntent: recognizedWriteIntent } : {}),
      ...(toolHint !== undefined ? { toolHint } : {}),
    });
  }
  const parsedSubrequests = parseLineAiSemanticSubrequests(canonical, messageText, inputEvidence, input.originalClarifications);
  if (!parsedSubrequests) return reject('semantic_contract_invalid');
  const semanticSubrequests = resolveClaimReadFilters({ messageText, semanticSubrequests: parsedSubrequests, inputEvidence, valueCandidates,
    conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: recentReads ? [...recentReads] : undefined } }).semanticSubrequests;
  if (raw['simpleRead'] === undefined || semanticSubrequests.some(item => claimReadGroupUnavailable({ messageText,
    conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], recentReads: recentReads ? [...recentReads] : undefined } }, item))) return { semanticSubrequests };
  // Read context only: preserve the original relative period at the time the question was asked.
  const originals = input.originalClarifications ?? [];
  const originalCandidates = clarificationReadCandidates(originals);
  const readCandidates = originals.length ? { amounts: valueCandidates?.amounts ?? [],
    dates: [...(valueCandidates?.dates ?? []), ...originalCandidates.flatMap(candidate => candidate.dates)],
    periods: [...(valueCandidates?.periods ?? []), ...originalCandidates.flatMap(candidate => candidate.periods ?? [])] } : valueCandidates;
  const simple = simpleReadPlan({ raw: raw['simpleRead'], semanticSubrequests, enabledTools, enabledPreparedFamilies, language,
    messageText: [messageText, ...originals.map(entry => entry.text)].join('\n'), valueCandidates: readCandidates, recentReads });
  const canonicalSemantic = simple.canonicalFilters
    ? semanticSubrequests.map((item, index) => index === 0 ? { ...item, requestedFilters: simple.canonicalFilters! } : item)
    : semanticSubrequests;
  return {
    semanticSubrequests: canonicalSemantic,
    ...(simple.preparedPlan ? { preparedPlan: simple.preparedPlan } : {}),
    ...(simple.rejection ? { simpleReadRejection: simple.rejection } : {}),
  };
}
