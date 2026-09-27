import {
  LINE_AI_BUSINESS_SUBJECTS,
  LINE_TOOL_REGISTRY,
  parseLineAiPreparedPlan,
  parseLineAiSemanticSubrequests,
} from '@watchdog-bms/contracts';
import type {
  LineAiInputEvidenceV2,
  LineAiPreparedPlan,
  LineAiSemanticSubrequestV2,
  LineAiValueCandidates,
  ToolMeta,
} from '@watchdog-bms/contracts';
import { preparedFamilyKey } from '../domain/logic/prepared-simple-read.logic';
import { canonicalizeReadToolEnums } from './read-tool-input';

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

function isGroundedFilterValue(
  key: string,
  value: string | number | boolean | null,
  messageText: string,
  tool: ToolMeta,
  candidates?: LineAiValueCandidates,
): boolean {
  if (value === null) return true;
  const literal = String(value);
  if (literal && messageText.includes(literal)) return true;
  if (typeof value === 'string' && tool.inputEnumValues?.[key]?.includes(value)) return true;
  if (key === 'fromDate') return (candidates?.periods ?? []).some((period) => period.fromDate === value);
  if (key === 'toDate') return (candidates?.periods ?? []).some((period) => period.toDate === value);
  if (key === 'periodKey') return (candidates?.periods ?? []).some((period) => period.monthKey === value);
  // A boolean or numeric default that the user did not select is still invented model input.
  return false;
}

function periodSelectionGrounded(filters: Record<string, string | number | boolean | null>, candidates?: LineAiValueCandidates): boolean {
  const fromDate = filters['fromDate'], toDate = filters['toDate'], periodKey = filters['periodKey'];
  if (periodKey !== undefined && (fromDate !== undefined || toDate !== undefined)) return false;
  if ((fromDate === undefined) !== (toDate === undefined)) return false;
  if (fromDate !== undefined && toDate !== undefined) {
    return (candidates?.periods ?? []).some((period) => period.fromDate === fromDate && period.toDate === toDate);
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
}): { preparedPlan?: LineAiPreparedPlan; canonicalFilters?: Record<string, string | number | boolean | null>; rejection?: CompactSimpleReadRejection } {
  const { raw, semanticSubrequests, enabledTools, enabledPreparedFamilies, language, messageText, valueCandidates } = input;
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
  if (!periodSelectionGrounded(canonicalFilters, valueCandidates)) return { rejection: 'filter_not_grounded' };
  for (const [key, value] of Object.entries(canonicalFilters)) {
    if (!allowedFilters.has(key)) {
      return { rejection: 'filter_not_supported' };
    }
    if (!isGroundedFilterValue(key, value, messageText, tool, valueCandidates)) return { rejection: 'filter_not_grounded' };
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
}): CompactDecisionResult | undefined {
  const { raw, messageText, inputEvidence, enabledTools, enabledPreparedFamilies, language, valueCandidates } = input;
  if (!plainObject(raw) || !exactKeys(raw, DECISION_KEYS) || !Array.isArray(raw['subrequests'])
    || raw['subrequests'].length < 1 || raw['subrequests'].length > 8) return undefined;
  const canonical: unknown[] = [];
  for (let index = 0; index < raw['subrequests'].length; index += 1) {
    const item = raw['subrequests'][index];
    if (!plainObject(item) || !exactKeys(item, SUBREQUEST_KEYS)
      || !SEMANTIC_KINDS.has(item['kind'] as LineAiSemanticSubrequestV2['kind'])
      || typeof item['goal'] !== 'string' || !item['goal'].trim() || item['goal'].length > 800) return undefined;
    const refs = sourceRefs(item['sources'], inputEvidence);
    const filters = boundedFilters(item['filters']);
    if (!refs || !filters) return undefined;
    const requiredEvidence = item['requiredEvidence'] === undefined ? [] : item['requiredEvidence'];
    const dependsOn = item['dependsOn'] === undefined ? [] : item['dependsOn'];
    if (!Array.isArray(requiredEvidence) || !Array.isArray(dependsOn)) return undefined;
    const entity = item['entity'];
    if (entity !== undefined && (typeof entity !== 'string' || !entity || entity.length > 160 || !messageText.includes(entity))) return undefined;
    const taskRef = item['taskRef'];
    if (taskRef !== undefined && (!plainObject(taskRef) || !exactKeys(taskRef, TASK_REF_KEYS))) return undefined;
    const writeIntent = item['writeIntent'];
    if (writeIntent !== undefined && (item['kind'] !== 'write'
      || !WRITE_INTENTS.has(writeIntent as NonNullable<LineAiSemanticSubrequestV2['writeIntent']>))) return undefined;
    canonical.push({
      index, kind: item['kind'], goal: item['goal'], requiredEvidence, requestedFilters: filters, dependsOn,
      evidenceRefs: refs,
      ...(entity !== undefined ? { entityReference: { kind: 'user_text', value: entity } } : {}),
      ...(taskRef !== undefined ? { taskRef } : {}),
      ...(writeIntent !== undefined ? { writeIntent } : {}),
    });
  }
  const semanticSubrequests = parseLineAiSemanticSubrequests(canonical, messageText, inputEvidence);
  if (!semanticSubrequests) return undefined;
  if (raw['simpleRead'] === undefined) return { semanticSubrequests };
  const simple = simpleReadPlan({ raw: raw['simpleRead'], semanticSubrequests, enabledTools, enabledPreparedFamilies, language, messageText, valueCandidates });
  const canonicalSemantic = simple.canonicalFilters
    ? semanticSubrequests.map((item, index) => index === 0 ? { ...item, requestedFilters: simple.canonicalFilters! } : item)
    : semanticSubrequests;
  return {
    semanticSubrequests: canonicalSemantic,
    ...(simple.preparedPlan ? { preparedPlan: simple.preparedPlan } : {}),
    ...(simple.rejection ? { simpleReadRejection: simple.rejection } : {}),
  };
}
