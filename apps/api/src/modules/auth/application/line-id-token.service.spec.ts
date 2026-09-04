import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { LineLoginVerifierAdapter } from '../infrastructure/line-login-verifier.adapter';
import { LineIdTokenService } from './line-id-token.service';

const CHANNEL = '1234567890';
const TOKEN = 'aaaa.bbbb.cccc';

const config = (extra: Record<string, unknown> = {}) => ({
  lineLoginChannelId: CHANNEL,
  lineMessagingChannelId: undefined,
  isProduction: false,
  ...extra,
} as any);

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** Stands in for LINE's verify endpoint, which is the signature authority. */
function lineAnswers(body: Record<string, unknown>, ok = true) {
  globalThis.fetch = (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

function service(extra: Record<string, unknown> = {}) {
  const cfg = config(extra);
  return new LineIdTokenService(new LineLoginVerifierAdapter(cfg), cfg);
}

describe('LineIdTokenService (review SEC-01)', () => {
  it('returns the identity from the VERIFIED token, not from anything a client claimed', async () => {
    lineAnswers({ sub: 'Uline1', name: 'นิด', aud: CHANNEL, exp: Math.floor(Date.now() / 1000) + 900 });
    assert.deepEqual(await service().verify(TOKEN), {
      providerUserId: 'Uline1', displayName: 'นิด', channelId: CHANNEL,
    });
  });

  it('prefers the messaging channel, because that is where the identity row lives', async () => {
    lineAnswers({ sub: 'Uline1', aud: CHANNEL, exp: Math.floor(Date.now() / 1000) + 900 });
    const verified = await service({ lineMessagingChannelId: 'messaging-1' }).verify(TOKEN);
    assert.equal(verified.channelId, 'messaging-1');
    assert.equal(verified.displayName, undefined, 'no name claim means no name, not an empty one');
  });

  it('rejects a forged, expired or other-channel token with 401', async () => {
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ['LINE refused it', { error: 'invalid_request' }, false],
      ['no subject', { aud: CHANNEL, exp: Math.floor(Date.now() / 1000) + 900 }, true],
      ['another channel', { sub: 'Uline1', aud: 'someone-elses-channel', exp: Math.floor(Date.now() / 1000) + 900 }, true],
      ['expired', { sub: 'Uline1', aud: CHANNEL, exp: Math.floor(Date.now() / 1000) - 1 }, true],
    ];
    for (const [label, body, ok] of cases) {
      lineAnswers(body, ok);
      await assert.rejects(() => service().verify(TOKEN), UnauthorizedException, label);
    }
  });

  it('rejects a token that is not even token-shaped without calling LINE', async () => {
    globalThis.fetch = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;
    await assert.rejects(() => service().verify('not a jwt'), UnauthorizedException);
  });

  it('fails closed in production when no LINE channel is configured', async () => {
    lineAnswers({ sub: 'Uline1', aud: CHANNEL, exp: Math.floor(Date.now() / 1000) + 900 });
    const cfg = config({ isProduction: true });
    // The verifier still has a Login channel to check the audience against; only the identity
    // channel is missing, and inventing 'unknown' in production is what this refuses.
    const svc = new LineIdTokenService(new LineLoginVerifierAdapter(cfg), {
      ...cfg, lineMessagingChannelId: undefined, lineLoginChannelId: undefined,
    } as any);
    await assert.rejects(() => svc.verify(TOKEN), ServiceUnavailableException);
  });
});
