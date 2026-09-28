/**
 * Bounded parser for the optional LINE AI prepared plan (latency/autonomy §7).
 *
 * Prepared-plan wire data is UNTRUSTED. Every trust boundary that receives one — the API forwarder,
 * the AI Gateway turn use case, and the AgentCore runtime payload validator — runs it through
 * `parseLineAiPreparedPlan` and never casts raw JSON into `LineAiPreparedPlan`. The parser bounds
 * size and shape and rejects prototype pollution and scope/credential injection; it grants no
 * authority. Any failure returns `undefined` so the caller falls back to full orchestration, and a
 * legacy artifact that never sends the field is `undefined` for the same safe reason.
 *
 * This file carries the bounding only. The live authority checks (permission, entitlement,
 * delegation, subject, registry, formatter coverage) stay where they already run, at execution.
 */
import type { AgentIntentPlan, AgentIntentItem, AgentRefusal, LineAiPreparedCall, LineAiPreparedPlan } from './line-ai.js';
import { LINE_AI_AGENT_REGISTRY, LINE_AI_BUSINESS_SUBJECTS } from './line-ai.js';
import { LINE_TOOL_REGISTRY } from './ai-tools.js';
import { validateLineAiSourceRefV2, type LineAiInputEvidenceV2, type LineAiSourceRefV2 } from './line-ai-input-evidence.js';

/** Version 1 wrapper bounds (spec §7), concrete so every receiver enforces the same limits. */
export const LINE_AI_PREPARED_PLAN_BOUNDS = {
  version: 1,
  /** Encoded wrapper ceiling. */
  maxEncodedBytes: 32 * 1024,
  /** Maximum plain-object nesting depth of a proposed tool input (root input object = depth 1). */
  maxInputDepth: 4,
  maxKeysPerObject: 32,
  maxArrayItems: 50,
  maxStringBytes: 512,
  /** Longest bounded label/enum-ish string carried inside the plan wrapper. */
  maxLabelBytes: 200,
  /** Veto floor a plan claiming `simple` must clear at parse; below it the plan drops to fallback.
   *  tuning-5 (2026-09-28): 0.85 -> 0.75, together with the gateway decoder and pre-call floors. The
   *  router's self-reported confidence is uncalibrated: in the run-4 eval every single read it scored
   *  0.75-0.84 was a genuinely simple read (e.g. "มีร่างค้างอยู่ไหมคะ"). Every structural veto below
   *  still applies, and why/compare/advice questions are kept off this lane by a deterministic guard
   *  in the gateway decoder. */
  simpleConfidenceFloor: 0.75,
} as const;

const COMPLEXITIES = new Set<LineAiPreparedPlan['complexity']>(['simple', 'complex']);
const RESPONSE_MODES = new Set<LineAiPreparedPlan['responseMode']>([
  'deterministic', 'casual_composer', 'simple_grounded', 'full_agentic',
]);
const ANSWER_SHAPES = new Set<NonNullable<LineAiPreparedPlan['answerShape']>>([
  'single_metric', 'list', 'summary', 'comparison',
]);
const PLAN_STATUSES = new Set<AgentIntentPlan['status']>(['ROUTABLE', 'PARTIAL', 'UNROUTABLE']);
const REGISTERED_TOOLS = new Set(LINE_TOOL_REGISTRY.map((tool) => tool.name));
const PREPARED_PLAN_KEYS = new Set(['version', 'inputDigest', 'complexity', 'confidence', 'intentPlan', 'proposedCalls', 'responseMode', 'answerShape']);
const HASH = /^[0-9a-f]{64}$/u;
// Category by tool name, so a simple-read call can be checked against the read families without a
// second registry scan. Read categories only feed the simple structural check.
const TOOL_CATEGORY = new Map(LINE_TOOL_REGISTRY.map((tool) => [tool.name, tool.category] as const));
const SIMPLE_READ_CATEGORIES = new Set(['read_summary', 'read_detail', 'report']);

