import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { SystemSignupRequestController } from './system-signup-request.controller';

// The Origin an admin's browser sends is client-suppliable, and approving a LINE application
// PERSISTS this base as the shop owner's way back in (review L-1).
const REQ = {
  headers: { origin: 'https://evil.example.com', 'x-forwarded-host': 'evil.example.com' },
  protocol: 'https',
  get: () => 'evil.example.com',
  context: { userId: 'admin-1', requestId: 'req-1' },
} as any;

function harness(sesWebBaseUrl: string | null = 'https://app.mangmeeplus.com') {
  const decisions: any[] = [];
  const queue = {
    decide: async (...args: any[]) => { decisions.push(args); return { requestId: 'signup-1', state: 'COMPLETED' }; },
  } as any;
  return {
    controller: new SystemSignupRequestController(queue, { sesWebBaseUrl: sesWebBaseUrl ?? undefined } as any),
    decisions,
  };
}

describe('SystemSignupRequestController — the handoff base an approval persists', () => {
  it('takes the web base from configuration, never from the caller headers', async () => {
    const h = harness();
    await h.controller.decide('signup-1', { action: 'APPROVE' } as any, REQ);

    // Scoped to the web base on purpose: `apiBaseUrl` uses `trustedPublicApiBase`, which prefers
    // PUBLIC_BASE_URL and only derives from headers when that is unset (unchanged, pre-existing).
    assert.equal(h.decisions[0][4].webBaseUrl, 'https://app.mangmeeplus.com');
    assert.equal(h.decisions[0][4].webBaseUrl.includes('evil.example.com'), false);
  });

  it('refuses rather than approving a shop whose owner link would point nowhere', async () => {
    const h = harness(null);
    // Wrapped: `decide` is not async, so the guard throws synchronously — either shape reaches
    // Nest as a 503, and the test should not care which.
    await assert.rejects(
      async () => h.controller.decide('signup-1', { action: 'APPROVE' } as any, REQ),
      ServiceUnavailableException,
    );
    assert.deepEqual(h.decisions, []);
  });
});
