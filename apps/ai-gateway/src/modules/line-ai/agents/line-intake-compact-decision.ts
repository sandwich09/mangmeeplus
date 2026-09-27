import {
  LINE_AI_BUSINESS_SUBJECTS,
  LINE_TOOL_REGISTRY,
  parseLineAiPreparedPlan,
  parseLineAiSemanticSubrequests,
} from '@watchdog-bms/contracts';
import type {
  LineAiInputEvidenceV2,
  LineAiPreparedPlan,
  LineAiReadMemory,
  LineAiSemanticSubrequestV2,
  LineAiValueCandidates,
  ToolMeta,
} from '@watchdog-bms/contracts';
import { preparedFamilyKey } from '../domain/logic/prepared-simple-read.logic';
import { canonicalizeReadToolEnums, nameFilterGroundedInText, paymentStatusGroundedInText } from './read-tool-input';

// Spec item 2(b): categoryName/vendorName are free text the model must have echoed from what the user
// typed, not a value proven by an id/date/enum shape. Checked by normalized substring, not raw equality.
const NAME_FILTER_GROUNDING_FIELDS = new Set(['categoryName', 'vendorName']);

const DECISION_KEYS = new Set(['subrequests', 'simpleRead']);
const SUBREQUEST_KEYS = new Set([
  'kind', 'goal', 'sources', 'filters', 'requiredEvidence', 'dependsOn', 'entity', 'taskRef', 'writeIntent',
]);
const SOURCE_KEYS = new Set(['part', 'whole', 'quote']);
const SIMPLE_READ_KEYS = new Set(['subrequest', 'tool', 'subject', 'agent', 'answerShape', 'confidence']);
const TASK_REF_KEYS = new Set(['taskId', 'taskRevision', 'subrequestIndex']);
const SEMANTIC_KINDS = new Set<LineAiSemanticSubrequestV2['kind']>(['read', 'general', 'write', 'help', 'public', 'file']);
const WRITE_INTENTS = new Set<NonNullable<LineAiSemanticSubrequestV2['writeIntent']>>([
  'EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION', 'EXPENSE_CAPTURE_CORRECTION',
  'SUBSTITUTE_RECEIPT_CONTINUATION', 'REIMBURSEMENT_REQUEST_START',
]);
const SIMPLE_READ_CATEGORIES = new Set<ToolMeta['category']>(['read_summary', 'read_detail', 'report']);
const TOOL_BY_NAME = new Map(LINE_TOOL_REGISTRY.map((tool) => [tool.name, tool] as const));
const KNOWN_FILTER_KEYS = new Set(LINE_TOOL_REGISTRY.flatMap((tool) => [
  ...(tool.requiredInputFields ?? []), ...(tool.optionalInputFields ?? []),
]));
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
// ponytail: bounded to the two shapes worth naming in a repair prompt today — the observed real-world
// failure (a malformed taskRef) versus everything else. Split further if a repair loop needs to target
// another specific defect.
export type CompactDecodeRejection = 'taskref_malformed' | 'decision_shape_invalid';
export type CompactSimpleReadRejection =
  | 'not_single_independent_read'
  | 'invalid_simple_shape'
  | 'tool_not_enabled'
  | 'tool_not_read'
  | 'tool_subject_mismatch'
  | 'tool_agent_mismatch'
  | 'formatter_family_not_allowed'
  | 'filter_not_supported'
  | 'filter_not_grounded'
  | 'required_filter_missing'
  | 'prepared_contract_invalid';

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

function sourceRefs(raw: unknown, evidence: LineAiInputEvidenceV2): LineAiSemanticSubrequestV2['evidenceRefs'] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return undefined;
  const refs: NonNullable<LineAiSemanticSubrequestV2['evidenceRefs']> = [];
  for (const value of raw) {
    if (!plainObject(value) || !exactKeys(value, SOURCE_KEYS) || !Number.isSafeInteger(value['part'])) return undefined;
    const part = evidence.parts[Number(value['part'])];
    if (!part) return undefined;
    const hasWhole = Object.prototype.hasOwnProperty.call(value, 'whole');
    const hasQuote = Object.prototype.hasOwnProperty.call(value, 'quote');
    if (hasWhole === hasQuote || hasWhole && value['whole'] !== true || hasQuote && typeof value['quote'] !== 'string') return undefined;
    const whole = hasWhole;
    const quote = hasQuote ? value['quote'] as string : undefined;
    if (whole) {
      refs.push({ partId: part.partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 });
      continue;
    }
    if (!quote || quote.length > 800) return undefined;
    const start = part.rawText.indexOf(quote);
    if (start < 0 || part.rawText.indexOf(quote, start + 1) >= 0) return undefined;
    refs.push({ partId: part.partId, startUtf16: start, endUtf16: start + quote.length, rawSha256: part.rawSha256 });
  }
  return refs;
}

