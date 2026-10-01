/**
 * The column names a unique violation (P2002) names, or `undefined` when the error is not one.
 *
 * Prisma 7 + `@prisma/adapter-pg` does **not** populate `meta.target`. Verified against the local
 * docker Postgres on 7.8.0: a duplicate `User.username` arrives as
 *
 *   code: 'P2002'
 *   meta: { modelName: 'User', driverAdapterError: { cause: {
 *     originalCode: '23505', kind: 'UniqueConstraintViolation',
 *     constraint: { fields: ['username'] } } } }
 *
 * with `meta.target === undefined`. Every reader that knew only `meta.target` therefore stopped
 * matching the moment the driver adapter was adopted, and each field-specific 409 silently degraded
 * to the generic duplicate message from `AllExceptionsFilter`. `meta.target` is still read FIRST:
 * it is what the non-adapter shape produces, and dropping it would break the other direction.
 *
 * Expression indexes report the indexed expression, truncated at its first `(` — a violation of
 * `… ("User") (lower("username"))` arrives as `['lower(username']` — so a leading `fn(` wrapper and
 * any quotes are stripped, which is what makes the pending UNIQUE promotion in
 * `docs/runbooks/username-case-uniqueness-followup.md` land on `username` like the plain index does.
 *
 * A bare string `target` is coerced to a single-element array, preserving what the use-case readers
 * this replaces already did. `AllExceptionsFilter` deliberately does NOT use this helper: it
 * requires a string array precisely so a bare `target` (an index *name*, not columns) cannot enrich
 * a client-facing body, which is a stricter rule than these callers need.
 */
export function uniqueConstraintFields(err: unknown): string[] | undefined {
  if (typeof err !== 'object' || err === null || (err as { code?: string }).code !== 'P2002') return undefined;
  const meta = (err as { meta?: Record<string, unknown> }).meta;
  const target = meta?.['target'];
  const raw = Array.isArray(target)
    ? target
    : typeof target === 'string'
      ? [target]
      : (meta?.['driverAdapterError'] as { cause?: { constraint?: { fields?: unknown } } } | undefined)
        ?.cause?.constraint?.fields;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((field) => String(field).replace(/^[A-Za-z_][A-Za-z0-9_]*\(/, '').replaceAll('"', '').replace(/\)+$/, ''));
}

/**
 * Whether PostgreSQL rolled the transaction back for a serialization conflict or a deadlock: another
 * transaction won, nothing of this one was written, and running it again is safe.
 *
 * A model query reports it as `P2034`. A raw statement (an explicit row lock, for one) reports
 * `P2010` instead and carries the SQLSTATE on the driver adapter error, as the reimbursement slip
 * pg spec pins against real Postgres: `meta.driverAdapterError.cause.originalCode === '40001'`
 * (serialization_failure). `40P01` (deadlock_detected) is read from the same place.
 */
export function isSerializationFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { code?: string }).code === 'P2034') return true;
  const sqlState = (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta?.driverAdapterError?.cause?.originalCode;
  return sqlState === '40001' || sqlState === '40P01';
}
