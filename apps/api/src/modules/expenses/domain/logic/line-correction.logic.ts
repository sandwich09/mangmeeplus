/**
 * Deterministic guards for an applied LINE correction (spec §8).
 *
 * The model only ever SELECTS values; nothing here trusts it to author one. Three checks stand
 * between a hint and a write:
 *
 * 1. Grounding — every value must appear in the turn's evidence: this message plus the original
 *    text of exactly the clarifications this turn resolved. Amounts and dates must additionally
 *    select a deterministic candidate reading, so no calendar or numeral conversion is ever the
 *    model's. Unlike capture, an unmatched value is never let through: a correction with no
 *    evidence for its value is dropped, because overwriting a stored value on a guess is worse
 *    than asking again.
 * 2. Direction — "เลขเดิม 123 แก้เป็น 456" grounds both numbers. When the hint states `from`, it
 *    must equal the record's current value; when it does not and the evidence also contains what
 *    the record holds today, the turn asks instead of guessing which one to write.
 * 3. All-or-nothing — a partially applied correction leaves the record in a state the user never
 *    asked for, so any failing field aborts the whole turn.
 */
import { extractValueCandidates } from '@watchdog-bms/contracts';
import type { LineCorrectionField, LineIntakeCorrectionHints, LineIntakeCorrectionValue } from '@watchdog-bms/contracts';

/** One evidence text plus the day it was written, so relative readings resolve as they did then. */
export type CorrectionEvidence = { text: string; todayIso: string };

/** Narrow read-only question about the LINE edit capability. Keep requests carrying a value or a
 * field-specific change on the normal correction route, where they can only produce a preview. */
export function isExpenseEditCapabilityQuestion(text: string): boolean {
  const normalized = text.normalize('NFKC').trim().replace(/[\s\u200b]+/gu, '');
  if (!normalized || normalized.length > 80 || /\d/u.test(normalized)) return false;
  return /^(?:(?:บิล|รายการ|ค่าใช้จ่าย)(?:นี้|เมื่อกี้|ล่าสุด)?(?:ในไลน์|ผ่านไลน์)?|ไลน์)?(?:แก้(?:ไข)?(?:รายการ|บิล|ค่าใช้จ่าย)?(?:ผ่านไลน์|ในไลน์)?|แก้ในไลน์)(?:ได้)?(?:ไหม|มั้ย|หรือเปล่า|ได้หรือไม่)[?？!！]*$/u.test(normalized);
}

export type CorrectionTargetSnapshot = {
  expenseDate: string | null;
  grandTotalAmount: string | null;
  vendorNameSnapshot: string | null;
  vendorDocumentNumber: string | null;
  note: string | null;
};

export type CorrectionGuardOutcome =
  | { status: 'applicable'; fields: Partial<Record<LineCorrectionField, { from: string | null; to: string }>> }
  | { status: 'clarify'; reason: string; field: LineCorrectionField }
  | { status: 'guidance'; reason: string };

const normalize = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/** Whitespace-tolerant containment: the model may quote a span without its surrounding spaces. */
function appearsIn(evidence: CorrectionEvidence[], value: string): boolean {
  const needle = normalize(value);
  if (!needle) return false;
  return evidence.some((item) => normalize(item.text).includes(needle));
}

function amountCandidates(evidence: CorrectionEvidence[]): Set<string> {
  const values = new Set<string>();
  for (const item of evidence) {
    for (const candidate of extractValueCandidates(item.text, item.todayIso).amounts) {
      values.add(String(Number.parseFloat(candidate.value)));
    }
  }
  return values;
}

function dateCandidates(evidence: CorrectionEvidence[]): Set<string> {
  const values = new Set<string>();
  for (const item of evidence) {
    for (const candidate of extractValueCandidates(item.text, item.todayIso).dates) {
      values.add(candidate.isoDate);
    }
  }
  return values;
}

/**
 * The same three grounding checks, exposed for the S-4 draft lane (spec §5.4: "ตัวเลขต้องมาจาก
 * ข้อความผู้ใช้หรือจาก record"). Exported rather than re-implemented there: a second copy of this
 * rule is exactly how one of them ends up looser than the other.
 */
export function amountAppearsInEvidence(evidence: CorrectionEvidence[], value: string): boolean {
  return amountCandidates(evidence).has(String(Number.parseFloat(value)));
}

export function dateAppearsInEvidence(evidence: CorrectionEvidence[], isoDate: string): boolean {
  return dateCandidates(evidence).has(isoDate.slice(0, 10));
}

export function textAppearsInEvidence(evidence: CorrectionEvidence[], value: string): boolean {
  return appearsIn(evidence, value);
}

