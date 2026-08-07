/**
 * CUST-02 — pure state machine for AI booking proposals (gap-closure plan C2).
 * No Nest / Prisma imports. Deterministic code owns transition eligibility; the
 * AI only proposes bounded candidates. The reply classifier below is a
 * fail-closed guardrail (it returns UNCLEAR whenever it cannot be certain), not
 * the semantic confirmation understanding — an availability question must never
 * be read as a confirmation.
 */

export type CrmBookingProposalStatus =
  | 'PROPOSED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'COMMITTING'
  | 'BOOKED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'CONFLICTED'
  | 'HANDED_TO_STAFF';

// Legal transition graph. Happy path:
//   PROPOSED -> AWAITING_CONFIRMATION -> CONFIRMED -> COMMITTING -> BOOKED
// A proposal may divert to a terminal at any pre-commit stage; slot loss is
// only discovered at commit time (CONFLICTED). Terminal states have no exits.
const TRANSITIONS: Record<CrmBookingProposalStatus, CrmBookingProposalStatus[]> = {
  PROPOSED: ['AWAITING_CONFIRMATION', 'CANCELLED', 'EXPIRED', 'HANDED_TO_STAFF'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'EXPIRED', 'HANDED_TO_STAFF'],
  CONFIRMED: ['COMMITTING', 'CANCELLED', 'HANDED_TO_STAFF'],
  COMMITTING: ['BOOKED', 'CONFLICTED', 'HANDED_TO_STAFF'],
  BOOKED: [],
  EXPIRED: [],
  CANCELLED: [],
  CONFLICTED: [],
  HANDED_TO_STAFF: [],
};

