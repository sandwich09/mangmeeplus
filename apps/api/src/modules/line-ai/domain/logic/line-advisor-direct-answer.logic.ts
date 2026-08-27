/**
 * Slice A delivery-time eligibility for the prepared advisor answer (advisor spec §9.1 row 7,
 * §9.2). The contracts parser bounds SHAPE; this gate decides DELIVERY, and it is deliberately
 * narrower than the wire contract: Slice A ships SOCIAL_CHAT only — no knowledge cards, no
 * company profile, no clarification hand-off — so every other well-formed answer falls back to
 * the full gateway turn (which receives intakeIntent='ADVISOR_CONVERSATION' and treats it like
 * UNSUPPORTED). Returning null NEVER fails the turn; it only declines the shortcut.
 */
import { ADVISOR_DIRECT_ANSWER_MIN_CONFIDENCE, parseLineAiPreparedAdvisorAnswer } from '@watchdog-bms/contracts';

export type AdvisorDirectAnswerContext = {
  /** LINE_AI_ADVISOR_MODE !== 'off' — server config, never wire data. */
  advisorEnabled: boolean;
  /** Outer plan re-validated by the API: status ROUTED and intent ADVISOR_CONVERSATION (§9.1). */
  routedAdvisor: boolean;
  hasAttachment: boolean;
  hasOpenClarifications: boolean;
  hasActiveExpenseDrafts: boolean;
  hasPendingMediaCapsule: boolean;
  hasSubstituteState: boolean;
};

/** A money figure needs grounding and social chat has no grounding source, so any baht amount
 *  vetoes the shortcut (spec §9.2 grounding row). Plain numbers ("เปิด 8 โมง", "24 ชม.", "555")
 *  stay conversational and are allowed. Thai digits included; the parser never maps them. */
const BAHT_AMOUNT = /[0-9๐-๙][0-9๐-๙,]*(?:\.[0-9๐-๙]+)?\s*(?:บาท|บ\.)|฿\s*[0-9๐-๙]/;

/**
 * Returns the reply text to deliver directly from the single intake call, or null to fall back to
 * the existing full path. Fail-closed on every gate; never repairs model output.
 */
export function advisorDirectAnswerText(rawAdvisorAnswer: unknown, ctx: AdvisorDirectAnswerContext): string | null {
  if (!ctx.advisorEnabled || !ctx.routedAdvisor) return null;
  // §9.1 rows 1–6: any open state or attachment means an existing route owns the turn.
  if (
    ctx.hasAttachment || ctx.hasOpenClarifications || ctx.hasActiveExpenseDrafts
    || ctx.hasPendingMediaCapsule || ctx.hasSubstituteState
  ) return null;

  const answer = parseLineAiPreparedAdvisorAnswer(rawAdvisorAnswer);
  if (!answer) return null;
  if (answer.mode !== 'SOCIAL_CHAT') return null; // Slice A: social lane only
  if (answer.needsTools) return null;
  if (answer.confidence < ADVISOR_DIRECT_ANSWER_MIN_CONFIDENCE) return null; // veto-only floor
  // Refusals and clarifications take the full path so their deterministic renderers stay the
  // single source of that copy; a social direct answer is an ANSWER or nothing.
  if (answer.refusalCode !== undefined || answer.clarificationQuestion !== undefined) return null;
  // Slice A cites nothing and reads nothing: cards/profile belong to later slices.
  if (answer.knowledgeCardIds.length > 0 || answer.companyProfileFieldsUsed.length > 0) return null;
  if (answer.responseFamilyId !== undefined) return null;

  const text = answer.answerText?.trim();
  if (!text) return null;
  if (BAHT_AMOUNT.test(text)) return null;
  return text;
}
