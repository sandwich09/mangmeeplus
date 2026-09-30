import { LINE_AI_VALUE_CANDIDATES_V2_LIMITS, extractValueCandidates, isAmbiguousDateCandidate, isAmbiguousPeriodCandidate, resolvePeriodCandidates } from '@watchdog-bms/contracts';
import type { LineAiConversationContext, LineAiInputEvidenceV2, LineAiSourceRefV2, LineAiValueCandidates, ToolMeta } from '@watchdog-bms/contracts';

export type ConversationReadCandidates = {
  turns: Array<{ at: string; todayIso: string; dates: LineAiValueCandidates['dates']; periods: NonNullable<LineAiValueCandidates['periods']> }>;
  candidates: LineAiValueCandidates;
};

function currentScopeBlocksHistory(candidates?: LineAiValueCandidates): boolean {
  return !!candidates && (('completeness' in candidates && candidates.completeness === 'overflow')
    || candidates.dates.length > 0 || (candidates.periods?.length ?? 0) > 0);
}

export function conversationReadCandidates(
  context?: LineAiConversationContext,
  current?: LineAiValueCandidates,
): ConversationReadCandidates | undefined {
  if (!context || currentScopeBlocksHistory(current)) return undefined;
  const turns: ConversationReadCandidates['turns'] = [];
  for (const turn of context.recentTurns) {
    if (turn.userMessagePreviewComplete !== true || !turn.userMessagePreview) continue;
    const at = new Date(turn.at);
    if (!Number.isFinite(at.getTime())) continue;
    const todayIso = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    if (new TextEncoder().encode(turn.userMessagePreview).length > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.utf8Bytes) continue;
    const extracted = extractValueCandidates(turn.userMessagePreview, todayIso, { scan: {
      observe() {}, datePositions: new WeakMap(),
    } });
    if (extracted.dates.length > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.dates
      || (extracted.periods?.length ?? 0) > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.periods) continue;
    const dates = extracted.dates.filter(candidate => !isAmbiguousDateCandidate(candidate));
    const periods = (extracted.periods ?? []).filter(candidate => !isAmbiguousPeriodCandidate(candidate));
    if (dates.length || periods.length) turns.push({ at: turn.at, todayIso, dates, periods });
  }
  if (!turns.length) return undefined;
  const dates = [...new Map(turns.flatMap(turn => turn.dates).map(date => [date.isoDate, date])).values()];
  const periods = [...new Map(turns.flatMap(turn => turn.periods)
    .map(period => [`${period.fromDate}:${period.toDate}:${period.monthKey ?? ''}`, period])).values()];
  return { turns, candidates: { amounts: [], dates, periods } };
}

/** NFC + lowercase + collapsed-whitespace, so spacing/case/composed-character differences between
 *  what the model echoes and what the user actually typed never cause a false grounding mismatch. */