export function canTransition(from: CrmBookingProposalStatus, to: CrmBookingProposalStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: CrmBookingProposalStatus, to: CrmBookingProposalStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal_booking_proposal_transition:${from}->${to}`);
  }
}

/** A status with no legal outgoing transition (BOOKED and the four aborts). */
export function isTerminal(status: CrmBookingProposalStatus): boolean {
  return (TRANSITIONS[status] ?? []).length === 0;
}

/** A proposal whose expiry has passed and can still legally move to EXPIRED. */
export function isExpired(proposal: { status: CrmBookingProposalStatus; expiresAt: Date }, now: Date): boolean {
  // Only PROPOSED/AWAITING_CONFIRMATION have an EXPIRED edge; a CONFIRMED or
  // COMMITTING proposal is already progressing and never timer-expires.
  return canTransition(proposal.status, 'EXPIRED') && proposal.expiresAt.getTime() <= now.getTime();
}

// Distinctive Thai substrings (Thai has no word boundaries, so substring match
// is safe for these). Note ไม่ (negation, mai-ek) is deliberately distinct from
// the question particle ไหม, so "ว่างไหม" never matches cancel.
const CONFIRM_THAI = ['ยืนยัน', 'คอนเฟิร์ม', 'ตกลง', 'โอเค', 'ใช่'];
// STRONG cancel is explicit intent — it may cancel even wrapped in extra words.
// WEAK cancel is a bare negation particle that is a common substring of ordinary
// sentences (ไม่ / "no"): it may cancel ONLY when the message is a bare negation,
// otherwise "สวัสดี ไม่ทราบว่าราคาเท่าไหร่" / "no idea, what's the price?" would
// wrongly cancel a live booking proposal.
// "ไม่เอา" (don't want it) is unambiguous rejection — strong, like ยกเลิก. Bare
// "ไม่" alone is weak (a common substring of ordinary questions).
const CANCEL_STRONG_THAI = ['ยกเลิก', 'ไม่เอา'];
const CANCEL_WEAK_THAI = ['ไม่'];
// English tokens need word boundaries: "ok" is a substring of "booking".
const CONFIRM_EN = /\b(confirm(?:ed)?|cf|ok(?:ay)?|yes)\b/;
const CONFIRM_EN_G = /\b(confirm(?:ed)?|cf|ok(?:ay)?|yes)\b/g;
const CANCEL_STRONG_EN = /\bcancel(?:led)?\b/;
const CANCEL_WEAK_EN = /\bno\b/;
const CANCEL_WEAK_EN_G = /\bno\b/g;
// Polite particles / fillers that carry no booking meaning — a genuine
// confirmation may wrap the affirmative in these ("ยืนยันค่ะ", "โอเคเลย",
// "yes please"). Longer compounds first so they are erased before their parts.
const POLITE_FILLER_THAI = ['ครับผม', 'นะคะ', 'นะครับ', 'ค่ะ', 'คะ', 'ค่า', 'ครับ', 'คับ', 'ขา', 'นะ', 'น่ะ', 'จ้ะ', 'จ้า', 'จ๊ะ', 'ฮะ', 'เลย'];
const POLITE_FILLER_EN_G = /\b(please|pls|thanks?|thank you|you|na|krab|krub|ka|kub)\b/g;

/**
 * A message is a *bare* affirmative when, after erasing every affirmative token
 * and politeness/filler, nothing substantive remains. This is the fail-closed
 * core of CONFIRM: "ยืนยันค่ะ" reduces to empty (confirm), but "ตกลงกี่โมงคะ"
 * leaves "กี่โมง" and "can you confirm the time" leaves "can the time" — an
 * affirmative buried in an extra clause or a question never books.
 */
function isBareAffirmative(raw: string): boolean {
  let residual = raw.toLowerCase();
  for (const token of [...CONFIRM_THAI, ...POLITE_FILLER_THAI]) residual = residual.split(token).join(' ');
  residual = residual.replace(CONFIRM_EN_G, ' ').replace(POLITE_FILLER_EN_G, ' ');
  // Only whitespace and punctuation are harmless leftovers. Symbols/emoji are NOT
  // stripped: "โอเค❌", "yes 👎", "ตกลง🤔" carry negation or doubt and must fall
  // through to UNCLEAR rather than collapse to a bare affirmative.
  return residual.replace(/[\s\p{P}]+/gu, '').length === 0;
}

/**
 * A message is a *bare* cancel when, after erasing the weak negation token and
 * politeness/filler, nothing substantive remains — "ไม่ค่ะ" / "no thanks" cancel,
 * but "ไม่ทราบว่าราคาเท่าไหร่" / "no idea, what's the price" leave a real clause
 * and must not cancel a live proposal. Mirror of isBareAffirmative for CANCEL.
 */
function isBareWeakCancel(raw: string): boolean {
  let residual = raw.toLowerCase();
  for (const token of [...CANCEL_WEAK_THAI, ...POLITE_FILLER_THAI]) residual = residual.split(token).join(' ');
  residual = residual.replace(CANCEL_WEAK_EN_G, ' ').replace(POLITE_FILLER_EN_G, ' ');
  return residual.replace(/[\s\p{P}]+/gu, '').length === 0;
}

/**
 * Deterministic guardrail over a confirmation reply. CONFIRM only on an
 * unambiguous, *bare* affirmative; CANCEL on an explicit cancel or a *bare*
 * negation; UNCLEAR otherwise (empty, availability questions like "ว่างไหม",
 * affirmative-bearing questions like "ตกลงกี่โมงคะ", mixed signals such as
 * "ไม่ยืนยัน", or a negation embedded in a real sentence like "ไม่ทราบราคา").
 * Both CONFIRM and CANCEL are fail-closed: a signal buried in substantive text
 * stays UNCLEAR rather than mutating the pending proposal.
 */
export function classifyConfirmationReply(text: string): 'CONFIRM' | 'CANCEL' | 'UNCLEAR' {
  const raw = (text ?? '').trim();
  if (!raw) return 'UNCLEAR';
  // A question is never a confirmation: the Thai question particle ไหม (or any
  // ? / ？) marks an inquiry like "โอเคไหม" / "ok? tell me the time", even
  // though it contains an affirmative token such as โอเค / ใช่.
  if (raw.includes('ไหม') || /[?？]/.test(raw)) return 'UNCLEAR';
  const lower = raw.toLowerCase();
  const hasConfirm = CONFIRM_THAI.some((t) => raw.includes(t)) || CONFIRM_EN.test(lower);
  const hasStrongCancel = CANCEL_STRONG_THAI.some((t) => raw.includes(t)) || CANCEL_STRONG_EN.test(lower);
  const hasWeakCancel = CANCEL_WEAK_THAI.some((t) => raw.includes(t)) || CANCEL_WEAK_EN.test(lower);
  if (hasConfirm && (hasStrongCancel || hasWeakCancel)) return 'UNCLEAR';
  // Explicit cancel intent is permissive; a missed cancel merely falls through
  // and never books, so wrapping words are tolerated ("ขอยกเลิกนะครับ").
  if (hasStrongCancel) return 'CANCEL';
  // Bare negation only — a negation inside a substantive sentence stays UNCLEAR.
  if (hasWeakCancel && isBareWeakCancel(raw)) return 'CANCEL';
  // Fail-closed: only a bare affirmative commits. An affirmative token wrapped
  // in a substantive extra clause ("ตกลงแต่ขอเปลี่ยนเวลา") stays UNCLEAR.
  if (hasConfirm && isBareAffirmative(raw)) return 'CONFIRM';
  return 'UNCLEAR';
}