function boundedFilters(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!plainObject(value) || Object.keys(value).length > 16) return undefined;
  const filters = Object.create(null) as Record<string, string | number | boolean | null>;
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 80 || RESERVED_KEYS.has(key) || !KNOWN_FILTER_KEYS.has(key)
      || !(item === null || typeof item === 'boolean'
      || typeof item === 'number' && Number.isFinite(item)
      || typeof item === 'string' && item.length <= 200)) return undefined;
    filters[key] = item as string | number | boolean | null;
  }
  return filters;
}

// Spec §4 R-M5: a value the API already proved it applied (queryApplied, never the model's own prior
// input) is grounded the same way a current-message/valueCandidates match is — this is what lets a
// follow-up naming no period or filter of its own still pass this same check. Only the string filter
// fields memory carries at all are looked up; fromDate/toDate/periodKey go through
// recentReadsPeriodMatch below (a pair, not a single field) exactly like valueCandidates.periods does.
const RECENT_READS_STRING_FIELDS = new Set(['documentStatus', 'paymentStatus', 'categoryId', 'categoryName', 'vendorId', 'vendorName', 'branchId', 'branchName', 'groupBy']);

function recentReadsFilterValue(key: string, value: string, recentReads: readonly LineAiReadMemory[] | undefined): boolean {
  if (!RECENT_READS_STRING_FIELDS.has(key)) return false;
  return (recentReads ?? []).some((entry) => (entry as unknown as Record<string, unknown>)[key] === value);
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
  const literal = String(value);
  if (literal && messageText.includes(literal)) return true;
  if (typeof value === 'string' && NAME_FILTER_GROUNDING_FIELDS.has(key) && nameFilterGroundedInText(value, messageText)) return true;
  // Item 1: paymentStatus needs its own word-level check — see paymentStatusGroundedInText — before
  // the generic enum-membership fallback below, which would otherwise wave through ANY listed value.
  if (key === 'paymentStatus' && typeof value === 'string') return paymentStatusGroundedInText(value, messageText);
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
  if (!plainObject(raw) || !exactKeys(raw, SIMPLE_READ_KEYS) || raw['subrequest'] !== 0
    || typeof raw['tool'] !== 'string' || typeof raw['subject'] !== 'string' || typeof raw['agent'] !== 'string'
    || !['single_metric', 'list'].includes(String(raw['answerShape']))
    || typeof raw['confidence'] !== 'number' || !Number.isFinite(raw['confidence'])
    || raw['confidence'] < 0.85 || raw['confidence'] > 1) return { rejection: 'invalid_simple_shape' };

  const tool = TOOL_BY_NAME.get(raw['tool']);
  if (!tool || !enabledTools.has(raw['tool'])) return { rejection: 'tool_not_enabled' };
  if (!SIMPLE_READ_CATEGORIES.has(tool.category)) return { rejection: 'tool_not_read' };
  if (!enabledPreparedFamilies.has(preparedFamilyKey(tool.name, String(raw['answerShape'])))) {
    return { rejection: 'formatter_family_not_allowed' };
  }
  if (!LINE_AI_BUSINESS_SUBJECTS.includes(raw['subject'] as typeof LINE_AI_BUSINESS_SUBJECTS[number])
    || !tool.businessSubjects.includes(raw['subject'] as typeof tool.businessSubjects[number])) {
    return { rejection: 'tool_subject_mismatch' };
  }
  if (!tool.supportedAgents.includes(raw['agent'])) return { rejection: 'tool_agent_mismatch' };

  const canonicalFilters = canonicalizeReadToolEnums(tool, only.requestedFilters) as Record<string, string | number | boolean | null> | undefined;
  if (!canonicalFilters) return { rejection: 'filter_not_grounded' };
  const allowedFilters = new Set([...(tool.requiredInputFields ?? []), ...(tool.optionalInputFields ?? [])]);
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
      intents: [{ intent: semanticIntentFor(tool.category), subject: raw['subject'], agent: raw['agent'], priority: 1,
        requiredTools: [tool.name], missingContext: [] }],
      refusals: [], requiresHumanReview: false,
    },
    proposedCalls: [{ toolName: tool.name, input: { ...canonicalFilters } }],
    responseMode: 'simple_grounded',
    answerShape: raw['answerShape'],
  };
  const preparedPlan = parseLineAiPreparedPlan(candidate);
  return preparedPlan ? { preparedPlan, canonicalFilters } : { rejection: 'prepared_contract_invalid' };
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
  /** Called once, with the specific reason, immediately before a rejecting return — so a caller can
   *  log it and name the defect in the next repair prompt instead of retrying blind. */
  onReject?: (reason: CompactDecodeRejection) => void;
}): CompactDecisionResult | undefined {
  const { raw, messageText, inputEvidence, enabledTools, enabledPreparedFamilies, language, valueCandidates, recentReads, onReject } = input;
  const reject = (reason: CompactDecodeRejection): undefined => { onReject?.(reason); return undefined; };
  if (!plainObject(raw) || !exactKeys(raw, DECISION_KEYS) || !Array.isArray(raw['subrequests'])
    || raw['subrequests'].length < 1 || raw['subrequests'].length > 8) return reject('decision_shape_invalid');
  const canonical: unknown[] = [];
  for (let index = 0; index < raw['subrequests'].length; index += 1) {
    const item = raw['subrequests'][index];
    if (!plainObject(item) || !exactKeys(item, SUBREQUEST_KEYS)
      || !SEMANTIC_KINDS.has(item['kind'] as LineAiSemanticSubrequestV2['kind'])
      || typeof item['goal'] !== 'string' || !item['goal'].trim() || item['goal'].length > 800) return reject('decision_shape_invalid');
    const refs = sourceRefs(item['sources'], inputEvidence);
    const filters = boundedFilters(item['filters']);
    if (!refs || !filters) return reject('decision_shape_invalid');
    const requiredEvidence = item['requiredEvidence'] === undefined ? [] : item['requiredEvidence'];
    const dependsOn = item['dependsOn'] === undefined ? [] : item['dependsOn'];
    if (!Array.isArray(requiredEvidence) || !Array.isArray(dependsOn)) return reject('decision_shape_invalid');
    const entity = item['entity'];
    if (entity !== undefined && (typeof entity !== 'string' || !entity || entity.length > 160 || !messageText.includes(entity))) return reject('decision_shape_invalid');
    // The one defect actually observed in production (4/4 repair attempts): the model copies the bare
    // taskId string instead of the {taskId,taskRevision,subrequestIndex} object. Verify every field's
    // presence and type here (not just the key set) so that specific mistake gets its own reason code
    // rather than falling through to the shared parseLineAiSemanticSubrequests's generic rejection.
    const taskRef = item['taskRef'];
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
    canonical.push({
      index, kind: item['kind'], goal: item['goal'], requiredEvidence, requestedFilters: filters, dependsOn,
      evidenceRefs: refs,
      ...(entity !== undefined ? { entityReference: { kind: 'user_text', value: entity } } : {}),
      ...(taskRef !== undefined ? { taskRef } : {}),
      ...(recognizedWriteIntent !== undefined ? { writeIntent: recognizedWriteIntent } : {}),
    });
  }
  const semanticSubrequests = parseLineAiSemanticSubrequests(canonical, messageText, inputEvidence);
  if (!semanticSubrequests) return reject('decision_shape_invalid');
  if (raw['simpleRead'] === undefined) return { semanticSubrequests };
  const simple = simpleReadPlan({ raw: raw['simpleRead'], semanticSubrequests, enabledTools, enabledPreparedFamilies, language, messageText, valueCandidates, recentReads });
  const canonicalSemantic = simple.canonicalFilters
    ? semanticSubrequests.map((item, index) => index === 0 ? { ...item, requestedFilters: simple.canonicalFilters! } : item)
    : semanticSubrequests;
  return {
    semanticSubrequests: canonicalSemantic,
    ...(simple.preparedPlan ? { preparedPlan: simple.preparedPlan } : {}),
    ...(simple.rejection ? { simpleReadRejection: simple.rejection } : {}),
  };
}