// Explicit allowed-sets for every enum carried inside the wrapper, so no raw wire string is ever cast
// into a typed enum: a value outside the set drops the whole plan to fallback. Kept in lockstep with
// the unions in line-ai.ts (agents/subjects reuse the runtime registries there).
const INTENTS = new Set<AgentIntentItem['intent']>([
  'casual_conversation', 'capability_help', 'read_summary', 'read_detail', 'report_request',
  'sales_suggestion', 'capture_accounting_evidence', 'mutation_request', 'unsupported_module',
  'forbidden', 'unknown',
]);
const AGENTS = new Set<AgentIntentItem['agent']>(LINE_AI_AGENT_REGISTRY.map((agent) => agent.agent));
const SUBJECTS = new Set<AgentIntentItem['subject']>(LINE_AI_BUSINESS_SUBJECTS);
const REFUSAL_REASONS = new Set<AgentRefusal['reason']>([
  'mutation_blocked', 'safety_crisis', 'privacy_rumor', 'unsupported_module', 'unsupported_yet',
  'forbidden', 'unlinked_user', 'ambiguous_company', 'tool_unavailable', 'feature_disabled',
  'ai_timeout', 'line_delivery_failure',
]);

/**
 * Keys forbidden anywhere inside a proposed tool input: prototype-pollution vectors plus the
 * scope, permission, entitlement, delegation, and credential fields a forged plan might use to
 * widen authority. A tool input carrying any of these is REJECTED (the whole plan drops to
 * fallback), not silently stripped, so the forgery attempt fails visibly. Legitimate read-tool
 * inputs (fromDate/toDate/date/search/…) never contain these words.
 */
const FORBIDDEN_INPUT_KEY =
  /(^__proto__$)|(^prototype$)|(^constructor$)|actor|deleg|user|compan|tenant|branch|location|permission|entitl|feature|token|credential|secret|password|signature|membership|scope|role/i;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Type-guarding allowed-set membership: narrows an untrusted value to the set's member type, so
 *  every enum on the wire is validated by explicit membership rather than cast blindly. */
function inSet<T extends string>(set: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === 'string' && (set as ReadonlySet<string>).has(value);
}

function boundedLabel(value: unknown, max: number = LINE_AI_PREPARED_PLAN_BOUNDS.maxLabelBytes): value is string {
  return typeof value === 'string' && byteLength(value) <= max;
}

/** Returned when an untrusted tool-input value violates any v1 bound. */
const INVALID_INPUT = Symbol('invalid-input');

/**
 * Validate AND deep-rebuild a JSON-safe tool-input value within every v1 bound: plain objects and
 * arrays only, no prototype/scope/credential keys, depth/key/array/string caps respected. Returns a
 * FRESH value (every nested array and object newly constructed) so a later mutation of the untrusted
 * wire value can never reach the parsed contract, or `INVALID_INPUT` on any violation. `depth` is the
 * current nesting level; the root input object is passed at depth 1.
 */
function rebuildBoundedInput(value: unknown, depth: number): unknown {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'boolean') return value;
  if (kind === 'number') return Number.isFinite(value as number) ? value : INVALID_INPUT;
  if (kind === 'string') return byteLength(value as string) <= LINE_AI_PREPARED_PLAN_BOUNDS.maxStringBytes ? value : INVALID_INPUT;
  if (depth > LINE_AI_PREPARED_PLAN_BOUNDS.maxInputDepth) return INVALID_INPUT;
  if (Array.isArray(value)) {
    if (value.length > LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems) return INVALID_INPUT;
    const out: unknown[] = [];
    for (const item of value) {
      const rebuilt = rebuildBoundedInput(item, depth + 1);
      if (rebuilt === INVALID_INPUT) return INVALID_INPUT;
      out.push(rebuilt);
    }
    return out;
  }
  if (!isPlainObject(value)) return INVALID_INPUT;
  const keys = Object.keys(value);
  if (keys.length > LINE_AI_PREPARED_PLAN_BOUNDS.maxKeysPerObject) return INVALID_INPUT;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (FORBIDDEN_INPUT_KEY.test(key)) return INVALID_INPUT;
    const rebuilt = rebuildBoundedInput(value[key], depth + 1);
    if (rebuilt === INVALID_INPUT) return INVALID_INPUT;
    out[key] = rebuilt;
  }
  return out;
}

function parseIntentItem(value: unknown): AgentIntentItem | undefined {
  if (!isPlainObject(value)) return undefined;
  const { intent, subject, agent, priority, requiredTools, missingContext } = value;
  // Explicit allowed-set membership (type-guarded), never a blind cast of the wire string.
  if (!inSet(INTENTS, intent) || !inSet(SUBJECTS, subject) || !inSet(AGENTS, agent)) return undefined;
  if (typeof priority !== 'number' || !Number.isFinite(priority)) return undefined;
  if (!isBoundedStringArray(requiredTools) || !isBoundedStringArray(missingContext)) return undefined;
  return { intent, subject, agent, priority, requiredTools: [...requiredTools], missingContext: [...missingContext] };
}

