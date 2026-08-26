/**
 * Bounded parser for the optional prepared advisor answer (advisor spec §9 / §9.1).
 *
 * Advisor wire data is UNTRUSTED. It rides as a SIBLING of `clarifyQuestion` on
 * `LineIntakeRoutePlan` — never nested inside `LineAiPreparedPlan`, which is tied to
 * `capabilities.fusedPlan` and its ~21KB catalog — and it opens NO second trust chain: every
 * receiver that reads one runs it through `parseLineAiPreparedAdvisorAnswer` and never casts raw
 * JSON into `PreparedAdvisorAnswer`. The parser bounds size and shape, validates every enum by
 * explicit membership, and REJECTS any attempt to smuggle server-derived provenance. It grants no
 * authority: any failure returns `undefined` so the caller falls back to the existing full path,
 * and a legacy artifact that never sends the field is `undefined` for the same safe reason.
 *
 * This file carries the bounding only. Direct-answer ELIGIBILITY (spec §9.2 — outer intent, open
 * state, group/room, card registry, profile permission, grounding validators, per-lane length) stays
 * where it runs, at delivery time, and is not part of Slice A.
 */
import type { AdvisorRefusalCode, AdvisorTonePreface, MangmeeConversationMode, PreparedAdvisorAnswer } from './line-ai.js';
import { ADVISOR_REFUSAL_CODES, ADVISOR_TONE_PREFACES, MANGMEE_CONVERSATION_MODES } from './line-ai.js';

/** Version 1 wrapper bounds (spec §9), concrete so every receiver enforces the same limits. */
export const LINE_AI_ADVISOR_ANSWER_BOUNDS = {
  version: 1,
  /** Encoded wrapper ceiling. Far below the prepared plan's 32KB: this envelope is deliberately
   *  minimal (route fields + answer), with no tool catalog and no proposed calls. */
  maxEncodedBytes: 8 * 1024,
  /** Model-written prose ceiling. A hard upper bound only — the per-lane budget (spec §12: social is
   *  1–3 sentences) is a delivery-time gate, not a parse-time one. */
  maxAnswerTextBytes: 2000,
  /** One short clarifying question, same ceiling the intake router already uses for its own. */
  maxQuestionBytes: 500,
  /** Longest bounded id/label (card id, profile field name, response family id). */
  maxLabelBytes: 200,
  /** Cards may be cited and profile fields may be named only in small, bounded numbers. */
  maxArrayItems: 10,
} as const;

/**
 * Versioned veto-only floor (spec §9.1). A prepared answer below it can never be delivered directly;
 * a value at or above it makes nothing eligible that was not already eligible, and it never replaces
 * the existing 0.60 action/clarification guard. Calibrate with provider replay before any rollout.
 */
export const ADVISOR_DIRECT_ANSWER_MIN_CONFIDENCE = 0.8;

const MODES = new Set<MangmeeConversationMode>(MANGMEE_CONVERSATION_MODES);
const TONE_PREFACES = new Set<AdvisorTonePreface>(ADVISOR_TONE_PREFACES);
const REFUSAL_CODES = new Set<AdvisorRefusalCode>(ADVISOR_REFUSAL_CODES);

/**
 * The advisor answer is a CLOSED flat shape, so the key check is an allowlist rather than a
 * denylist: any other own key REJECTS the whole answer instead of being silently stripped. That is
 * what keeps a forged `advisorContext`/`offeredCards`/`profileLoaded` (SERVER-derived provenance),
 * an outer-route/permission/scope field, or a `__proto__`/`constructor` pollution key from ever
 * riding along — the attempt fails visibly and the turn falls back.
 */
const ALLOWED_ADVISOR_KEYS: ReadonlySet<string> = new Set([
  'version', 'mode', 'confidence', 'needsTools', 'knowledgeCardIds', 'companyProfileFieldsUsed',
  'responseFamilyId', 'answerText', 'tonePreface', 'clarificationQuestion', 'refusalCode',
]);

/** Model prose may never carry a raw URL or hand-built Flex/JSON (spec §9/§12): citations are server
 *  rendered from the registry, so anything link- or markup-shaped is a contract violation, not text
 *  to sanitise. Anchored on the trimmed value; matching REJECTS the whole answer. */
const RAW_LINK_OR_MARKUP = /(^[[{])|(\bhttps?:\/\/)|(\bwww\.)|(<\/?[a-z])/i;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Type-guarding allowed-set membership: narrows an untrusted value to the set's member type. */
function inSet<T extends string>(set: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === 'string' && (set as ReadonlySet<string>).has(value);
}

/** A bounded non-empty label (id / field name). Returned trimmed by the caller, never rebuilt. */
function isBoundedLabel(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && byteLength(value) <= LINE_AI_ADVISOR_ANSWER_BOUNDS.maxLabelBytes;
}

/** Bounded array of bounded labels, rebuilt fresh so a later mutation of the wire value cannot reach
 *  the parsed contract. `undefined` means "cited nothing" — the narrowest possible claim — so the
 *  minimal social envelope may omit both id arrays without paying output tokens for two empty lists. */
function parseLabelArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > LINE_AI_ADVISOR_ANSWER_BOUNDS.maxArrayItems) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (!isBoundedLabel(item)) return undefined;
    out.push(item.trim());
  }
  return out;
}

