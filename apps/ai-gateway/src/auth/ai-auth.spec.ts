import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { WatchdogContextVerifier } from './watchdog-context-verifier';
import { AiToolGuard } from './ai-tool.guard';
import { evaluateToolPolicy } from '../common/ai/tool-policy.model';
import type { AiGatewayConfigService } from '../common/config/ai-gateway-config.service';

const SECRET = 'test-secret';
const USER_ID = 'user-abc';
const SESSION_ID = 'session-xyz';
const PERMISSIONS = ['ai.tool.invoke', 'account.session.read'];
// L-04: the shared non-secret defaults the verifier falls back to when the env vars are unset.
const ISS = 'watchdog-bms';
const AUD = 'watchdog-bms-api';

function makeConfig(overrides: Partial<AiGatewayConfigService> = {}): AiGatewayConfigService {
  return {
    jwtSecret: SECRET,
    jwtIssuer: undefined,
    jwtAudience: undefined,
    jwtClockToleranceSeconds: 30,
    ...overrides,
  } as AiGatewayConfigService;
}

function makeToken(payload: Record<string, unknown>, secret = SECRET, expiresIn = 900) {
  return jwt.sign(payload, secret, { expiresIn, issuer: ISS, audience: AUD });
}

// ─── WatchdogContextVerifier ──────────────────────────────────────────────────

describe('WatchdogContextVerifier', () => {
  it('returns userId, sessionId, permissions for a valid token', () => {
    const token = makeToken({ sub: USER_ID, sid: SESSION_ID, permissions: PERMISSIONS });
    const verifier = new WatchdogContextVerifier(makeConfig());
    const ctx = verifier.verify(token);
    assert.equal(ctx.userId, USER_ID);
    assert.equal(ctx.sessionId, SESSION_ID);
    assert.deepEqual(ctx.permissions, PERMISSIONS);
  });

  it('defaults permissions to [] when claim is absent', () => {
    const token = makeToken({ sub: USER_ID, sid: SESSION_ID });
    const ctx = new WatchdogContextVerifier(makeConfig()).verify(token);
    assert.deepEqual(ctx.permissions, []);
  });

  it('throws UnauthorizedException for an expired token', () => {
    const token = makeToken({ sub: USER_ID, sid: SESSION_ID }, SECRET, -1);
    assert.throws(
      () => new WatchdogContextVerifier(makeConfig({ jwtClockToleranceSeconds: 0 })).verify(token),
      (e: unknown) => e instanceof UnauthorizedException,
    );
  });

  it('throws UnauthorizedException for a bad signature', () => {
    const token = makeToken({ sub: USER_ID, sid: SESSION_ID }, 'wrong-secret');
    assert.throws(
      () => new WatchdogContextVerifier(makeConfig()).verify(token),
      (e: unknown) => e instanceof UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when secret is not configured', () => {
    const token = makeToken({ sub: USER_ID, sid: SESSION_ID });
    assert.throws(
      () => new WatchdogContextVerifier(makeConfig({ jwtSecret: undefined })).verify(token),
      (e: unknown) => e instanceof UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when sub or sid are missing', () => {
    const token = makeToken({ sid: SESSION_ID }); // no sub
    assert.throws(
      () => new WatchdogContextVerifier(makeConfig()).verify(token),
      (e: unknown) => e instanceof UnauthorizedException,
    );
  });

  // L-04: algorithm, issuer and audience are pinned unconditionally.
  it('rejects alg:none, a wrong algorithm, a wrong issuer and a wrong audience', () => {
    const claims = { sub: USER_ID, sid: SESSION_ID, iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 900 };
    const algNone = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;

    const rejected = [
      algNone,
      // HS512 signed with the same secret: only the pinned algorithm list stops this.
      jwt.sign(claims, SECRET, { algorithm: 'HS512' }),
      jwt.sign({ sub: USER_ID, sid: SESSION_ID }, SECRET, { expiresIn: 900, issuer: 'evil-issuer', audience: AUD }),
      jwt.sign({ sub: USER_ID, sid: SESSION_ID }, SECRET, { expiresIn: 900, issuer: ISS, audience: 'evil-audience' }),
      // A refresh token must never authorize a gateway call.
      makeToken({ sub: USER_ID, sid: SESSION_ID, type: 'refresh' }),
    ];

    for (const token of rejected) {
      assert.throws(
        () => new WatchdogContextVerifier(makeConfig()).verify(token),
        (e: unknown) => e instanceof UnauthorizedException,
        `token must be rejected: ${token.slice(0, 24)}…`,
      );
    }
  });
});

// ─── AiToolGuard ─────────────────────────────────────────────────────────────

function makeGuard(configOverrides: Partial<AiGatewayConfigService> = {}) {
  const reflector = { getAllAndOverride: () => false } as any;
  const verifier = new WatchdogContextVerifier(makeConfig(configOverrides));
  return new AiToolGuard(reflector, verifier);
}

function makeExecutionContext(authHeader?: string) {
  const req: Record<string, unknown> = { headers: {} as Record<string, string> };
  if (authHeader) (req['headers'] as Record<string, string>)['authorization'] = authHeader;
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('AiToolGuard', () => {
  it('allows request when ai.tool.invoke is present', () => {
    const token = makeToken({ sub: USER_ID, sid: SESSION_ID, permissions: ['ai.tool.invoke'] });
    const result = makeGuard().canActivate(makeExecutionContext(`Bearer ${token}`));
    assert.equal(result, true);
  });

  it('throws ForbiddenException when ai.tool.invoke is missing', () => {
    const token = makeToken({ sub: USER_ID, sid: SESSION_ID, permissions: ['account.session.read'] });
    assert.throws(
      () => makeGuard().canActivate(makeExecutionContext(`Bearer ${token}`)),
      (e: unknown) => e instanceof ForbiddenException,
    );
  });

  it('throws UnauthorizedException when Authorization header is absent', () => {
    assert.throws(
      () => makeGuard().canActivate(makeExecutionContext()),
      (e: unknown) => e instanceof UnauthorizedException,
    );
  });

  it('skips verification for @Public() routes', () => {
    const reflector = { getAllAndOverride: () => true } as any;
    const verifier = new WatchdogContextVerifier(makeConfig());
    const guard = new AiToolGuard(reflector, verifier);
    assert.equal(guard.canActivate(makeExecutionContext()), true);
  });
});

// ─── evaluateToolPolicy ───────────────────────────────────────────────────────

describe('evaluateToolPolicy', () => {
  it('returns allow when ai.tool.invoke is present', () => {
    assert.equal(
      evaluateToolPolicy({ userId: 'u1', sessionId: 's1', permissions: ['ai.tool.invoke'], toolName: 'test' }),
      'allow',
    );
  });

  it('returns deny when ai.tool.invoke is absent', () => {
    assert.equal(
      evaluateToolPolicy({ userId: 'u1', sessionId: 's1', permissions: ['account.session.read'], toolName: 'test' }),
      'deny',
    );
  });

  it('returns deny for empty permissions', () => {
    assert.equal(
      evaluateToolPolicy({ userId: 'u1', sessionId: 's1', permissions: [], toolName: 'test' }),
      'deny',
    );
  });
});
