import { UnauthorizedException } from '@nestjs/common';
import { timingSafeStringEqual } from './secret-compare';

/**
 * Fail-closed check of the X-Worker-Token header, shared by every @Public()
 * internal worker controller (H-14). The token is the single credential
 * guarding these routes, so the comparison is constant-time in the secret's
 * bytes — no timing side-channel from a byte-by-byte `!==`.
 */
export function assertWorkerToken(token: string | undefined): void {
  const expected = process.env['WORKER_INTERNAL_TOKEN'];
  if (!expected || !token || !timingSafeStringEqual(token, expected)) {
    throw new UnauthorizedException('Invalid worker token');
  }
}