function parseRefusal(value: unknown): AgentRefusal | undefined {
  if (!isPlainObject(value)) return undefined;
  if (!boundedLabel(value['request'], LINE_AI_PREPARED_PLAN_BOUNDS.maxStringBytes)) return undefined;
  if (!inSet(REFUSAL_REASONS, value['reason'])) return undefined;
  return { request: value['request'], reason: value['reason'] };
}

function isBoundedStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems
    && value.every((item) => boundedLabel(item));
}

/** Structurally validate and rebuild the wrapped intent plan; never return the raw wire object. */
function parseIntentPlan(value: unknown): AgentIntentPlan | undefined {
  if (!isPlainObject(value)) return undefined;
  const { status, language, intents, refusals, requiresHumanReview } = value;
  if (!inSet(PLAN_STATUSES, status)) return undefined;
  if (!boundedLabel(language) || typeof requiresHumanReview !== 'boolean') return undefined;
  if (!Array.isArray(intents) || intents.length > LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems) return undefined;
  if (!Array.isArray(refusals) || refusals.length > LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems) return undefined;
  const parsedIntents: AgentIntentItem[] = [];
  for (const raw of intents) {
    const item = parseIntentItem(raw);
    if (!item) return undefined;
    parsedIntents.push(item);
  }
  const parsedRefusals: AgentRefusal[] = [];
  for (const raw of refusals) {
    const item = parseRefusal(raw);
    if (!item) return undefined;
    parsedRefusals.push(item);
  }
  return { status, language, intents: parsedIntents, refusals: parsedRefusals, requiresHumanReview };
}

function parseProposedCall(
  value: unknown,
  options?: { inputEvidence?: LineAiInputEvidenceV2; candidateIds?: ReadonlySet<string> },
  version = 1,
): LineAiPreparedCall | undefined {
  if (!isPlainObject(value)) return undefined;
  const callKeys = new Set(['toolName', 'input', ...(version === 2 ? ['candidateIds', 'sourceRefs'] : [])]);
  if (version === 2 && Object.keys(value).some((key) => !callKeys.has(key))) return undefined;
  const { toolName, input } = value;
  // Reject an unregistered tool at the parse boundary as defense-in-depth; the executor re-checks
  // the registry and live permissions again before any call.
  if (typeof toolName !== 'string' || !REGISTERED_TOOLS.has(toolName)) return undefined;
  if (!isPlainObject(input)) return undefined;
  // Deep rebuild: the returned input shares no nested array/object with the untrusted wire value, so a
  // post-parse mutation of the wire input cannot mutate the parsed contract.
  const rebuilt = rebuildBoundedInput(input, 1);
  if (rebuilt === INVALID_INPUT || !isPlainObject(rebuilt)) return undefined;
  if (version === 1) return { toolName, input: rebuilt };
  let candidateIds: string[] | undefined;
  if (value['candidateIds'] !== undefined) {
    const allowedCandidateIds = options?.candidateIds;
    if (!Array.isArray(value['candidateIds']) || value['candidateIds'].length > 128
      || !allowedCandidateIds
      || value['candidateIds'].some((id) => typeof id !== 'string' || !HASH.test(id)
        || !allowedCandidateIds.has(id))) return undefined;
    candidateIds = [...new Set(value['candidateIds'] as string[])];
    if (candidateIds.length !== value['candidateIds'].length) return undefined;
  }
  let sourceRefs: LineAiSourceRefV2[] | undefined;
  if (value['sourceRefs'] !== undefined) {
    if (!options?.inputEvidence || !Array.isArray(value['sourceRefs']) || value['sourceRefs'].length > 128) return undefined;
    sourceRefs = [];
    for (const rawRef of value['sourceRefs']) {
      if (typeof validateLineAiSourceRefV2(rawRef, options.inputEvidence) !== 'string') return undefined;
      const ref = rawRef as Record<string, unknown>;
      sourceRefs.push({ partId: ref['partId'] as string, startUtf16: ref['startUtf16'] as number,
        endUtf16: ref['endUtf16'] as number, rawSha256: ref['rawSha256'] as string });
    }
  }
  return { toolName, input: rebuilt, ...(candidateIds ? { candidateIds } : {}), ...(sourceRefs ? { sourceRefs } : {}) };
}

