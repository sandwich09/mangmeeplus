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