function normalizeForNameGrounding(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Spec item 2(b): a categoryName/vendorName the model sends as a tool filter is only trustworthy when
 * the user actually typed it this turn — otherwise the model can invent a plausible-looking name and
 * the tool would silently filter (or mis-resolve) by something nobody asked for. `name` must appear as
 * a substring of `messageText` after normalization.
 *
 * P3 hook: this only grounds against the CURRENT message. `conversationReadCandidates` above is where
 * recent-turn text would be pulled in to also ground a name the user typed earlier in the conversation
 * — pass its turns' `userMessagePreview` text through this same normalize-and-include check.
 */
export function nameFilterGroundedInText(name: string, messageText: string): boolean {
  const needle = normalizeForNameGrounding(name);
  return needle.length > 0 && normalizeForNameGrounding(messageText).includes(needle);
}

/** Item 1 (223-turn eval batch 2, T-001#0): "จ่ายไป/ใช้ไป/ใช้จ่ายไป/เสียไปเท่าไหร่" is a plain TOTAL
 *  spending question — it contains the verb "จ่าย" but names no payment STATE, so it must carry no
 *  paymentStatus filter at all. A paymentStatus value is grounded only by an explicit contrast:
 *  PAID needs "จ่ายแล้ว/ชำระแล้ว/จ่ายจริง"; UNPAID needs "ยังไม่จ่าย/ค้างจ่าย/ยังไม่ชำระ". The generic
 *  enum-membership check (any listed value is "grounded") cannot tell these apart — both are valid
 *  enum members — so paymentStatus needs this word-level check instead. PARTIALLY_PAID/VOIDED are
 *  outside this eval's scope and keep using the ordinary enum-membership check. */
const PAYMENT_STATE_WORDS: Partial<Record<string, RegExp>> = {
  PAID: /จ่ายแล้ว|ชำระแล้ว|จ่ายจริง|\bpaid\b/iu,
  UNPAID: /ยังไม่จ่าย|ค้างจ่าย|ยังไม่ชำระ|\bunpaid\b|\bnot\s+paid\b/iu,
};

export function paymentStatusGroundedInText(value: string, messageText: string): boolean {
  const pattern = PAYMENT_STATE_WORDS[value];
  return !pattern || pattern.test(messageText);
}

/** Item 3 root cause: despite the router prompt explicitly forbidding it ("never invent aliases such
 *  as this_month"), the real model sometimes sends a `periodKey` of a well-known relative-month word
 *  instead of the tool's actual `YYYY-MM` key — e.g. `{"periodKey":"this_month"}` for "เดือนนิจ่ายไป
 *  เทาไหร่แล้วค้า" (eval T-009-a). That value never matches any extracted candidate (least of all when
 *  the message also typos the Thai word, so no candidate was extracted at all) and used to dead-end
 *  the whole call as `TOOL_INPUT_NOT_AUTHORIZED`. Each alias below names an exact calendar month
 *  computable from `todayIso` alone — exactly as deterministic as the candidate the extractor would
 *  have produced had the message spelled the Thai phrase correctly — so resolving it is not
 *  "inventing" a period. Bounded to month-shaped aliases only: a `periodKey` field is only ever a
 *  calendar month (`LineAiPeriodCandidate.monthKey`); "today"/"this_week" are expressed via
 *  fromDate/toDate instead and are not this field's concern. */
const PERIOD_KEY_ALIASES: Record<string, string> = {
  this_month: 'เดือนนี้', current_month: 'เดือนนี้', this_month_to_date: 'เดือนนี้',
  last_month: 'เดือนที่แล้ว', previous_month: 'เดือนที่แล้ว',
};

export function resolvePeriodKeyAlias(periodKey: string, todayIso: string | undefined): string | undefined {
  const phrase = PERIOD_KEY_ALIASES[periodKey];
  if (!phrase || !todayIso) return undefined;
  return resolvePeriodCandidates(phrase, todayIso).find(candidate => candidate.kind === 'month')?.monthKey;
}

export function canonicalizeReadToolEnums(
  meta: Pick<ToolMeta, 'inputEnumValues'>,
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const canonical = { ...raw };
  for (const [key, values] of Object.entries(meta.inputEnumValues ?? {})) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== 'string') return undefined;
    const matches = values.filter(candidate => candidate.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US'));
    if (matches.length !== 1) return undefined;
    canonical[key] = matches[0];
  }
  return canonical;
}

/** Item 1 (spec §2/§3 row 17): the exact customer words a semantic subrequest's evidenceRefs quote
 *  out of the current inputEvidence — the same provenance runSemanticTurnV2 already trusts for
 *  numeric grounding, reused here so a scope-policy check is grounded in what the customer actually
 *  typed for THIS clause, not the model's paraphrase or an unrelated clause in the same message.
 *  Falls back to the whole message when no evidence is available (older/simple callers). */
export function evidenceRefsText(
  evidenceRefs: readonly LineAiSourceRefV2[] | undefined,
  inputEvidence: LineAiInputEvidenceV2 | undefined,
  fallback: string,
): string {
  if (!evidenceRefs?.length || !inputEvidence) return fallback;
  const quoted = evidenceRefs
    .map(ref => inputEvidence.parts.find(part => part.partId === ref.partId)?.rawText.slice(ref.startUtf16, ref.endUtf16) ?? '')
    .filter(Boolean)
    .join(' ');
  return quoted || fallback;
}

