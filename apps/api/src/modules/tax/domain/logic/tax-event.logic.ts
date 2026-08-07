import * as crypto from 'crypto';

// ─── Idempotency key ──────────────────────────────────────────────────────────

export function taxEventIdempotencyKey(
  companyId: string,
  sourceType: string,
  sourceId: string,
  eventType: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`${companyId}:${sourceType}:${sourceId}:${eventType}`)
    .digest('hex')
    .slice(0, 32);
}

// ─── Source hash ──────────────────────────────────────────────────────────────

export function computeSourceHash(data: Record<string, unknown>): string {
  const stable = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);
}
