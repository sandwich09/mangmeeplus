import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { PublicCompanySignupController } from './public-company-signup.controller';

/**
 * Review MEDIUM-2. These two endpoints are UNAUTHENTICATED and what they persist is the shop
 * owner's handoff URL, so an applicant who sets an Origin header could plant a link to a host they
 * control on someone else's onboarding run.
 */
const REQ = {
  headers: { origin: 'https://attacker.example.com', 'x-forwarded-host': 'attacker.example.com' },
  protocol: 'https',
  get: () => 'attacker.example.com',
  socket: { remoteAddress: '203.0.113.10' },
} as any;

function harness(sesWebBaseUrl: string | null = 'https://app.mangmeeplus.com') {
  const claims: any[] = [];
  const claim = {
    setPassword: async (cmd: any) => { claims.push(cmd); return {} as any; },
    attach: async (cmd: any) => { claims.push(cmd); return {} as any; },
  } as any;
  const rateLimit = {
    assertSignupClaimSubmitAllowed: async () => undefined,
    assertPasswordLoginAllowed: async () => undefined,
    recordPasswordLoginFailure: async () => undefined,
  } as any;
  return {
    controller: new PublicCompanySignupController(
      { externalSignupEnabled: true, sesWebBaseUrl: sesWebBaseUrl ?? undefined } as any,
      rateLimit, {} as any, {} as any, claim,
    ),
    claims,
  };
}

const SET_PASSWORD = { token: 't'.repeat(48), username: 'somchai', password: 'secret123' } as any;
const ATTACH = { token: 't'.repeat(48), identifier: 'somchai', password: 'secret123' } as any;

describe('PublicCompanySignupController — the handoff base a claim persists', () => {
  it('ignores the applicant Origin on both claim branches', async () => {
    const h = harness();
    await h.controller.setPassword(SET_PASSWORD, REQ);
    await h.controller.attach(ATTACH, REQ);

    for (const cmd of h.claims) {
      assert.equal(cmd.webBaseUrl, 'https://app.mangmeeplus.com');
      assert.equal(cmd.webBaseUrl.includes('attacker.example.com'), false);
    }
  });

  it('persists nothing at all when no web origin is configured', async () => {
    const h = harness(null);
    await assert.rejects(
      async () => h.controller.setPassword(SET_PASSWORD, REQ),
      ServiceUnavailableException,
    );
    await assert.rejects(
      async () => h.controller.attach(ATTACH, REQ),
      ServiceUnavailableException,
    );
    assert.deepEqual(h.claims, []);
  });
});