/** Item 4 (spec row 3, eval T-093-b): "ใบเบิก"/"เบิกเงิน"/"ขอเบิก" name the reimbursement CLAIM, a
 *  different record than the expense ledger — expense.list_recent/get_breakdown must never answer
 *  it (e.g. a paymentStatus on the expense ledger is not the claim's own approve/pay status). A
 *  message that separately names the expense ledger itself ("ค่าใช้จ่าย"/"รายจ่าย") is unaffected. */
const REIMBURSEMENT_STATUS_WORDS_TH = ['ใบเบิก', 'เบิกเงิน', 'ขอเบิก'];
const EXPENSE_LEDGER_WORDS_TH = ['ค่าใช้จ่าย', 'รายจ่าย'];

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some(needle => text.includes(needle));
}

export function reimbursementStatusQuestion(text: string): boolean {
  return includesAny(text, REIMBURSEMENT_STATUS_WORDS_TH) && !includesAny(text, EXPENSE_LEDGER_WORDS_TH);
}

/** Advisor Q2 (owner 2026-09-30): "มีอะไรค้างที่ฉันต้องทำ", "งานค้างของฉัน" ask for the caller's OWN pending
 *  work across queues — never Q1's one-day checklist ("วันนี้มีอะไรต้องทำ"), which stays on its fast lane. A
 *  message naming one document ("ใบเบิกของฉันค้างที่ใคร", "ค้างจ่าย") asks about that document instead. */
const MY_PENDING_WORK_PATTERN = /งานค้าง|(?:อะไร|งาน)[^\n]{0,12}(?:ค้าง|รอ)[^\n]{0,12}(?:ฉัน|ผม|หนู|ดิฉัน)|(?:ฉัน|ผม|หนู|ดิฉัน)[^\n]{0,12}ค้าง/u;
const NAMED_DOCUMENT_WORDS_TH = ['ใบเบิก', 'เบิก', 'ค่าใช้จ่าย', 'รายจ่าย', 'ใบรับรอง', 'ใบแทน', 'บิล', 'ใบเสร็จ', 'จ่าย', 'ชำระ'];

export function myPendingWorkQuestion(text: string): boolean {
  return MY_PENDING_WORK_PATTERN.test(text) && !includesAny(text, NAMED_DOCUMENT_WORDS_TH);
}

/** Item 4 (spec row 14, eval T-107-b): line.explain_file_attempt explains a file/photo the customer
 *  says was sent in THIS chat. A "ทำไม"/category/spending question that names no file/photo/document
 *  at all has nothing to do with an upload attempt and must never route there. */
const FILE_REFERENCE_WORDS_TH = ['ไฟล์', 'รูป', 'เอกสาร', 'สลิป', 'ใบเสร็จ'];
const FILE_REFERENCE_WORDS_EN = ['file', 'photo', 'image', 'document', 'pdf', 'slip'];

export function fileAttemptReferenceGrounded(text: string): boolean {
  return includesAny(text, FILE_REFERENCE_WORDS_TH) || includesAny(text.toLocaleLowerCase('en-US'), FILE_REFERENCE_WORDS_EN);
}

/** Item 4: the one guard shared by the prepared-simple fast lane (`preparedSimplePreCallCheck`) and
 *  the classic per-turn tool loop (`runSemanticTurnV2`) — a proposed tool that this clause's own
 *  quoted text rules out, regardless of which lane picked it. */
export function misroutedReadTool(toolName: string, text: string): boolean {
  if (toolName === 'line.explain_file_attempt') return !fileAttemptReferenceGrounded(text);
  if (toolName === 'expense.list_recent' || toolName === 'expense.get_breakdown') return reimbursementStatusQuestion(text);
  return false;
}
