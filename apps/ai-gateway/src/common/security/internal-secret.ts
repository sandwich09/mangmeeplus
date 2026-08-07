import { UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

// ── L-07 shared block ─────────────────────────────────────────────────────────
// Everything below this marker is byte-identical in
// `apps/api/src/common/security/secret-compare.ts` and
// `apps/ai-gateway/src/common/security/internal-secret.ts`. The apps ship as separate
// bundles, so the helper is duplicated on purpose; `secret-compare.spec.ts` slices both
// files from this marker and fails on a one-sided edit. Keep the two identical.

/**
 * Fail-closed check of a shared internal secret (the X-Internal-Secret header) against the
 * configured value. This is the single credential guarding the @Public internal routes, so the
 * comparison is constant-time in the secret's bytes — no timing side-channel from a byte-by-byte
 * `!==`, and no early return that leaks the length.
 */
export function assertInternalSecret(secret: string | undefined, expected: string | undefined): void {
  if (!expected || !secret || !timingSafeStringEqual(secret, expected)) {
    throw new UnauthorizedException('Invalid internal secret.');
  }
}

export function timingSafeStringEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  const sameLength = actualBuffer.length === expectedBuffer.length;
  const comparisonBuffer = sameLength ? expectedBuffer : Buffer.alloc(actualBuffer.length);
  const equal = timingSafeEqual(actualBuffer, comparisonBuffer);
  return sameLength && equal;
}
