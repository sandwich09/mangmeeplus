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

/** Persona veto (spec §9.2; UAT 2026-09-06 delivered "สวัสดีครับ! หนูคือ AI Assistant ของ MangmeePlus …"
 *  straight to the customer). The router prompt now carries the persona, but prompt wording is not a
 *  trust boundary: a male particle, the assistant's own ผม, or a wrong self-name declines the shortcut
 *  and the composer turn (which owns the persona) answers instead. Never repaired. */
const MALE_PARTICLE = /ครับ/u;
/** ผม/ดิฉัน as HER pronoun. Thai writes no word spaces ("วันนี้ผม…", "แต่ผม…"), so ผม is caught anywhere
 *  EXCEPT a user's quoted «ผม…» and hair, where the neighbouring word settles it (ตัดผม, ทรงผม, ผมสั้น, ผมร่วง). */
const OWN_PRONOUN_PHOM = /(?<!«|ตัด|ทรง|เส้น|สระ|ย้อม|ดัด|ยืด|หวี|เซ็ต|ทำ|มัด|ถัก|รวบ|เกล้า|ไว้|ปลูก|ปลาย|โคน|ราก|สี|แต่ง|ขน)ผม(?!สั้น|ยาว|ร่วง|หงอก|เผ้า|บาง|ดก|สวย|เสีย|แห้ง|มัน|หยิก|ตรง|ดำ|ขาว|ทอง|สี|ทรง)|(?<!«)ดิฉัน/u;
/** Owner 2026-09-06: she is น้องมั่งมี, never หนู — line-initial or after whitespace with a self-predicate
 *  (หนู is also "you" to a junior and a mouse), so a quoted «หนู…» stays deliverable. */
const OWN_PRONOUN_NU = /^หนู|\sหนู(?:คือ|ชื่อ|เป็น|ยินดี|พร้อม|เอง|ขอ|จะ|ช่วย)/mu;
/** A product-bot label, a vendor, or "language model" is a wrong self-name whatever the particle. */
const WRONG_SELF_NAME = /AI Assistant|WatchDog|Mangmee ?Plus AI|AI ของ Mangmee ?Plus|Claude|Anthropic|OpenAI|ChatGPT|Bedrock|language model|โมเดลภาษา/iu;
/** Owner 2026-09-06: a robot icon is never her (the UAT draft signed off with one). */
const ROBOT_ICON = /🤖/u;
/** A social answer is 1–3 sentences (spec §12). A list or numbered steps is a tutorial, which the
 *  permission-scoped walkthrough lane owns — never a model-written one from here. */
const LIST_SHAPE = /(?:^|\s)(?:[•▪‣]|\d{1,2}[.)])\s+\S/u;

function looksLikeTutorial(text: string): boolean {
  return (text.match(/\n/g)?.length ?? 0) >= 2 || LIST_SHAPE.test(text);
}

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
  if (MALE_PARTICLE.test(text) || OWN_PRONOUN_PHOM.test(text) || OWN_PRONOUN_NU.test(text) || WRONG_SELF_NAME.test(text) || ROBOT_ICON.test(text)) return null;
  if (looksLikeTutorial(text)) return null;
  return text;
}
