/**
 * Review F13. F7 clamped the claim link to its activation window, but only the pure helper had
 * cover — nothing asserted that `mint` actually uses it, which is the half that reaches a customer.
 * A 72-hour token minted on day 28 of a 30-day window is swept dead on day 30, and the applicant
 * taps a link that was valid when it was sent and gets the blank "unusable" answer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountClaimTokenService } from './account-claim-token.service';
import {
  CLAIM_EXPIRY_AFTER_APPROVAL_DAYS, CLAIM_TOKEN_TTL_HOURS, hashClaimToken,
} from '../domain/account-claim.logic';

const NOW = new Date('2026-09-06T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function harness() {
  const created: any[] = [];
  const revoked: any[] = [];
  const tx = {
    accountClaimToken: {
      updateMany: async (args: any) => { revoked.push(args); return { count: 0 }; },
      create: async (args: any) => { created.push(args); return args.data; },
    },
  };
  const prisma = { client: { $transaction: async (fn: any) => fn(tx) } } as any;
  return { service: new AccountClaimTokenService(prisma), created, revoked };
}

describe('AccountClaimTokenService.mint', () => {
  it('stores a hash and never the token itself (P11 §2 rule 2)', async () => {
    const h = harness();
    const { rawToken } = await h.service.mint('signup-1', NOW, null);

    const row = h.created[0].data;
    assert.equal(row.signupRequestId, 'signup-1');
    assert.equal(row.tokenHash, hashClaimToken(rawToken));
    assert.equal(JSON.stringify(row).includes(rawToken), false, 'the raw token must not be persisted');
    // Any earlier live link for this request dies in the same transaction.
    assert.deepEqual(h.revoked[0].where, { signupRequestId: 'signup-1', usedAt: null, revokedAt: null });
  });

  it('gives the full TTL when the window has room for it', async () => {
    const h = harness();
    const { expiresAt } = await h.service.mint('signup-1', NOW, daysAgo(1));

    assert.equal(expiresAt.getTime() - NOW.getTime(), CLAIM_TOKEN_TTL_HOURS * 3_600_000);
    assert.equal(h.created[0].data.expiresAt.getTime(), expiresAt.getTime(), 'the stored row agrees');
  });

  it('clamps the stored expiry to the end of the activation window (F7)', async () => {
    const h = harness();
    const windowStartedAt = daysAgo(28);

    const { expiresAt } = await h.service.mint('signup-1', NOW, windowStartedAt);

    const windowEnd = windowStartedAt.getTime() + CLAIM_EXPIRY_AFTER_APPROVAL_DAYS * 86_400_000;
    assert.equal(expiresAt.getTime(), windowEnd);
    // The row itself carries the clamped value — a link the sweep would outlive is never written.
    assert.equal(h.created[0].data.expiresAt.getTime(), windowEnd);
    assert.ok(expiresAt.getTime() - NOW.getTime() < CLAIM_TOKEN_TTL_HOURS * 3_600_000);
  });

  it('falls back to the plain TTL when no window is given', async () => {
    const h = harness();
    const { expiresAt } = await h.service.mint('signup-1', NOW);
    assert.equal(expiresAt.getTime() - NOW.getTime(), CLAIM_TOKEN_TTL_HOURS * 3_600_000);
  });
});
