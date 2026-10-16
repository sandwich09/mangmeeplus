// Single source of truth for what counts as valid 50 ทวิ external-link evidence.
//
// Both the HTTP DTO and the use-case's mutation boundary validate this payload, and they used to do
// it with two independently written rule sets — the boundary accepted any Date-parsable string
// where the DTO demanded ISO-8601, silently TRUNCATED an over-long note the DTO would have
// rejected, and threw a raw TypeError on a non-string note. Divergent validators are worse than one
// validator, because the stricter layer can be bypassed while everyone believes it cannot.
//
// Pure on purpose: no Nest imports, so the DTO layer, the use case and tests all share it.

export const WHT_LINK_LIMITS = {
  commandId: 200,
  externalCertificateNumber: 100,
  externalEvidenceRef: 500,
  note: 1000,
} as const;

/**
 * STRICT calendar date, `YYYY-MM-DD` only — no time component.
 *
 * The date a certificate was issued is a calendar fact on a paper document; it has no clock time,
 * and accepting one only creates ways to record the wrong day. Concretely: ISO-8601 permits hour
 * 24 as midnight of the FOLLOWING day, so `2026-02-28T24:00:00Z` parses to 1 March. A whole-string
 * component check cannot catch that (the date part reads back as 28 February), which is exactly how
 * an operator dating a document 28 February could have had 1 March persisted.
 *
 * `<input type="date">` already sends this form, so no caller loses anything.
 */
export const WHT_LINK_ISSUED_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type WhtLinkEvidenceInput = {
  commandId?: unknown;
  externalCertificateNumber?: unknown;
  externalEvidenceRef?: unknown;
  issuedDate?: unknown;
  paymentDate?: unknown;
  note?: unknown;
};

export type NormalizedWhtLinkEvidence = {
  commandId: string;
  externalCertificateNumber: string;
  externalEvidenceRef: string;
  issuedDate: Date;
  paymentDate?: Date;
  note: string | null;
};

export type WhtLinkEvidenceResult =
  | { ok: true; value: NormalizedWhtLinkEvidence }
  | { ok: false; error: string };

/**
 * Trims, then enforces type/presence/length. An over-long value is REJECTED, never truncated:
 * quietly storing a shortened certificate number or evidence pointer would corrupt the record of a
 * legal document while reporting success.
 */
function text(value: unknown, field: string, maxLength: number, allowEmpty = false): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string.` };
  const trimmed = value.trim();
  if (!trimmed && !allowEmpty) return { ok: false, error: `${field} is required.` };
  if (trimmed.length > maxLength) return { ok: false, error: `${field} must be at most ${maxLength} characters.` };
  return { ok: true, value: trimmed };
}

export function normalizeWhtLinkEvidence(input: WhtLinkEvidenceInput): WhtLinkEvidenceResult {
  const commandId = text(input.commandId, 'commandId', WHT_LINK_LIMITS.commandId);
  if (!commandId.ok) return commandId;
  const externalCertificateNumber = text(input.externalCertificateNumber, 'externalCertificateNumber', WHT_LINK_LIMITS.externalCertificateNumber);
  if (!externalCertificateNumber.ok) return externalCertificateNumber;
  const externalEvidenceRef = text(input.externalEvidenceRef, 'externalEvidenceRef', WHT_LINK_LIMITS.externalEvidenceRef, true);
  if (!externalEvidenceRef.ok) return externalEvidenceRef;

  if (typeof input.issuedDate !== 'string') return { ok: false, error: 'issuedDate must be a string.' };
  const rawDate = input.issuedDate.trim();
  if (!WHT_LINK_ISSUED_DATE.test(rawDate)) return { ok: false, error: 'issuedDate must be a calendar date (YYYY-MM-DD).' };
  const [year, month, day] = rawDate.split('-').map(Number);
  // Built from the validated components, NOT by parsing the raw string. `Date` is lenient in both
  // directions — it rolls 2026-02-31 forward to 3 March and hour 24 forward to the next day — so
  // the only safe source for the stored value is the numbers we just checked.
  const issuedDate = new Date(Date.UTC(year, month - 1, day));
  // Rejects a well-formed but non-existent day: Date.UTC would silently roll it over.
  if (issuedDate.getUTCFullYear() !== year || issuedDate.getUTCMonth() !== month - 1 || issuedDate.getUTCDate() !== day) {
    return { ok: false, error: 'issuedDate must be a valid calendar date.' };
  }

  let paymentDate: Date | undefined;
  if (input.paymentDate !== undefined) {
    const checked = normalizeWhtLinkEvidence({ ...input, issuedDate: input.paymentDate, paymentDate: undefined });
    if (!checked.ok) return { ok: false, error: 'paymentDate must be a valid calendar date.' };
    paymentDate = checked.value.issuedDate;
    if (paymentDate > issuedDate) return { ok: false, error: 'paymentDate must not be after issuedDate.' };
  }
  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') return { ok: false, error: 'note must be a string.' };
    const trimmed = input.note.trim();
    if (trimmed.length > WHT_LINK_LIMITS.note) return { ok: false, error: `note must be at most ${WHT_LINK_LIMITS.note} characters.` };
    note = trimmed || null;
  }

  return {
    ok: true,
    value: {
      commandId: commandId.value,
      externalCertificateNumber: externalCertificateNumber.value,
      externalEvidenceRef: externalEvidenceRef.value,
      issuedDate,
      ...(paymentDate ? { paymentDate } : {}),
      note,
    },
  };
}
