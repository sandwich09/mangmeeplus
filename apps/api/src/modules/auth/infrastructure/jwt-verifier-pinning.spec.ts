import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WatchdogJwtVerifierAdapter } from './watchdog-jwt-verifier.adapter';
import { DevJwtVerifierAdapter } from './dev-jwt-verifier.adapter';
import { LineLoginVerifierAdapter } from './line-login-verifier.adapter';

const SECRET = 'pinning-spec-secret';
const ISS = 'watchdog-bms';
const AUD = 'watchdog-bms-api';
const jwtService = new JwtService({});

const watchdogConfig = { authJwtSecret: SECRET, watchdogJwtIssuer: ISS, watchdogJwtAudience: AUD } as any;
const devConfig = { devAuthSecret: SECRET, isProduction: false, watchdogJwtIssuer: ISS, watchdogJwtAudience: AUD } as any;
// A config with no explicit issuer/audience must still check them, via the shared defaults.
const unsetConfig = { authJwtSecret: SECRET } as any;

function sign(payload: Record<string, unknown>, options: Record<string, unknown> = {}) {
  return jwtService.sign(payload, { secret: SECRET, algorithm: 'HS256', issuer: ISS, audience: AUD, expiresIn: 900, ...options } as any);
}

function algNone(claims: Record<string, unknown>) {
  const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  return `${head}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
}

const VALID_CLAIMS = { sub: 'user-1', sid: 'session-1', iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 900 };

/** L-04 + L-05: every rejection an access-token verifier must make. */
function rejectedTokens(): Array<[string, string]> {
  return [
    ['alg:none', algNone(VALID_CLAIMS)],
    ['wrong algorithm', jwtService.sign(VALID_CLAIMS, { secret: SECRET, algorithm: 'HS512' } as any)],
    ['wrong issuer', sign({ sub: 'user-1', sid: 'session-1' }, { issuer: 'evil-issuer' })],
    ['wrong audience', sign({ sub: 'user-1', sid: 'session-1' }, { audience: 'evil-audience' })],
    ['refresh token as access', sign({ sub: 'user-1', sid: 'session-1', type: 'refresh' })],
    ['missing sid', sign({ sub: 'user-1' })],
  ];
}

describe('WatchdogJwtVerifierAdapter — L-04 pinning / L-05 required sid', () => {
  it('accepts a correctly signed access token', async () => {
    const verifier = new WatchdogJwtVerifierAdapter(jwtService, watchdogConfig);
    assert.deepEqual(await verifier.verify(sign({ sub: 'user-1', sid: 'session-1' })), {
      subject: 'user-1',
      tokenId: 'session-1',
    });
  });

  it('rejects every unpinned or claim-less token', async () => {
    const verifier = new WatchdogJwtVerifierAdapter(jwtService, watchdogConfig);
    for (const [label, token] of rejectedTokens()) {
      await assert.rejects(() => verifier.verify(token), UnauthorizedException, label);
    }
  });

  it('still checks issuer and audience when the env vars are unset', async () => {
    const verifier = new WatchdogJwtVerifierAdapter(jwtService, unsetConfig);
    // The defaults are what the signer uses, so a correct token still verifies …
    assert.equal((await verifier.verify(sign({ sub: 'user-1', sid: 'session-1' }))).tokenId, 'session-1');
    // … and the check does not degrade to "unset means skip".
    await assert.rejects(() => verifier.verify(sign({ sub: 'user-1', sid: 'session-1' }, { issuer: 'evil-issuer' })), UnauthorizedException);
    await assert.rejects(() => verifier.verify(sign({ sub: 'user-1', sid: 'session-1' }, { audience: 'evil-audience' })), UnauthorizedException);
  });
});

describe('DevJwtVerifierAdapter — L-04 pinning / L-05 required sid', () => {
  it('accepts a correctly signed dev token', async () => {
    const verifier = new DevJwtVerifierAdapter(jwtService, devConfig);
    assert.deepEqual(await verifier.verify(sign({ sub: 'user-1', sid: 'session-1' })), {
      subject: 'user-1',
      tokenId: 'session-1',
    });
  });

  it('rejects every unpinned or claim-less token', async () => {
    const verifier = new DevJwtVerifierAdapter(jwtService, devConfig);
    for (const [label, token] of rejectedTokens()) {
      await assert.rejects(() => verifier.verify(token), UnauthorizedException, label);
    }
  });
});

describe('LineLoginVerifierAdapter — L-04 result re-check', () => {
  const CHANNEL_ID = '1234567890';
  const validToken = 'header.payload.signature';

  async function verifyWith(body: Record<string, unknown>) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
    try {
      return await new LineLoginVerifierAdapter({ lineLoginChannelId: CHANNEL_ID } as any).verify(validToken);
    } finally {
      globalThis.fetch = original;
    }
  }

  const future = Math.floor(Date.now() / 1000) + 600;

  it('accepts a result whose audience is the configured channel and whose lifetime is unexpired', async () => {
    assert.deepEqual(await verifyWith({ sub: 'line-user-1', name: 'Somchai', aud: CHANNEL_ID, exp: future }), {
      subject: 'line-user-1',
      name: 'Somchai',
    });
  });

  it('rejects a result minted for another channel, an expired one, and one with no lifetime', async () => {
    await assert.rejects(() => verifyWith({ sub: 'line-user-1', aud: 'other-channel', exp: future }), UnauthorizedException);
    await assert.rejects(() => verifyWith({ sub: 'line-user-1', aud: CHANNEL_ID, exp: Math.floor(Date.now() / 1000) - 1 }), UnauthorizedException);
    await assert.rejects(() => verifyWith({ sub: 'line-user-1', aud: CHANNEL_ID }), UnauthorizedException);
  });
});