function currentValue(target: CorrectionTargetSnapshot, field: LineCorrectionField): string | null {
  switch (field) {
    case 'expenseDate': return target.expenseDate;
    case 'amount': return target.grandTotalAmount;
    case 'vendorName': return target.vendorNameSnapshot;
    case 'documentNumber': return target.vendorDocumentNumber;
    case 'note': return target.note;
  }
}

/** Same value, written differently (59 vs 59.0000, 2026-06-17 vs an ISO timestamp) is still the
 *  same value — comparing raw strings would reject a correct `from` and ask a pointless question. */
function sameValue(field: LineCorrectionField, a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  if (field === 'amount') {
    const left = Number.parseFloat(a);
    const right = Number.parseFloat(b);
    return Number.isFinite(left) && Number.isFinite(right) && left === right;
  }
  if (field === 'expenseDate') return a.slice(0, 10) === b.slice(0, 10);
  return normalize(a) === normalize(b);
}

function groundedValue(field: LineCorrectionField, value: string, evidence: CorrectionEvidence[]): boolean {
  if (field === 'amount') return amountCandidates(evidence).has(String(Number.parseFloat(value)));
  if (field === 'expenseDate') return dateCandidates(evidence).has(value.slice(0, 10));
  return appearsIn(evidence, value);
}

/**
 * Direction is only in doubt when the evidence ALSO contains the value the record holds today —
 * that is the "เลขเดิม 123 แก้เป็น 456" shape, where either number could be the intended target.
 * Counting candidates alone was too blunt: "รายการที่ 2" contributes a 2 that has nothing to do
 * with the amount, and rejecting that turn would ask the user a question with no real ambiguity.
 */
function evidenceIsAmbiguous(
  field: LineCorrectionField,
  evidence: CorrectionEvidence[],
  current: string | null,
  chosen: string,
): boolean {
  if (current === null) return false;
  if (sameValue(field, chosen, current)) return false;
  if (field === 'amount') return [...amountCandidates(evidence)].some((value) => sameValue(field, value, current));
  if (field === 'expenseDate') return [...dateCandidates(evidence)].some((value) => sameValue(field, value, current));
  return appearsIn(evidence, current);
}

export function evaluateCorrectionHints(
  hints: LineIntakeCorrectionHints | undefined,
  target: CorrectionTargetSnapshot,
  evidence: CorrectionEvidence[],
  allowedFields: readonly LineCorrectionField[],
): CorrectionGuardOutcome {
  const requested = allowedFields
    .map((field) => [field, hints?.[field]] as const)
    .filter((entry): entry is [LineCorrectionField, LineIntakeCorrectionValue] => entry[1] !== undefined);
  if (requested.length === 0) return { status: 'guidance', reason: 'no_correctable_field' };

  const fields: Partial<Record<LineCorrectionField, { from: string | null; to: string }>> = {};
  for (const [field, value] of requested) {
    if (!groundedValue(field, value.to, evidence)) {
      return { status: 'guidance', reason: `ungrounded_value:${field}` };
    }
    const current = currentValue(target, field);
    if (value.from !== undefined) {
      if (!sameValue(field, value.from, current)) {
        // The record no longer holds what the user is correcting — someone else already changed
        // it, or the model matched the wrong record. Either way, do not overwrite.
        return { status: 'guidance', reason: `stale_from:${field}` };
      }
    } else if (evidenceIsAmbiguous(field, evidence, current, value.to)) {
      return { status: 'clarify', reason: `ambiguous_direction:${field}`, field };
    }
    if (sameValue(field, value.to, current)) continue; // already correct — writing it changes nothing
    fields[field] = { from: current, to: value.to };
  }

  if (Object.keys(fields).length === 0) return { status: 'guidance', reason: 'already_current' };
  return { status: 'applicable', fields };
}

/** Spec `line-ai-draft-control-spec-th.md` §5.3. The header note is provenance before it is
 *  anything else: "LINE receipt upload" is how anyone later knows where the record came from, and a
 *  correction used to overwrite it with whatever sentence the user typed (UAT 2026-09-03). A
 *  correction ADDS what the user said. Bounded, because a chat can send messages all day. */
export const LINE_NOTE_MAX_CHARS = 500;
export const LINE_NOTE_USER_PREFIX = 'ผู้ใช้แจ้ง: ';
export const LINE_NOTE_SEPARATOR = ' · ';
/** Below this there is no room for a segment worth reading, so the append is refused outright
 *  rather than recording "ผู้ใช้แจ้ง: …" and calling it a note. */
const MIN_APPEND_CHARS = LINE_NOTE_USER_PREFIX.length + 8;

