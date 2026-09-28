/**
 * Phase-4 prepared simple-read ELIGIBILITY (latency/autonomy §6.2, plan Phase 4).
 *
 * Pure, server-derived gate: given an already-bounded `LineAiPreparedPlan` (from
 * `parseLineAiPreparedPlan`) plus the live turn context, decide whether the turn may take the
 * one-call prepared simple-read lane. It grants NO authority — confidence is veto-only, `answerShape`
 * is untrusted advice used only to pick an allow-listed deterministic formatter family, and every
 * verified invariant (registry, subject, permission, entitlement, formatter family) is re-derived
 * here. Any failure returns `{ eligible: false }`; the caller then runs the full agentic fallback with
 * its original non-narrowed delegation. This file adds no execution — it only classifies.
 */
import { LINE_TOOL_REGISTRY, hasToolFeature, hasToolPermissions } from '@watchdog-bms/contracts';
import type { LineAiPreparedCall, LineAiPreparedPlan, ToolMeta } from '@watchdog-bms/contracts';

/** Read families a simple read may format deterministically; a capture/mutation tool is never simple. */
const SIMPLE_READ_CATEGORIES = new Set<ToolMeta['category']>(['read_summary', 'read_detail', 'report']);
// tuning-5b (B3a): mirrors the same floor in line-intake-compact-decision.ts's simpleReadPlan, which
// builds the plan this function re-verifies at the orchestrator's pre-call check
// (preparedSimplePreCallCheck, called from both intent-router.agent.ts's routeIntake and
// OrchestratorAgent.run). Moved 0.85 -> 0.75 together with that file — leaving one of the two floors
// at 0.85 would silently re-reject every 0.75-0.85 plan the decoder now allows through. Run 4: 17
// simple reads at 0.82 and 9 at 0.78 fell to the slow path, e.g. "มีร่างค้างอยู่ไหมคะ".
const CONFIDENCE_VETO_FLOOR = 0.75;

const TOOL_BY_NAME = new Map(LINE_TOOL_REGISTRY.map((tool) => [tool.name, tool] as const));

/** Compiled-formatter family key: `${toolName}::${answerShape}`. A read is eligible only when its
 *  exact tool+shape has a verified deterministic formatter AND the operator allowlist enables it. */
export function preparedFamilyKey(toolName: string, answerShape: string): string {
  return `${toolName}::${answerShape}`;
}

export type PreparedSimpleReadContext = {
  /** TRUSTED outer intake provenance from `LineAiTurnRequest.intakeIntent` (API-bound + re-validated at
   *  every receiver) — NEVER the untrusted wrapper. A simple read requires exactly BUSINESS_READ_QUESTION. */
  intakeIntent: string | undefined;
  permissions: readonly string[];
  /** Company feature entitlements: a Set = exact set, `null`/`undefined` = legacy fail-open. */
  entitledFeatures: Set<string> | null | undefined;
  hasAttachment: boolean;
  hasOpenClarification: boolean;
  /** Active compiled families = the compiled formatter registry NARROWED by the operator allowlist.
   *  Empty (default) → no simple read is eligible; a key here can only NARROW, never invent a family. */
  enabledFamilies: ReadonlySet<string>;
};

export type PreparedSimpleReadEligibility =
  | { eligible: true; call: LineAiPreparedCall; tool: ToolMeta; answerShape: 'single_metric' | 'list' }
  | { eligible: false; reason: string };

const ineligible = (reason: string): PreparedSimpleReadEligibility => ({ eligible: false, reason });

/** Subject ↔ tool compatibility straight from the registry (same rule the intent router uses). */
function isSubjectCompatible(subject: string, toolName: string): boolean {
  return TOOL_BY_NAME.get(toolName)?.businessSubjects.includes(subject as ToolMeta['businessSubjects'][number]) ?? false;
}

/**
 * Decide simple-read eligibility from verified invariants only. Ordered cheap→expensive; every branch
 * is a hard requirement, so a forged/invalid/state-changed plan drops to `{ eligible: false }`.
 */
export function preparedSimpleReadEligibility(
  plan: LineAiPreparedPlan,
  ctx: PreparedSimpleReadContext,
): PreparedSimpleReadEligibility {
  // Trusted request-level provenance (API-bound from the outer route, re-validated at every receiver);
  // NEVER read from the untrusted `plan` wrapper, and never hardcoded.
  if (ctx.intakeIntent !== 'BUSINESS_READ_QUESTION') return ineligible('intake_intent_not_business_read');
  if (plan.complexity !== 'simple') return ineligible('not_simple');
  // Confidence veto only — never grants authority, never recomputed; below the floor forces fallback.
  if (!(plan.confidence >= CONFIDENCE_VETO_FLOOR)) return ineligible('confidence_below_floor');

  const intentPlan = plan.intentPlan;
  if (intentPlan.status !== 'ROUTABLE') return ineligible('plan_not_routable');
  if (intentPlan.requiresHumanReview) return ineligible('human_review_required');
  if (intentPlan.refusals.length !== 0) return ineligible('plan_has_refusal');
  if (intentPlan.intents.length !== 1) return ineligible('not_exactly_one_intent');
  if (plan.proposedCalls.length !== 1) return ineligible('not_exactly_one_call');

  const intent = intentPlan.intents[0];
  if (intent.missingContext.length !== 0) return ineligible('missing_context');
  if (ctx.hasAttachment) return ineligible('attachment_present');
  if (ctx.hasOpenClarification) return ineligible('open_clarification');

  // Exact requiredTools equality: one required tool == the one proposed call.
  const call = plan.proposedCalls[0];
  if (intent.requiredTools.length !== 1 || intent.requiredTools[0] !== call.toolName) return ineligible('tool_not_equal_required');

  const tool = TOOL_BY_NAME.get(call.toolName);
  if (!tool) return ineligible('tool_not_registered');
  if (!SIMPLE_READ_CATEGORIES.has(tool.category)) return ineligible('tool_not_read_family');
  if (!isSubjectCompatible(intent.subject, tool.name)) return ineligible('subject_incompatible');
  if (!hasToolPermissions(tool, ctx.permissions)) return ineligible('permission_denied');
  // `undefined` = a legacy caller with no entitlement info → fail-open, the repo-wide convention
  // (`hasToolFeature` itself only accepts Set|null, so the caller short-circuits undefined).
  if (ctx.entitledFeatures !== undefined && !hasToolFeature(tool, ctx.entitledFeatures)) return ineligible('feature_disabled');

  // Verified formatter family: `answerShape` (untrusted advice) must be a read shape a deterministic
  // formatter can serve, and the exact tool+shape must be an ACTIVE compiled family (compiled registry
  // narrowed by the operator allowlist). Empty set (default) → no simple read is eligible; advice can
  // only RESTRICT here, never grant or invent a family.
  const answerShape = plan.answerShape;
  if (answerShape !== 'single_metric' && answerShape !== 'list') return ineligible('no_simple_answer_shape');
  if (!ctx.enabledFamilies.has(preparedFamilyKey(tool.name, answerShape))) return ineligible('formatter_family_not_allowed');

  return { eligible: true, call, tool, answerShape };
}
