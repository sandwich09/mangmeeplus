/**
 * Declared per-step execution bounds for the SPLIT budget envelope (remediation spec §12.3,
 * ADR 0013 §3/§6). This table is DATA, reviewed like code: it is the only thing that decides how
 * much money a provider invocation may hold, and in Phase E1c it is also what the AI Gateway
 * enforces before it calls a provider (request size, `maxTokens`, model id, SDK attempts).
 *
 * A step kind that is not in this table can never be reserved, so a SPLIT company simply cannot
 * reach a seam whose bound nobody declared: admission answers `AI_BUDGET_UNAVAILABLE` instead of
 * running an unmetered provider call. That is the readiness property of ADR 0013 §9.
 *
 * Research + derivation: `docs/research/ai-budget-step-bounds-2026-09-17.md`.
 */

/**
 * One step kind per provider CHAIN, not per provider call. `maxCalls` is the chain's declared
 * ceiling and the ordinal inside `invocationKey` is the call index within it, so the API can bound
 * a multi-call route (`0 <= ordinal < maxCalls`) without knowing which sub-step the gateway is on.
 * `maxOutputTokens` is therefore the MAXIMUM `maxTokens` across every call the chain can make.
 */
export type AiBudgetStepKind =
  /** `/internal/ai/line-intake-route` with no image attachment. */
  | 'line-intake-text'
  /** `/internal/ai/line-intake-route` carrying a JPEG/PNG — one call routes AND transcribes. */
  | 'line-intake-image'
  /** `/internal/ai/line-turn`: plan-route, the tool loop, the critic, compose/casual and polish. */
  | 'line-turn'
  /** `/internal/ai/receipt-ocr`: read, extract, extract-repair and the vision re-read. */
  | 'receipt-ocr'
  /** `/internal/ai/bank-statement-extract`: read, then the extraction call. */
  | 'bank-statement'
  | 'crm-summary'
  | 'crm-reply-draft'
  | 'crm-intake'
  | 'crm-customer-profile-extract'
  | 'crm-booking-extract'
  | 'crm-insights'
  | 'crm-broadcast'
  | 'crm-trust-score'
  /** `/internal/ai/draft-generate`. */
  | 'draft-generate';

export type AiBudgetStepBounds = {
  /**
   * Declared input ceiling for ONE invocation, including cache writes and any image/document
   * tokens. E1c refuses a request above it rather than exceeding the money that was reserved;
   * a UTF-8 byte length is a safe upper bound for the token count of the text part.
   */
  maxInputTokens: number;
  /** MUST equal the largest `maxTokens` the gateway really passes for this chain today. */
  maxOutputTokens: number;
  /** Provider calls this chain may make in total. Attempts inside one call are pinned to 1. */
  maxCalls: number;
};

/** Per-image token ceiling folded into the image/document step bounds below (research doc §3). */
export const AI_BUDGET_IMAGE_TOKEN_CEILING = 2_000;
/** Per-PDF-page token ceiling; the declared document bounds admit at most 8 pages (research doc §3). */
export const AI_BUDGET_DOCUMENT_PAGE_TOKEN_CEILING = 3_000;

export const AI_BUDGET_STEP_BOUNDS: Readonly<Record<AiBudgetStepKind, AiBudgetStepBounds>> = {
  // 1,500 = the fused-plan branch of `intent-router.agent.ts:423` (the plain branch is 1,000).
  'line-intake-text': { maxInputTokens: 20_000, maxOutputTokens: 1_500, maxCalls: 1 },
  // 8,000 = INTAKE_DOCUMENT_MAX_TOKENS (`intent-router.agent.ts:32`, used at `:423`).
  'line-intake-image': { maxInputTokens: 30_000, maxOutputTokens: 8_000, maxCalls: 1 },
  // 1,024 = the native tool loop (`orchestrator.agent.ts:974`); plan-route 500, chooseNextTool 300,
  // critic 500, casual 180, compose 600 and polish 500 are all below it. 16 = the worst-case chain
  // (AI_MAX_TOOL_CALLS hard max 8 loop turns + final + resume, 2 plan-route attempts, 2 critics,
  // compose and polish) — see the research doc for the arithmetic.
  'line-turn': { maxInputTokens: 40_000, maxOutputTokens: 1_024, maxCalls: 16 },
  // 8,192 = RECEIPT_EXTRACTION_MAX_TOKENS (`line-ai-internal.controller.ts:40`, used at `:322`);
  // the read and the vision re-read pass 4,096. maxCalls = AI_RECEIPT_OCR_MAX_PROVIDER_CALLS.
  'receipt-ocr': { maxInputTokens: 30_000, maxOutputTokens: 8_192, maxCalls: 4 },
  // 4,096 = the shared document read (`line-ai-internal.controller.ts:294`); stage 2 passes 4,000.
  // maxCalls = AI_BANK_STATEMENT_MAX_PROVIDER_CALLS.
  'bank-statement': { maxInputTokens: 30_000, maxOutputTokens: 4_096, maxCalls: 2 },
  'crm-summary': { maxInputTokens: 20_000, maxOutputTokens: 1_600, maxCalls: 1 },
  'crm-reply-draft': { maxInputTokens: 20_000, maxOutputTokens: 500, maxCalls: 1 },
  'crm-intake': { maxInputTokens: 20_000, maxOutputTokens: 200, maxCalls: 1 },
  'crm-customer-profile-extract': { maxInputTokens: 20_000, maxOutputTokens: 350, maxCalls: 1 },
  'crm-booking-extract': { maxInputTokens: 20_000, maxOutputTokens: 300, maxCalls: 1 },
  'crm-insights': { maxInputTokens: 20_000, maxOutputTokens: 600, maxCalls: 1 },
  'crm-broadcast': { maxInputTokens: 20_000, maxOutputTokens: 1_200, maxCalls: 1 },
  'crm-trust-score': { maxInputTokens: 20_000, maxOutputTokens: 200, maxCalls: 1 },
  'draft-generate': { maxInputTokens: 20_000, maxOutputTokens: 900, maxCalls: 1 },
};

/** The one membership test. An unknown step kind is never defaulted — it refuses. */
export function aiBudgetStepBounds(stepKind: string): AiBudgetStepBounds | undefined {
  return Object.hasOwn(AI_BUDGET_STEP_BOUNDS, stepKind)
    ? AI_BUDGET_STEP_BOUNDS[stepKind as AiBudgetStepKind]
    : undefined;
}

/**
 * What the API puts on an internal gateway request as `budgetEnvelope` (ADR 0013 §6). Optional on
 * the wire: an older gateway ignores the unknown field, and until E1c nothing enforces it.
 */
export type AiBudgetEnvelope = {
  attemptKey: string;
  stepKind: AiBudgetStepKind;
  invocationKey: string;
  bucket: 'CHAT' | 'OCR';
  /** Pinned Bangkok month; every further step of this attempt settles into it. */
  monthKey: string;
  modelId: string;
  bounds: AiBudgetStepBounds;
  maxCalls: number;
};

/** `<attemptKey>#<stepKind>#<ordinal>` — the ONE identity money is charged against (ADR 0013 §4). */
export function aiBudgetInvocationKey(attemptKey: string, stepKind: string, ordinal: number): string {
  return `${attemptKey}#${stepKind}#${ordinal}`;
}