/** Returned when an untrusted value violates a v1 bound (distinct from a legitimately absent field). */
const INVALID = Symbol('invalid-advisor-field');

/** Bounded model-written prose: non-empty, within its byte cap, and free of raw links/markup.
 *  `undefined` = the field was legitimately absent; `INVALID` = the whole answer must be dropped. */
function parseProse(value: unknown, maxBytes: number): string | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return INVALID;
  const trimmed = value.trim();
  if (!trimmed || byteLength(trimmed) > maxBytes) return INVALID;
  if (RAW_LINK_OR_MARKUP.test(trimmed)) return INVALID;
  return trimmed;
}

/**
 * Parse and bound an untrusted prepared advisor answer. Returns the rebuilt answer when every v1
 * bound holds, or `undefined` on any failure (absent/unknown field, oversize, bad shape, unknown
 * enum, out-of-range confidence, raw URL/markup, prototype or provenance injection) so the caller
 * falls back to the existing full path.
 */
export function parseLineAiPreparedAdvisorAnswer(raw: unknown): PreparedAdvisorAnswer | undefined {
  if (!isPlainObject(raw)) return undefined;

  let encoded: string;
  try {
    encoded = JSON.stringify(raw);
  } catch {
    return undefined; // circular or otherwise non-serialisable
  }
  if (!encoded || byteLength(encoded) > LINE_AI_ADVISOR_ANSWER_BOUNDS.maxEncodedBytes) return undefined;

  // Own keys only: anything reachable through the prototype chain is not part of the wire value.
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_ADVISOR_KEYS.has(key)) return undefined;
  }

  if (raw['version'] !== LINE_AI_ADVISOR_ANSWER_BOUNDS.version) return undefined;
  const mode = raw['mode'];
  if (!inSet(MODES, mode)) return undefined;

  const confidence = raw['confidence'];
  // Bounded to [0,1]; never recomputed and never used to GRANT authority (spec §9.1: veto-only).
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return undefined;
  }

  // Required: an omitted or non-boolean value is invalid output, not a guess to repair. A turn that
  // needs tools can never be a direct answer, so this field is load-bearing for every later gate.
  const needsTools = raw['needsTools'];
  if (typeof needsTools !== 'boolean') return undefined;

  const knowledgeCardIds = parseLabelArray(raw['knowledgeCardIds']);
  if (!knowledgeCardIds) return undefined;
  const companyProfileFieldsUsed = parseLabelArray(raw['companyProfileFieldsUsed']);
  if (!companyProfileFieldsUsed) return undefined;

  const answerText = parseProse(raw['answerText'], LINE_AI_ADVISOR_ANSWER_BOUNDS.maxAnswerTextBytes);
  if (answerText === INVALID) return undefined;
  const clarificationQuestion = parseProse(raw['clarificationQuestion'], LINE_AI_ADVISOR_ANSWER_BOUNDS.maxQuestionBytes);
  if (clarificationQuestion === INVALID) return undefined;

  const rawFamily = raw['responseFamilyId'];
  let responseFamilyId: string | undefined;
  if (rawFamily !== undefined && rawFamily !== null) {
    if (!isBoundedLabel(rawFamily)) return undefined;
    responseFamilyId = rawFamily.trim();
  }

  const rawTone = raw['tonePreface'];
  let tonePreface: AdvisorTonePreface | undefined;
  if (rawTone !== undefined && rawTone !== null) {
    if (!inSet(TONE_PREFACES, rawTone)) return undefined;
    tonePreface = rawTone;
  }

  const rawRefusal = raw['refusalCode'];
  let refusalCode: AdvisorRefusalCode | undefined;
  if (rawRefusal !== undefined && rawRefusal !== null) {
    if (!inSet(REFUSAL_CODES, rawRefusal)) return undefined;
    refusalCode = rawRefusal;
  }

  return {
    version: 1,
    mode,
    confidence,
    needsTools,
    knowledgeCardIds,
    companyProfileFieldsUsed,
    ...(responseFamilyId !== undefined ? { responseFamilyId } : {}),
    ...(answerText !== undefined ? { answerText } : {}),
    ...(tonePreface !== undefined ? { tonePreface } : {}),
    ...(clarificationQuestion !== undefined ? { clarificationQuestion } : {}),
    ...(refusalCode !== undefined ? { refusalCode } : {}),
  };
}