/**
 * Parse and bound an untrusted prepared-plan wrapper. Returns the rebuilt plan when every v1 bound
 * holds, or `undefined` on any failure (unknown/absent field, oversize, bad shape, out-of-range
 * confidence, unknown tool, prototype/scope/credential injection) so the caller falls back safely.
 */
export function parseLineAiPreparedPlan(
  raw: unknown,
  options?: { inputEvidence?: LineAiInputEvidenceV2; candidateIds?: ReadonlySet<string> },
): LineAiPreparedPlan | undefined {
  if (!isPlainObject(raw)) return undefined;

  let encoded: string;
  try {
    encoded = JSON.stringify(raw);
  } catch {
    return undefined; // circular or otherwise non-serialisable
  }
  if (!encoded || byteLength(encoded) > LINE_AI_PREPARED_PLAN_BOUNDS.maxEncodedBytes) return undefined;

  const version = raw['version'];
  if (version !== 1 && version !== 2) return undefined;
  if (version === 2 && Object.keys(raw).some((key) => !PREPARED_PLAN_KEYS.has(key))) return undefined;
  if (version === 1 && raw['inputDigest'] !== undefined) return undefined;
  if (version === 2 && (!options?.inputEvidence || raw['inputDigest'] !== options.inputEvidence.joinedSha256)) return undefined;
  if (version === 2 && (typeof raw['inputDigest'] !== 'string' || !HASH.test(raw['inputDigest']))) return undefined;
  const complexity = raw['complexity'];
  if (!inSet(COMPLEXITIES, complexity)) return undefined;
  const responseMode = raw['responseMode'];
  if (!inSet(RESPONSE_MODES, responseMode)) return undefined;
  const rawAnswerShape = raw['answerShape'];
  let answerShape: LineAiPreparedPlan['answerShape'];
  if (rawAnswerShape !== undefined) {
    if (!inSet(ANSWER_SHAPES, rawAnswerShape)) return undefined;
    answerShape = rawAnswerShape;
  }
  const confidence = raw['confidence'];
  // Bounded to [0,1]; never recomputed and never used to GRANT authority. It is veto-only: below the
  // simple floor a `simple` plan drops to fallback (checked in the structural block below).
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return undefined;
  }

  const intentPlan = parseIntentPlan(raw['intentPlan']);
  if (!intentPlan) return undefined;

  const rawCalls = raw['proposedCalls'];
  if (!Array.isArray(rawCalls) || rawCalls.length > LINE_AI_PREPARED_PLAN_BOUNDS.maxArrayItems) return undefined;
  const proposedCalls: LineAiPreparedCall[] = [];
  for (const rawCall of rawCalls) {
    const call = parseProposedCall(rawCall, options, version);
    if (!call) return undefined;
    proposedCalls.push(call);
  }

  // Phase-2 STRUCTURAL invariants for a plan that claims to be simple (spec §7). These are pure
  // shape/equality checks (no live permission/subject/formatter state — those stay at execution):
  // confidence veto floor, exactly one intent, at most one call, and when a call is present exact
  // equality between it and the single required read tool. The equality is enforced HERE, not
  // deferred, so a forged "simple" wrapper can never widen its own shape.
  if (complexity === 'simple') {
    if (confidence < LINE_AI_PREPARED_PLAN_BOUNDS.simpleConfidenceFloor) return undefined;
    if (intentPlan.intents.length !== 1) return undefined;
    if (proposedCalls.length > 1) return undefined;
    const only = intentPlan.intents[0];
    if (proposedCalls.length === 1) {
      if (only.requiredTools.length !== 1 || proposedCalls[0].toolName !== only.requiredTools[0]) return undefined;
      if (!SIMPLE_READ_CATEGORIES.has(TOOL_CATEGORY.get(proposedCalls[0].toolName) ?? '')) return undefined;
    } else {
      // A zero-call simple plan is only meaningful as a zero-tool conversational/help turn or an
      // explicit refusal — never a forged actionable read (e.g. read_summary) with no required tool.
      if (only.requiredTools.length !== 0) return undefined;
      const conversational = only.intent === 'casual_conversation' || only.intent === 'capability_help';
      if (!conversational && intentPlan.refusals.length === 0) return undefined;
    }
  }

  return {
    version,
    ...(version === 2 ? { inputDigest: raw['inputDigest'] as string } : {}),
    complexity,
    confidence,
    intentPlan,
    proposedCalls,
    responseMode,
    ...(answerShape !== undefined ? { answerShape } : {}),
  };
}