/**
 * `appended` — recorded in full. `truncated` — recorded, but the note filled up and the tail was
 * cut, which the reply has to say. `duplicate` — the same sentence is already the newest segment
 * (a LINE redelivery, or the user repeating themselves), so nothing changed. `empty` — there was
 * no sentence to record at all.
 *
 * The reply claims "บันทึกหมายเหตุไว้"; each of these is a case where a plain `slice(0, 500)` made
 * that claim false — silently dropping the whole new segment once the note was full, and silently
 * skipping any sentence that happened to appear anywhere in the existing note.
 */
export type NoteAppendResult = { outcome: 'appended' | 'truncated' | 'duplicate'; note: string } | { outcome: 'empty' };

export function appendUserNote(existing: string | null | undefined, text: string): NoteAppendResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { outcome: 'empty' };
  const addition = `${LINE_NOTE_USER_PREFIX}${trimmed}`;
  const base = (existing ?? '').trim();
  if (!base) {
    return addition.length <= LINE_NOTE_MAX_CHARS
      ? { outcome: 'appended', note: addition }
      : { outcome: 'truncated', note: `${addition.slice(0, LINE_NOTE_MAX_CHARS - 1)}…` };
  }
  // Only the NEWEST segment counts as a repeat. Matching anywhere in the note (what `includes` did)
  // silently discarded "ค่าอาหาร" from someone whose note already mentioned ค่าอาหาร an hour ago.
  const segments = base.split(LINE_NOTE_SEPARATOR);
  if (segments[segments.length - 1] === addition) return { outcome: 'duplicate', note: base };
  const joined = `${base}${LINE_NOTE_SEPARATOR}${addition}`;
  if (joined.length <= LINE_NOTE_MAX_CHARS) return { outcome: 'appended', note: joined };
  const room = LINE_NOTE_MAX_CHARS - base.length - LINE_NOTE_SEPARATOR.length;
  // Nothing legible fits: keep the note as it stands and let the reply send the user to the web.
  if (room < MIN_APPEND_CHARS) return { outcome: 'truncated', note: base };
  return { outcome: 'truncated', note: `${base}${LINE_NOTE_SEPARATOR}${addition.slice(0, room - 1)}…` };
}

export const LINE_NOTE_PURPOSE_PREFIX = 'วัตถุประสงค์: ';

/**
 * The draft conversation COLLECTS a business purpose over several turns and, with no purpose column
 * to put it in, stores it in the header note — by overwriting it, which destroyed the
 * `'LINE receipt upload'` provenance the moment the user answered the first question.
 *
 * Appending like a correction is wrong here too: this is one field being refined, so a second
 * answer must REPLACE the first rather than stack beside it. Hence its own segment, rewritten in
 * place, with everything else (provenance first) untouched.
 */
export function withPurposeNote(existing: string | null | undefined, purpose: string, maxChars = LINE_NOTE_MAX_CHARS): string {
  const segment = `${LINE_NOTE_PURPOSE_PREFIX}${(purpose ?? '').trim()}`;
  const kept = (existing ?? '').split(LINE_NOTE_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(LINE_NOTE_PURPOSE_PREFIX.trimEnd()));
  return [...kept, segment].join(LINE_NOTE_SEPARATOR).slice(0, maxChars);
}

/** Amount lives on the lines, and `UpdateExpenseDraftUseCase` replaces the whole line set — so a
 *  correction may only rewrite it where that set is the single trivial line a text note creates.
 *  On an OCR-parsed receipt the same write would erase itemisation and tax selections. */
export function canCorrectAmount(target: {
  sourceDocumentType: string | null;
  lines: Array<{ chargeKind?: string | null; taxCodeDefinitionId?: string | null; externalTaxCodeSnapshot?: string | null; vatAmount?: string | null; whtAmount?: string | null }>;
}): boolean {
  if (target.sourceDocumentType !== 'EXPENSE_NOTE_TEXT') return false;
  if (target.lines.length > 1) return false;
  // Expense spec §5.1: the lane rewrites the single line as a product row with the corrected
  // amount. On a record whose one line IS an additional charge that silently reclassifies a
  // service charge as goods and moves it out of the charge total — a change nobody asked for, on
  // the strength of a chat message about the amount. Refuse and let the web (or S-4) do it.
  return target.lines.every((line) =>
    line.chargeKind == null
    && !line.taxCodeDefinitionId
    && !line.externalTaxCodeSnapshot
    && Number.parseFloat(line.vatAmount ?? '0') === 0
    && Number.parseFloat(line.whtAmount ?? '0') === 0);
}
