import { createHash } from 'node:crypto';

/**
 * Canonical payload fingerprint for every Step 0 command (spec §12.1, normative).
 *
 * A command registry answers one question: "is this retry the SAME intent as the one I already
 * completed?". The fingerprint is that comparison, so it has to be stable across builds,
 * instances and JSON key order — and it has to be computed SERVER-side. A client-supplied
 * fingerprint would let a caller reuse a commandId with a different payload and have the
 * registry replay the old result as if the new intent had been carried out.
 *
 * Rules, in the order they bite:
 *  - keys sorted byte-wise at every depth, so `{a,b}` and `{b,a}` hash the same;
 *  - `null` is written out, never dropped: absent and null must normalize to ONE value or two
 *    spellings of the same intent produce two fingerprints;
 *  - civil dates arrive as `YYYY-MM-DD` strings and money as strings, both already normalized
 *    by the caller — this function does not guess at formats;
 *  - nothing that varies per request (requestId, timestamp, actor) may be in the payload.
 *
 * The field list per command type is fixed for the life of the feature; changing one is a new
 * fingerprint version, not an edit.
 */
export function canonicalFingerprint(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

/**
 * Exported for tests and for callers that want to log what was hashed. Returns a value whose
 * `JSON.stringify` is deterministic: V8 serializes string keys in insertion order, so building
 * the object in sorted order is what makes the output stable.
 */
export function canonicalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) {
    throw new TypeError('canonicalFingerprint: pass a normalized YYYY-MM-DD string, not a Date');
  }
  if (typeof value === 'number') {
    // NaN and Infinity stringify to `null`, which would silently collide with a real null.
    if (!Number.isFinite(value)) throw new TypeError(`canonicalFingerprint: non-finite number ${value}`);
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`canonicalFingerprint: unsupported value of type ${typeof value}`);
  }
  if (typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) canonical[key] = canonicalize(source[key]);
  return canonical;
}
