/**
 * PDPA erasure (L-11): field-level redaction of a stored JSON blob.
 *
 * The point of this module is the *distinction*. An erasure must remove the data
 * subject's personal data from `AuditLog.metadataJson` / `OutboxEvent.payloadJson`
 * while leaving the forensic content that makes the row an audit trail at all —
 * amounts, counts, checksums, ids, reasons, results, state transitions and the
 * event envelope. Replacing the whole blob (the previous behavior) destroys both.
 */

/** Value written in place of a personal-data field. */
export const PDPA_REDACTED_VALUE = '[PDPA_ERASED]';
/** In-row marker key recording that this row was redacted, and when. */
export const PDPA_REDACTION_MARKER_KEY = 'personalDataRedaction';

const DEPTH_LIMIT_VALUE = '[PDPA_DEPTH_LIMIT]';
const CYCLE_VALUE = '[PDPA_CYCLE]';
// Audit/outbox blobs written by this app are ≤3 deep; the cap fails closed so a
// deeply nested blob can never smuggle personal data past the walk.
const MAX_DEPTH = 8;

/**
 * Personal-data terms, as token sequences. A key is personal when its token list
 * *ends with* one of these, so `customerName`, `primaryPhone`, `rawEmail` and
 * `contactAddressLine1` are covered while `reason`, `reasonCode`, `result`,
 * `entryNumber`, `checksumSha256` and every amount/count key are not.
 */
const PERSONAL_DATA_TERMS: readonly (readonly string[])[] = [
  // Identity. `fullName`/`firstName`/`lastName`/`displayName`/`lineDisplayName`
  // all end with `name`, so one term covers them.
  ['name'], ['nickname'],
  // Contact.
  ['phone'], ['phone', 'number'], ['mobile'], ['email'], ['line', 'user', 'id'],
  // Government / tax identity.
  ['national', 'id'], ['tax', 'id'], ['id', 'card', 'number'],
  // Location. `addressLine` ends with `line`, so it needs its own term.
  ['address'], ['address', 'line'], ['postal', 'code'],
  // Date of birth.
  ['birth', 'date'], ['dob'],
  // Customer-authored free text: can contain any of the above verbatim.
  // `messageText` ends with `text`, so one term covers it.
  ['note'], ['notes'], ['remark'], ['message'], ['text'], ['content'], ['body'],
];

/** Serialization/normalization suffixes the repo appends to a field name. */
const IGNORED_TAIL_TOKENS = new Set(['json', 'normalized']);

function tokenize(key: string): string[] {
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  while (tokens.length > 1) {
    const tail = tokens[tokens.length - 1]!;
    if (!IGNORED_TAIL_TOKENS.has(tail) && !/^\d+$/.test(tail)) break;
    tokens.pop();
  }
  return tokens;
}

export function isPersonalDataKey(key: string): boolean {
  const tokens = tokenize(key);
  return PERSONAL_DATA_TERMS.some((term) =>
    term.length <= tokens.length && term.every((token, i) => tokens[tokens.length - term.length + i] === token),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A marker only counts when it has the shape this module writes. Testing `in` alone would let
 * any top-level key of that name — whatever its value — skip erasure for that row forever.
 * No injection path exists today (every top-level metadata key is code-authored), but a
 * shape check closes it for free and keeps idempotency exact: our own marker still matches.
 */
function hasRedactionMarker(value: Record<string, unknown>): boolean {
  const marker = value[PDPA_REDACTION_MARKER_KEY];
  return (
    isPlainObject(marker)
    && marker['redacted'] === true
    && typeof marker['at'] === 'string'
    && Array.isArray(marker['keys'])
    && marker['keys'].every((key) => typeof key === 'string')
  );
}

export type PdpaRedactionResult = {
  /** A redacted copy. The input is never mutated. */
  value: unknown;
  /** Distinct personal-data key names removed, sorted. Empty means "no write needed". */
  redactedKeys: string[];
};

/**
 * Returns a redacted copy of `value` plus the keys that were removed.
 *
 * Idempotent: a value already carrying the redaction marker is returned unchanged
 * with `redactedKeys: []`, so a retry (or a post-restore re-erasure) neither
 * rewrites the row nor moves the recorded redaction time.
 */
export function redactPersonalData(value: unknown, at: Date): PdpaRedactionResult {
  if (!isPlainObject(value)) return { value, redactedKeys: [] };
  if (hasRedactionMarker(value)) return { value, redactedKeys: [] };

  const redactedKeys = new Set<string>();
  const seen = new WeakSet<object>();

  const walk = (node: unknown, depth: number): unknown => {
    if (!isPlainObject(node) && !Array.isArray(node)) return node;
    if (depth > MAX_DEPTH) return DEPTH_LIMIT_VALUE;
    if (seen.has(node as object)) return CYCLE_VALUE;
    seen.add(node as object);
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    return Object.fromEntries(
      Object.entries(node).map(([key, entryValue]) => {
        if (isPersonalDataKey(key)) {
          redactedKeys.add(key);
          return [key, PDPA_REDACTED_VALUE];
        }
        return [key, walk(entryValue, depth + 1)];
      }),
    );
  };

  const redacted = walk(value, 0) as Record<string, unknown>;
  if (redactedKeys.size === 0) return { value, redactedKeys: [] };

  const keys = [...redactedKeys].sort();
  return {
    value: {
      ...redacted,
      [PDPA_REDACTION_MARKER_KEY]: { redacted: true, at: at.toISOString(), keys },
    },
    redactedKeys: keys,
  };
}
