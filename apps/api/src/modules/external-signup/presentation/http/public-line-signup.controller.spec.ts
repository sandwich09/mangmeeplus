import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PublicLineSignupController } from './public-line-signup.controller';

const REQ = {
  headers: {}, protocol: 'https', get: () => 'api.example.com',
  socket: { remoteAddress: '203.0.113.10' },
} as any;
const BODY = { idToken: 'aaaa.bbbb.cccc', companyName: 'ร้านมั่งมี', legal: {} } as any;

function harness(enabled: boolean) {
  const calls: string[] = [];
  const rateLimit = {
    assertLineSignupIpAllowed: async () => { calls.push('ip'); },
    assertLineSignupReadAllowed: async () => { calls.push('read'); },
  } as any;
  const submit = { execute: async () => { calls.push('submit'); return {} as any; } } as any;
  const status = { execute: async () => { calls.push('status'); return null; } } as any;
  return {
    controller: new PublicLineSignupController({ lineSignupEnabled: enabled } as any, rateLimit, submit, status),
    calls,
  };
}

describe('PublicLineSignupController — the flag is the rollback', () => {
  it('closes BOTH routes when LINE_SIGNUP_ENABLED is off, before any work', async () => {
    const h = harness(false);
    await assert.rejects(() => h.controller.create(BODY, REQ), (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.match(JSON.stringify((error as ForbiddenException).getResponse()), /line_signup_disabled/);
      return true;
    });
    await assert.rejects(() => h.controller.readStatus('aaaa.bbbb.cccc', REQ), ForbiddenException);
    // Unlike Flow B's asymmetric switch, nothing here strands a customer mid-flow: this flow
    // issues no links, so there is nobody holding one.
    assert.deepEqual(h.calls, [], 'not even a rate-limit counter is spent while the flag is off');
  });

  it('spends the IP bucket before the verification round trip when the flag is on', async () => {
    const h = harness(true);
    await h.controller.create(BODY, REQ);
    assert.deepEqual(h.calls, ['ip', 'submit']);
  });

  it('refuses a status read whose header is not even token-shaped', async () => {
    const h = harness(true);
    await assert.rejects(() => h.controller.readStatus(undefined, REQ), UnauthorizedException);
    await assert.rejects(() => h.controller.readStatus('not a jwt', REQ), UnauthorizedException);
    // The bucket is still charged: a malformed probe is exactly what it is there to bound.
    assert.deepEqual(h.calls, ['read', 'read']);
  });
});
